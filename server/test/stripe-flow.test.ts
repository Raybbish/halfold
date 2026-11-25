/* The whole payment flow through the routes, with the real Stripe client (StripePayments, made from the settings as
   index.ts makes it) against a fake Stripe server that keeps state the way Stripe's test mode does: Checkout Sessions,
   payments, refunds and disputes, and webhook events signed with the endpoint's secret. Stripe's own Checkout page is
   not driven: the fake pays a Session the way the test card 4242 4242 4242 4242 does. Nothing reaches Stripe. */
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createHmac } from "node:crypto";
import type { AddressInfo } from "node:net";
import { loadConfig } from "../src/config";
import { createPayments } from "../src/pay/stripe";
import { PlansSchema } from "../src/shapes";
import { setup, type TestServer } from "./helpers";

const DAY = 86400_000;
const ORIGIN = "https://app.example.com";
type Obj = Record<string, any>;

/* a[b][c]=x -> {a: {b: {c: "x"}}} (what Stripe makes of a form body). */
function unform(body: string) {
  const out: Obj = {};
  for (const [k, v] of new URLSearchParams(body)) {
    const path = k.replace(/\]/g, "").split("[");
    let o = out;
    path.slice(0, -1).forEach(p => { o = o[p] ??= {}; });
    o[path[path.length - 1]] = v;
  }
  return out;
}

class FakeStripe {
  readonly key = "sk_test_fake"; readonly secret = "whsec_fake";
  sessions = new Map<string, Obj>(); charges = new Map<string, Obj>(); seen: { method: string; url: string; body: Obj }[] = [];
  url = ""; private server!: http.Server; private n = { cs: 0, pi: 0, evt: 0, re: 0 };

  async start() {
    this.server = http.createServer((req, res) => {
      let raw = "";
      req.on("data", d => raw += d);
      req.on("end", () => {
        const body = unform(raw), r = this.reply(req.method!, req.url!, req.headers.authorization, body);
        this.seen.push({ method: req.method!, url: req.url!, body });
        res.writeHead(r.status ?? 200, { "Content-Type": "application/json" }); res.end(JSON.stringify(r.body));
      });
    });
    await new Promise<void>(r => this.server.listen(0, "127.0.0.1", r));
    this.url = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
    return this;
  }
  close() { return new Promise(r => this.server.close(r)); }
  private error(status: number, message: string) { return { status, body: { error: { message, type: "invalid_request_error" } } }; }

  private reply(method: string, url: string, auth: string | undefined, body: Obj): { status?: number; body: unknown } {
    if (auth !== `Bearer ${this.key}`) return this.error(401, "Invalid API Key provided");
    const u = new URL(url, "http://x"), m = /^\/v1\/checkout\/sessions(?:\/([^/]+))?(\/expire)?$/.exec(u.pathname);
    if (!m) return this.error(404, `Unrecognized request URL (${method}: ${u.pathname})`);
    const [, id, expire] = m;
    if (method === "POST" && !id) {
      const line = body.line_items?.["0"], price = line?.price_data;
      if (body.mode !== "payment") return this.error(400, "This fake takes one-time payments only");
      if (!price?.currency || !/^\d+$/.test(price.unit_amount ?? "") || !price.product_data?.name) return this.error(400, "Missing required param: line_items[0][price_data]");
      if (price.recurring) return this.error(400, "You specified `payment` mode but passed a recurring price.");
      if (!body.success_url) return this.error(400, "Missing required param: success_url");
      const cs = `cs_test_${++this.n.cs}`;
      const s = { id: cs, object: "checkout.session", url: `https://checkout.stripe.com/c/pay/${cs}`, mode: "payment", status: "open", payment_status: "unpaid",
        amount_total: Number(price.unit_amount) * Number(line.quantity ?? 1), currency: price.currency, customer_email: body.customer_email ?? null,
        client_reference_id: body.client_reference_id ?? null, metadata: body.metadata ?? {}, payment_intent: null, success_url: body.success_url,
        payment_intent_data: body.payment_intent_data ?? {} };
      this.sessions.set(cs, s);
      return { body: this.view(s) };
    }
    if (method === "GET" && !id) {
      const pi = u.searchParams.get("payment_intent");
      return { body: { object: "list", has_more: false, data: [...this.sessions.values()].filter(s => !pi || s.payment_intent === pi).slice(0, Number(u.searchParams.get("limit") || 10)).map(s => this.view(s)) } };
    }
    const s = id ? this.sessions.get(decodeURIComponent(id)) : undefined;
    if (!s) return this.error(404, `No such checkout.session: '${id}'`);
    if (method === "GET" && !expire) return { body: this.view(s) };
    if (method === "POST" && expire) {
      if (s.status !== "open") return this.error(400, `Only Checkout Sessions with a status in ["open"] can be expired.`);
      s.status = "expired"; return { body: this.view(s) };
    }
    return this.error(404, "Unrecognized request URL");
  }
  private view(s: Obj) { const { payment_intent_data: _, ...v } = s; return v; }

  /* The student pays on Stripe's page with a test card: the Session completes, with a payment and its charge. */
  pay(cs: string) {
    const s = this.sessions.get(cs)!;
    if (s.status !== "open") throw new Error(`${cs} is ${s.status}`);
    const pi = `pi_test_${++this.n.pi}`, ch = `ch_test_${this.n.pi}`;
    Object.assign(s, { status: "complete", payment_status: "paid", payment_intent: pi });
    this.charges.set(ch, { id: ch, object: "charge", amount: s.amount_total, amount_refunded: 0, refunded: false, currency: s.currency, payment_intent: pi,
      metadata: {}, description: s.payment_intent_data.description, paid: true, status: "succeeded" });
    return this.view(s);
  }
  private chargeOf(pi: string) { return [...this.charges.values()].find(c => c.payment_intent === pi)!; }
  /* A refund from the Dashboard (all that is left, or an amount in cents): the charge as charge.refunded carries it. */
  refund(pi: string, amount?: number) {
    const c = this.chargeOf(pi), left = c.amount - c.amount_refunded, n = amount ?? left;
    if (n <= 0 || n > left) throw new Error(`Refund amount (${n}) is greater than unrefunded amount on charge (${left})`);
    c.amount_refunded += n; c.refunded = c.amount_refunded === c.amount; ++this.n.re;
    return { ...c };
  }
  dispute(pi: string, status: "won" | "lost") {
    const c = this.chargeOf(pi);
    return { id: `dp_${c.id}`, object: "dispute", amount: c.amount - c.amount_refunded, charge: c.id, payment_intent: pi, status, reason: "fraudulent" };
  }
  /* An event as Stripe posts it to the webhook endpoint, signed with the endpoint's secret. */
  signed(type: string, object: unknown, secret = this.secret) {
    const payload = JSON.stringify({ id: `evt_${++this.n.evt}`, object: "event", api_version: "2025-03-31.basil", type, data: { object } });
    const t = Math.floor(Date.now() / 1000);
    return { payload, signature: `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${payload}`).digest("hex")}` };
  }
  async send(s: TestServer, type: string, object: unknown, secret?: string) {
    const { payload, signature } = this.signed(type, object, secret);
    return s.call("POST", "/stripe/webhook", { body: payload, headers: { "Content-Type": "application/json", "Stripe-Signature": signature } });
  }
}

/* A server with payments made from the settings, as index.ts does: a test key, the webhook secret, the fake's address. */
async function withStripe(t: { after: (fn: () => unknown) => void }) {
  const fake = await new FakeStripe().start(); t.after(() => fake.close());
  const config = loadConfig({ STRIPE_SECRET_KEY: fake.key, STRIPE_WEBHOOK_SECRET: fake.secret, STRIPE_API_BASE: fake.url });
  const { payments, problem } = createPayments(config.stripe);
  assert.equal(problem, null); assert.ok(payments);
  const s = setup({ realPlans: true, payments }); t.after(() => s.close());
  const token = await s.signIn(), me = s.store.userByCode("CODE-A")!.id;
  s.store.bindEmail(me, "ann@example.edu");
  const plans = async () => PlansSchema.parse((await s.call("GET", "/plans", { token })).body);
  const choose = async (planId: string) => (await s.call("POST", "/checkout", { token, json: { planId }, headers: { Origin: ORIGIN } })).body.url as string;
  const until = () => Date.parse(s.store.pass(me)?.until ?? "0");
  return { fake, s, token, me, plans, choose, until };
}
const near = (ms: number, want: number) => Math.abs(ms - want) < 60_000;

test("test mode, end to end: a pass paid once with a test card, picked up on coming back and by the webhook; refunded in part, then in full", async t => {
  const { fake, s, plans, choose, until } = await withStripe(t);
  const url = await choose("plus-semester");
  assert.equal(url, "https://checkout.stripe.com/c/pay/cs_test_1");
  const made = fake.seen[0].body;
  assert.deepEqual([made.mode, made.line_items["0"].price_data.unit_amount, made.line_items["0"].price_data.currency, made.customer_email, made.success_url],
    ["payment", "34800", "hkd", "ann@example.edu", ORIGIN + "/#/settings"]);
  assert.deepEqual(made.payment_intent_data.metadata, made.metadata);
  assert.equal((await plans()).current, "free", "not paid yet");

  /* Paid with 4242 4242 4242 4242; the student is sent back to Settings before the webhook arrives. */
  const paid = fake.pay("cs_test_1");
  const p = await plans();
  assert.equal(p.current, "plus-semester");
  assert.ok(near(until(), Date.now() + 120 * DAY));
  assert.ok(fake.seen.some(x => x.method === "GET" && x.url === "/v1/checkout/sessions/cs_test_1"), "asked Stripe on coming back");
  /* The webhook comes: signed with another secret it is refused; with the right one it changes nothing more. */
  assert.equal((await fake.send(s, "checkout.session.completed", paid, "whsec_other")).status, 400);
  assert.equal((await fake.send(s, "checkout.session.completed", paid)).status, 200);
  assert.ok(near(until(), Date.now() + 120 * DAY));

  /* HK$174 of HK$348 refunded in the Dashboard: half the days come off. */
  const before = until();
  assert.equal((await fake.send(s, "charge.refunded", fake.refund(paid.payment_intent, 17400))).status, 200);
  assert.equal(until(), before - 60 * DAY);
  assert.equal((await plans()).current, "plus-semester");
  /* The rest: the plan ends now. */
  assert.equal((await fake.send(s, "charge.refunded", fake.refund(paid.payment_intent))).status, 200);
  assert.ok(near(until(), Date.now()));
  assert.equal((await plans()).current, "free");
  assert.equal(s.store.checkout("cs_test_1")!.returned, 1);
});

test("test mode, end to end: an old tab's Checkout is closed at Stripe; a refund before the server heard of the payment; a dispute lost", async t => {
  const { fake, s, plans, choose, until } = await withStripe(t);
  await choose("plus-semester");
  assert.equal(await choose("plus-month"), "https://checkout.stripe.com/c/pay/cs_test_2");
  assert.equal(fake.sessions.get("cs_test_1")!.status, "expired");
  assert.throws(() => fake.pay("cs_test_1"), /expired/, "the old tab cannot be paid");

  /* Paid, but the webhook about it was missed and the student never came back; then refunded in full. The server asks
     Stripe which Checkout the payment was, applies it, and takes it back: the student is not given the month. */
  const paid = fake.pay("cs_test_2");
  assert.equal((await fake.send(s, "charge.refunded", fake.refund(paid.payment_intent))).status, 200);
  assert.ok(fake.seen.some(x => x.url === `/v1/checkout/sessions?payment_intent=${paid.payment_intent}&limit=1`));
  assert.ok(near(until(), Date.now()));
  assert.equal((await plans()).current, "free");

  /* Another month, and the student disputes the payment with their bank. Halfold winning the dispute changes nothing;
     losing it (the money went back to the student) is a full refund: Free again. */
  await choose("plus-month");
  const again = fake.pay("cs_test_3");
  await fake.send(s, "checkout.session.completed", again);
  assert.equal((await plans()).current, "plus-month");
  assert.equal((await fake.send(s, "charge.dispute.closed", fake.dispute(again.payment_intent, "won"))).status, 200);
  assert.equal((await plans()).current, "plus-month");
  assert.equal((await fake.send(s, "charge.dispute.closed", fake.dispute(again.payment_intent, "lost"))).status, 200);
  assert.equal((await plans()).current, "free");
});
