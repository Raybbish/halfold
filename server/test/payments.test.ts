/* The requests sent to Stripe and Resend (phase 4), and how their replies are read, against a local fake server; the
   webhook signature; refusing a live Stripe key; and checking plans.json. Nothing here reaches the real services. The
   whole payment flow, through the routes and against a fake Stripe that keeps state, is in stripe-flow.test.ts. */
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { createHmac } from "node:crypto";
import type { AddressInfo } from "node:net";
import { StripePayments, createPayments, formBody, readCharge, readDispute, verifySignature } from "../src/pay/stripe";
import { ResendMailer, codeMail, createMailer } from "../src/mail";
import { PlanBookSchema, cards, money, readPlans } from "../src/plans";
import { SERVER_DIR, loadConfig } from "../src/config";

interface Seen { method: string; url: string; headers: http.IncomingHttpHeaders; body: string }
async function fakeServer(reply: (req: Seen) => { status?: number; body: unknown }) {
  const seen: Seen[] = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", d => body += d);
    req.on("end", () => {
      const s = { method: req.method!, url: req.url!, headers: req.headers, body }; seen.push(s);
      const r = reply(s);
      res.writeHead(r.status || 200, { "Content-Type": "application/json" }); res.end(JSON.stringify(r.body));
    });
  });
  await new Promise<void>(r => server.listen(0, "127.0.0.1", r));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, seen, close: () => new Promise(r => server.close(r)) };
}
const form = (body: string) => Object.fromEntries(new URLSearchParams(body));
const sign = (payload: string, secret: string, t: number) => `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${payload}`).digest("hex")}`;

test("Stripe Checkout: paid once (mode payment, nothing recurring), form-encoded with the secret key; Stripe's error message is kept", async t => {
  const srv = await fakeServer(s => s.url === "/v1/checkout/sessions" && form(s.body)["metadata[card]"] === "broken"
    ? { status: 400, body: { error: { message: "Invalid currency: xyz" } } } : { body: { id: "cs_test_9", url: "https://checkout.stripe.com/c/pay/cs_test_9" } });
  t.after(srv.close);
  const pay = new StripePayments("sk_test_123", "whsec_1", srv.url);
  const base = { productName: "Halfold Plus for a semester, 120 days", currency: "hkd", amount: 34800, successUrl: "https://a.b/#/settings", cancelUrl: "https://a.b/#/settings", userId: "u1" };
  const metadata = { user: "u1", plan: "plus", card: "plus-semester", days: "120" };
  assert.deepEqual(await pay.createCheckout({ ...base, email: "ann@example.edu", metadata }), { id: "cs_test_9", url: "https://checkout.stripe.com/c/pay/cs_test_9" });
  const req = srv.seen[0];
  assert.equal(req.method, "POST"); assert.equal(req.url, "/v1/checkout/sessions"); assert.equal(req.headers.authorization, "Bearer sk_test_123");
  assert.equal(req.headers["content-type"], "application/x-www-form-urlencoded");
  /* Nothing renews: no subscription, no recurring price. No payment_method_types: the methods are the ones turned on in
     the Dashboard. The payment carries the metadata too, so a payment found in the Dashboard says whose it is. */
  assert.deepEqual(form(req.body), {
    mode: "payment", "line_items[0][quantity]": "1", "line_items[0][price_data][currency]": "hkd", "line_items[0][price_data][unit_amount]": "34800",
    "line_items[0][price_data][product_data][name]": "Halfold Plus for a semester, 120 days",
    success_url: "https://a.b/#/settings", cancel_url: "https://a.b/#/settings", client_reference_id: "u1", customer_email: "ann@example.edu",
    "metadata[user]": "u1", "metadata[plan]": "plus", "metadata[card]": "plus-semester", "metadata[days]": "120",
    "payment_intent_data[description]": "Halfold Plus for a semester, 120 days",
    "payment_intent_data[metadata][user]": "u1", "payment_intent_data[metadata][plan]": "plus", "payment_intent_data[metadata][card]": "plus-semester", "payment_intent_data[metadata][days]": "120"
  });
  /* A student without an email yet: Checkout asks for one. */
  await pay.createCheckout({ ...base, email: null, metadata });
  assert.equal(form(srv.seen[1].body).customer_email, undefined);
  await assert.rejects(pay.createCheckout({ ...base, metadata: { card: "broken" } }), /Stripe 400 \/v1\/checkout\/sessions: Invalid currency: xyz/);
});

test("Stripe: reading a Checkout, finding the Checkout of a payment, closing one; refunds and disputes as the webhook gives them", async t => {
  const paid = { id: "cs_1", object: "checkout.session", status: "complete", payment_status: "paid", mode: "payment", payment_intent: "pi_1", metadata: { user: "u1", n: 5 } };
  const srv = await fakeServer(s => {
    if (s.url === "/v1/checkout/sessions/cs_1") return { body: { ...paid, payment_intent: { id: "pi_1", object: "payment_intent" } } };
    if (s.url === "/v1/checkout/sessions?payment_intent=pi_1&limit=1") return { body: { object: "list", data: [paid], has_more: false } };
    if (s.url === "/v1/checkout/sessions?payment_intent=pi_none&limit=1") return { body: { object: "list", data: [], has_more: false } };
    if (s.url === "/v1/checkout/sessions/cs_1/expire") return { body: { id: "cs_1", status: "expired" } };
    return { status: 404, body: { error: { message: "No such thing" } } };
  });
  t.after(srv.close);
  const pay = new StripePayments("sk_test_1", "", srv.url);
  const info = { id: "cs_1", status: "complete", paymentStatus: "paid", paymentIntent: "pi_1", metadata: { user: "u1" } };
  assert.deepEqual(await pay.checkout("cs_1"), info);
  assert.deepEqual(await pay.checkoutOfPayment("pi_1"), info);
  assert.deepEqual([srv.seen[1].method, srv.seen[1].body], ["GET", ""]);
  assert.equal(await pay.checkoutOfPayment("pi_none"), null);
  await pay.expireCheckout("cs_1");
  assert.deepEqual([srv.seen[3].method, srv.seen[3].url, srv.seen[3].body], ["POST", "/v1/checkout/sessions/cs_1/expire", ""]);
  await assert.rejects(pay.checkout("cs_404"), /Stripe 404 \/v1\/checkout\/sessions\/cs_404: No such thing/);
  await assert.rejects(pay.checkoutOfPayment("pi_404"), /^Error: Stripe 404 \/v1\/checkout\/sessions: No such thing$/);

  /* charge.refunded and charge.dispute.closed: the objects in the events. */
  assert.deepEqual(readCharge({ id: "ch_1", object: "charge", amount: 34800, amount_refunded: 17400, refunded: false, payment_intent: "pi_1", currency: "hkd" }),
    { id: "ch_1", paymentIntent: "pi_1", amount: 34800, refunded: 17400, currency: "hkd" });
  assert.deepEqual(readCharge({ id: "ch_2", payment_intent: { id: "pi_2" } }), { id: "ch_2", paymentIntent: "pi_2", amount: 0, refunded: 0, currency: "" });
  assert.deepEqual(readDispute({ id: "dp_1", object: "dispute", status: "lost", payment_intent: "pi_1", charge: "ch_1", amount: 34800 }), { id: "dp_1", paymentIntent: "pi_1", status: "lost" });
});

test("the webhook signature: right, wrong, old, several v1 values, no secret", () => {
  const payload = JSON.stringify({ id: "evt_1", type: "checkout.session.completed", data: { object: { id: "cs_1" } } });
  const now = new Date("2026-11-14T10:00:00Z"), t = now.getTime() / 1000;
  const pay = new StripePayments("sk_test_1", "whsec_abc");
  assert.deepEqual(pay.event(payload, sign(payload, "whsec_abc", t), now), { id: "evt_1", type: "checkout.session.completed", object: { id: "cs_1" } });
  assert.doesNotThrow(() => verifySignature(payload, `${sign(payload, "whsec_old", t)},v1=${sign(payload, "whsec_abc", t).split("v1=")[1]}`, "whsec_abc", now));
  assert.throws(() => pay.event(payload, sign(payload, "whsec_other", t), now), /does not match/);
  assert.throws(() => pay.event(payload + " ", sign(payload, "whsec_abc", t), now), /does not match/);
  assert.throws(() => pay.event(payload, sign(payload, "whsec_abc", t - 301), now), /too old/);
  assert.throws(() => pay.event(payload, undefined, now), /no Stripe signature/);
  assert.throws(() => new StripePayments("sk_test_1", "").event(payload, sign(payload, "", t), now), /STRIPE_WEBHOOK_SECRET is not set/);
});

test("payments: off without a key; a live key is refused unless STRIPE_ALLOW_LIVE=on", () => {
  const c = { secretKey: "", webhookSecret: "", apiBase: "https://api.stripe.com", allowLive: false };
  assert.deepEqual(createPayments(c), { payments: null, problem: null });
  assert.ok(createPayments({ ...c, secretKey: "sk_test_x" }).payments instanceof StripePayments);
  for (const key of ["sk_live_x", "rk_live_x"]) {
    const live = createPayments({ ...c, secretKey: key });
    assert.equal(live.payments, null); assert.match(live.problem!, /live key/);
  }
  assert.ok(createPayments({ ...c, secretKey: "sk_live_x", allowLive: true }).payments);
  assert.equal(loadConfig({ STRIPE_SECRET_KEY: " sk_test_1 " }).stripe.secretKey, "sk_test_1");
  assert.equal(formBody({ a: { b: [1, { c: "x y" }] }, n: null }), "a%5Bb%5D%5B0%5D=1&a%5Bb%5D%5B1%5D%5Bc%5D=x+y");
});

test("Resend: the sign-in email as JSON with the key; an error says what Resend replied; no key prints to the console", async t => {
  const srv = await fakeServer(s => JSON.parse(s.body).to[0] === "bad@x.edu" ? { status: 422, body: { message: "The from address is not verified" } } : { body: { id: "em_1" } });
  t.after(srv.close);
  const m = new ResendMailer("re_123", "Halfold <login@sidenote.example>", srv.url);
  await m.send(codeMail("ann@example.edu", "042137", 10));
  assert.equal(srv.seen[0].url, "/emails"); assert.equal(srv.seen[0].headers.authorization, "Bearer re_123");
  const body = JSON.parse(srv.seen[0].body);
  assert.deepEqual([body.from, body.to, body.subject], ["Halfold <login@sidenote.example>", ["ann@example.edu"], "042137 is your Halfold code"]);
  assert.ok(body.text.includes("042137") && body.html.includes("042137"));
  await assert.rejects(m.send(codeMail("bad@x.edu", "1", 10)), /Resend 422: .*not verified/);
  assert.equal(createMailer(loadConfig({})).provider, "console");
  assert.equal(createMailer(loadConfig({ RESEND_API_KEY: "re_1" })).provider, "resend");
});

test("plans.json: the committed file is valid; a broken one, or one written before one-time payments, says what is wrong", () => {
  const book = readPlans(fs.readFileSync(path.join(SERVER_DIR, "plans.json"), "utf8"));
  assert.deepEqual(cards(book).map(c => [c.id, c.kind]), [["free", "free"], ["plus-month", "pass"], ["plus-semester", "pass"]]);
  assert.equal(money("HKD", 98), "HK$98"); assert.equal(money("hkd", 12.5), "HK$12.50"); assert.equal(money("JPY", 500), "500 JPY");
  const ok = { currency: "HKD", plans: [{ id: "free", name: "Free", dailyLiveMinutes: 60, lecturesPerMonth: 2, packsPerMonth: 0, audioDays: 7 }] };
  assert.ok(PlanBookSchema.safeParse(ok).success);
  const pass = { id: "x-week", name: "X for a week", price: 30, days: 7 };
  const paidFirst = { ...ok, plans: [{ ...ok.plans[0], passes: [pass] }] };
  assert.throws(() => readPlans(JSON.stringify(paidFirst)), /the first plan is the free one/);
  const noPrice = { ...ok, plans: [ok.plans[0], { ...ok.plans[0], id: "plus" }] };
  assert.throws(() => readPlans(JSON.stringify(noPrice)), /plans\.1: a plan after the first needs at least one pass/);
  assert.throws(() => readPlans(JSON.stringify({ ...ok, plans: [ok.plans[0], { ...ok.plans[0], id: "plus", passes: [] }] })), /needs at least one pass/);
  const twice = { ...ok, plans: [ok.plans[0], { ...ok.plans[0], id: "plus", passes: [pass, { ...pass, id: "free" }] }] };
  assert.throws(() => readPlans(JSON.stringify(twice)), /ids must all be different/);
  assert.ok(readPlans(JSON.stringify({ ...ok, plans: [ok.plans[0], { ...ok.plans[0], id: "plus", passes: [pass] }] })));
  /* The format before 2026-11-24: a monthly price was a subscription. */
  assert.throws(() => readPlans(JSON.stringify({ ...ok, plans: [ok.plans[0], { ...ok.plans[0], id: "plus", monthly: 98 }] }), "old.json"), /^Error: old\.json: plan "plus": "monthly" is gone: payments are one-time now/);
  assert.throws(() => readPlans(JSON.stringify({ ...ok, plans: [ok.plans[0], { ...ok.plans[0], id: "plus", pass }] })), /"pass" is now a list, "passes"/);
  assert.throws(() => readPlans("{", "x.json"), /x\.json is not valid JSON/);
  assert.throws(() => loadConfig({ PLANS_FILE: "missing-plans.json" }), /ENOENT/);
});
