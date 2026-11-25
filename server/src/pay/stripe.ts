/* Stripe (phase 4; one-time payments and refunds from 2026-11-24): Checkout for a pass, paid once and never renewed,
   and the webhook that tells the server what happened: paid, expired, refunded, a dispute lost. Plain HTTPS calls to
   the Stripe API (form-encoded, as Stripe takes them); no SDK. The tests replace the whole Payments object
   (test/helpers.ts), check these requests against a local fake server (test/payments.test.ts), and run the whole
   flow against a fake Stripe (test/stripe-flow.test.ts). */
import { createHmac, timingSafeEqual } from "node:crypto";

export interface CheckoutRequest {
  productName: string;
  currency: string;               // "hkd"
  amount: number;                 // smallest unit: cents
  successUrl: string; cancelUrl: string;
  userId: string;
  email?: string | null;          // the address Checkout fills in and sends the receipt to
  metadata: Record<string, string>;
}
export interface CheckoutInfo {
  id: string; status: "open" | "complete" | "expired"; paymentStatus: string;
  paymentIntent: string | null;   // the payment, once made: what a refund names
  metadata: Record<string, string>;
}
/* A payment as Stripe has it: what was paid and what has been given back so far, in the smallest unit. */
export interface ChargeInfo { id: string; paymentIntent: string | null; amount: number; refunded: number; currency: string }
/* A student's bank took the payment back (a chargeback). status "lost": the money is gone for good. */
export interface DisputeInfo { id: string; paymentIntent: string | null; status: string }
export interface PaymentEvent { id: string; type: string; object: Record<string, unknown> }

export interface Payments {
  createCheckout(r: CheckoutRequest): Promise<{ id: string; url: string }>;
  checkout(id: string): Promise<CheckoutInfo>;
  /* The Checkout a payment was made in (a refund names the payment, not the Checkout); null when there is none. */
  checkoutOfPayment(paymentIntent: string): Promise<CheckoutInfo | null>;
  /* Closes a Checkout that was not paid, so an old tab cannot be paid after a newer choice. */
  expireCheckout(id: string): Promise<void>;
  /* The webhook's event, once its signature is checked; throws when it is not from Stripe. */
  event(payload: string, signature: string | undefined, at?: Date): PaymentEvent;
}

/* {a: {b: 1}, c: [x]} -> a[b]=1&c[0]=x */
export function formBody(o: Record<string, unknown>) {
  const out = new URLSearchParams();
  const add = (key: string, v: unknown) => {
    if (v === undefined || v === null) return;
    if (Array.isArray(v)) v.forEach((x, i) => add(`${key}[${i}]`, x));
    else if (typeof v === "object") for (const [k, x] of Object.entries(v as Record<string, unknown>)) add(`${key}[${k}]`, x);
    else out.append(key, String(v));
  };
  for (const [k, v] of Object.entries(o)) add(k, v);
  return out.toString();
}

const idOf = (v: unknown) => typeof v === "string" ? v : v && typeof v === "object" && typeof (v as { id?: unknown }).id === "string" ? (v as { id: string }).id : null;
const meta = (v: unknown) => Object.fromEntries(Object.entries((v && typeof v === "object" ? v : {}) as Record<string, unknown>).filter(([, x]) => typeof x === "string")) as Record<string, string>;
const count = (v: unknown) => typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 0;

export function readCheckout(o: Record<string, unknown>): CheckoutInfo {
  const st = o.status === "complete" || o.status === "expired" ? o.status : "open";
  return { id: String(o.id), status: st, paymentStatus: String(o.payment_status ?? ""), paymentIntent: idOf(o.payment_intent), metadata: meta(o.metadata) };
}
export function readCharge(o: Record<string, unknown>): ChargeInfo {
  return { id: String(o.id), paymentIntent: idOf(o.payment_intent), amount: count(o.amount), refunded: count(o.amount_refunded), currency: String(o.currency ?? "") };
}
export function readDispute(o: Record<string, unknown>): DisputeInfo {
  return { id: String(o.id), paymentIntent: idOf(o.payment_intent), status: String(o.status ?? "") };
}

/* Stripe-Signature: t=<seconds>,v1=<hex HMAC-SHA256 of "t.payload">[,v1=...]. Older than 5 minutes is refused (replays). */
export function verifySignature(payload: string, header: string | undefined, secret: string, at = new Date(), toleranceSec = 300) {
  if (!secret) throw new Error("STRIPE_WEBHOOK_SECRET is not set");
  const parts = (header || "").split(",").map(x => x.trim().split("="));
  const t = Number(parts.find(p => p[0] === "t")?.[1]), sigs = parts.filter(p => p[0] === "v1").map(p => p[1] || "");
  if (!Number.isInteger(t) || !sigs.length) throw new Error("no Stripe signature");
  if (Math.abs(at.getTime() / 1000 - t) > toleranceSec) throw new Error("the Stripe signature is too old");
  const want = Buffer.from(createHmac("sha256", secret).update(`${t}.${payload}`).digest("hex"));
  if (!sigs.some(s => { const got = Buffer.from(s); return got.length === want.length && timingSafeEqual(got, want); })) throw new Error("the Stripe signature does not match");
}

export class StripePayments implements Payments {
  constructor(private readonly key: string, private readonly webhookSecret: string, private readonly base = "https://api.stripe.com") {}

  private async call(method: "GET" | "POST", p: string, body?: Record<string, unknown>) {
    const r = await fetch(this.base + p, {
      method, signal: AbortSignal.timeout(10_000),
      headers: { Authorization: `Bearer ${this.key}`, ...(body ? { "Content-Type": "application/x-www-form-urlencoded" } : {}) },
      body: body ? formBody(body) : undefined
    });
    const text = await r.text();
    let json: Record<string, unknown> = {};
    try { json = JSON.parse(text); } catch { /* not JSON */ }
    if (!r.ok) throw new Error(`Stripe ${r.status} ${p.split("?")[0]}: ${(json.error as { message?: string } | undefined)?.message || text.slice(0, 300)}`);
    return json;
  }

  async createCheckout(q: CheckoutRequest) {
    const o = await this.call("POST", "/v1/checkout/sessions", {
      /* Paid once: no subscription, nothing renews. */
      mode: "payment",
      line_items: [{ quantity: 1, price_data: { currency: q.currency, unit_amount: q.amount, product_data: { name: q.productName } } }],
      success_url: q.successUrl, cancel_url: q.cancelUrl,
      client_reference_id: q.userId,
      ...(q.email ? { customer_email: q.email } : {}),
      metadata: q.metadata,
      /* The payment carries the same metadata, so a payment found in the Dashboard says whose it is and what it bought.
         The payment methods are the ones turned on in the Stripe Dashboard (no payment_method_types). */
      payment_intent_data: { description: q.productName, metadata: q.metadata }
    });
    if (typeof o.id !== "string" || typeof o.url !== "string") throw new Error("Stripe did not return a Checkout link");
    return { id: o.id, url: o.url };
  }
  async checkout(id: string) { return readCheckout(await this.call("GET", "/v1/checkout/sessions/" + encodeURIComponent(id))); }
  async checkoutOfPayment(paymentIntent: string) {
    const o = await this.call("GET", "/v1/checkout/sessions?" + new URLSearchParams({ payment_intent: paymentIntent, limit: "1" }));
    const first = Array.isArray(o.data) ? o.data[0] as Record<string, unknown> | undefined : undefined;
    return first ? readCheckout(first) : null;
  }
  async expireCheckout(id: string) { await this.call("POST", "/v1/checkout/sessions/" + encodeURIComponent(id) + "/expire", {}); }
  event(payload: string, signature: string | undefined, at = new Date()): PaymentEvent {
    verifySignature(payload, signature, this.webhookSecret, at);
    const e = JSON.parse(payload) as { id?: string; type?: string; data?: { object?: Record<string, unknown> } };
    return { id: String(e.id), type: String(e.type), object: e.data?.object || {} };
  }
}

/* Payments are on when STRIPE_SECRET_KEY is set. A live key (real money) is refused unless STRIPE_ALLOW_LIVE=on. */
export function createPayments(c: { secretKey: string; webhookSecret: string; apiBase: string; allowLive: boolean }): { payments: Payments | null; problem: string | null } {
  if (!c.secretKey) return { payments: null, problem: null };
  if (/^(sk|rk)_live_/.test(c.secretKey) && !c.allowLive) return { payments: null, problem: "STRIPE_SECRET_KEY is a live key (real charges). Use a test key (sk_test_...), or set STRIPE_ALLOW_LIVE=on when you mean to take real payments." };
  return { payments: new StripePayments(c.secretKey, c.webhookSecret, c.apiBase), problem: null };
}
