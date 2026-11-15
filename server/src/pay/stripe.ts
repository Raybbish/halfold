/* Stripe (phase 4): Checkout for a plan paid every month (a subscription) or once (a pass), the billing page where a
   student cancels or changes their card, and the webhook that tells the server what happened. Plain HTTPS calls to the
   Stripe API (form-encoded, as Stripe takes them); no SDK. The tests replace the whole Payments object (test/helpers.ts),
   and check these requests against a local fake server (test/payments.test.ts). */
import { createHmac, timingSafeEqual } from "node:crypto";

export interface CheckoutRequest {
  mode: "subscription" | "payment";
  productName: string;
  currency: string;               // "hkd"
  amount: number;                 // smallest unit: cents
  successUrl: string; cancelUrl: string;
  userId: string;
  customer?: string | null;       // the student in Stripe, when they have paid before
  email?: string | null;          // otherwise the address Checkout fills in
  metadata: Record<string, string>;
}
export interface CheckoutInfo {
  id: string; status: "open" | "complete" | "expired"; paymentStatus: string; mode: string;
  subscription: string | null; customer: string | null; metadata: Record<string, string>;
}
export interface SubscriptionInfo {
  id: string; customer: string | null; status: string; periodEnd: string;   // ISO
  cancelAtEnd: boolean; endedAt: string | null; metadata: Record<string, string>;
}
export interface PaymentEvent { id: string; type: string; object: Record<string, unknown> }

export interface Payments {
  createCheckout(r: CheckoutRequest): Promise<{ id: string; url: string }>;
  checkout(id: string): Promise<CheckoutInfo>;
  /* Closes a Checkout that was not paid, so an old tab cannot be paid after a newer choice. */
  expireCheckout(id: string): Promise<void>;
  subscription(id: string): Promise<SubscriptionInfo>;
  billingPortal(customer: string, returnUrl: string): Promise<string>;
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

const iso = (sec: unknown) => typeof sec === "number" && sec > 0 ? new Date(sec * 1000).toISOString() : null;
const idOf = (v: unknown) => typeof v === "string" ? v : v && typeof v === "object" && typeof (v as { id?: unknown }).id === "string" ? (v as { id: string }).id : null;
const meta = (v: unknown) => Object.fromEntries(Object.entries((v && typeof v === "object" ? v : {}) as Record<string, unknown>).filter(([, x]) => typeof x === "string")) as Record<string, string>;

export function readCheckout(o: Record<string, unknown>): CheckoutInfo {
  const st = o.status === "complete" || o.status === "expired" ? o.status : "open";
  return { id: String(o.id), status: st, paymentStatus: String(o.payment_status ?? ""), mode: String(o.mode ?? ""),
    subscription: idOf(o.subscription), customer: idOf(o.customer), metadata: meta(o.metadata) };
}
/* The period end moved from the subscription to its items in Stripe API version 2025-03-31; both are read. A cancellation
   planned from the billing page is cancel_at_period_end in older versions and cancel_at in newer ones. */
export function readSubscription(o: Record<string, unknown>): SubscriptionInfo {
  const items = (o.items as { data?: Record<string, unknown>[] } | undefined)?.data || [];
  const end = iso(o.current_period_end) ?? iso(items[0]?.current_period_end) ?? iso(o.cancel_at) ?? new Date(0).toISOString();
  return { id: String(o.id), customer: idOf(o.customer), status: String(o.status ?? ""), periodEnd: end,
    cancelAtEnd: o.cancel_at_period_end === true || typeof o.cancel_at === "number", endedAt: iso(o.ended_at), metadata: meta(o.metadata) };
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
    if (!r.ok) throw new Error(`Stripe ${r.status} ${p}: ${(json.error as { message?: string } | undefined)?.message || text.slice(0, 300)}`);
    return json;
  }

  async createCheckout(q: CheckoutRequest) {
    const sub = q.mode === "subscription";
    const o = await this.call("POST", "/v1/checkout/sessions", {
      mode: q.mode,
      line_items: [{ quantity: 1, price_data: { currency: q.currency, unit_amount: q.amount, product_data: { name: q.productName }, ...(sub ? { recurring: { interval: "month" } } : {}) } }],
      success_url: q.successUrl, cancel_url: q.cancelUrl,
      client_reference_id: q.userId,
      ...(q.customer ? { customer: q.customer } : q.email ? { customer_email: q.email } : {}),
      metadata: q.metadata,
      /* The payment methods are the ones turned on in the Stripe Dashboard; Stripe offers in each mode only those that
         work there (Alipay and WeChat Pay cannot renew, so they show for a pass and not for the monthly plan). */
      ...(sub ? { subscription_data: { metadata: q.metadata } } : { payment_intent_data: { metadata: q.metadata } })
    });
    if (typeof o.id !== "string" || typeof o.url !== "string") throw new Error("Stripe did not return a Checkout link");
    return { id: o.id, url: o.url };
  }
  async checkout(id: string) { return readCheckout(await this.call("GET", "/v1/checkout/sessions/" + encodeURIComponent(id))); }
  async expireCheckout(id: string) { await this.call("POST", "/v1/checkout/sessions/" + encodeURIComponent(id) + "/expire", {}); }
  async subscription(id: string) { return readSubscription(await this.call("GET", "/v1/subscriptions/" + encodeURIComponent(id))); }
  async billingPortal(customer: string, returnUrl: string) {
    const o = await this.call("POST", "/v1/billing_portal/sessions", { customer, return_url: returnUrl });
    if (typeof o.url !== "string") throw new Error("Stripe did not return a billing page link");
    return o.url;
  }
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
