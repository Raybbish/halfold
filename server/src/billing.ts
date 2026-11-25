/* Plans and payment (phase 4, DESIGN.md 第四阶段; one-time payments and refunds from 2026-11-24, DESIGN.md 一次付清和退款).
   Which plan a student is on, what it lets them do this month, the cards of the settings page (GET /plans), sending them
   to Stripe Checkout (POST /checkout), and what Stripe tells us back.

   Every paid card is a pass: paid once for a number of days, never renewed. A student is on a paid plan while their paid
   time runs; otherwise on the free plan (the first in plans.json). When it ends (it ran out, or a refund ended it) they
   are back on the free plan straight away and keep everything; recordings then follow the free plan's audioDays,
   counted from the day the paid time ended (audio.ts keptUntil). Buying a pass of the plan the student already has adds
   its days after the ones they have.

   A refund takes back paid time in proportion to the money given back: a full refund all the days that payment bought,
   half the money half the days. They come off the end of the paid time, and at the earliest it ends now (recordings
   are never deleted because of a refund). A dispute the student wins at their bank counts as a full refund.

   What Stripe says comes from the webhook (POST /api/stripe/webhook). So that a missed webhook does not leave a student
   who paid on the free plan, GET /home and GET /plans also ask Stripe about the student's Checkouts of the last day that
   are still open (refresh). */
import type { Plans } from "../../src/types";
import type { Config } from "./config";
import type { CheckoutRow, Store, UserRow } from "./db";
import { fail } from "./http/errors";
import { cardById, cards, freeTier, minorUnits, money, nextTier, tierById, type Card, type Tier } from "./plans";
import type { CheckoutInfo, PaymentEvent, Payments } from "./pay/stripe";
import { readCharge, readCheckout, readDispute } from "./pay/stripe";
import { localDate, monthOf, shortDate } from "./time";

const OPEN_CHECKOUT_MS = 86400_000;   // a Stripe Checkout link works for 24 hours
const DAY = 86400_000;
const days = (n: number) => n === 1 ? "1 day" : `${n} days`;

export interface Entitlement {
  tier: Tier;                 // what the student may do now
  current: string;            // the card shown as "Your plan"
  until: string | null;       // ISO: when the paid time ends
  paidEnd: string | null;     // ISO, on the free plan: when paid time last ended
}

export class Billing {
  constructor(private readonly d: { config: Config; store: Store; payments: Payments | null }) {}
  get payments() { return this.d.payments; }
  private get book() { return this.d.config.plans; }
  private paidTier(planId: string) { return tierById(this.book, planId) ?? this.book.plans[1] ?? freeTier(this.book); }

  entitlement(userId: string, at = new Date()): Entitlement {
    const pass = this.d.store.pass(userId);
    if (pass && Date.parse(pass.until) > at.getTime()) {
      const tier = this.paidTier(pass.plan), card = pass.card ? cardById(this.book, pass.card) : undefined;
      return { tier, current: card && card.tier.id === tier.id ? card.id : tier.passes?.[0]?.id ?? tier.id, until: pass.until, paidEnd: null };
    }
    return { tier: freeTier(this.book), current: freeTier(this.book).id, until: null, paidEnd: pass?.until ?? null };
  }

  /* ---------- what the plan allows ---------- */
  private month(at: Date) { return monthOf(at, this.d.config.timezone); }
  private more(t: Tier, what: string, next: string) {
    const up = nextTier(this.book, t);
    return up ? `Choose ${up.name} in Settings for ${what}, or wait until ${shortDate(next)}.` : `More are available from ${shortDate(next)}.`;
  }
  /* The lectures counted this month and the plan's limit (GET /home usage); null when the plan has no limit. */
  lectureUsage(userId: string, at = new Date()): { used: number; limit: number } | null {
    const n = this.entitlement(userId, at).tier.lecturesPerMonth;
    return n === null ? null : { used: this.d.store.lecturesUsed(userId, this.month(at).start.toISOString()), limit: n };
  }
  /* POST /lectures: a lecture over the month's limit is refused (429) before anything is recorded or uploaded. */
  checkLecture(userId: string, at = new Date()) {
    const u = this.lectureUsage(userId, at);
    if (!u || u.used < u.limit) return;
    const { tier } = this.entitlement(userId, at), n = u.limit;
    fail(429, `You have used the ${n === 1 ? "1 lecture" : n + " lectures"} that ${tier.name} includes this month. ${this.more(tier, "more lectures", this.month(at).next)}`);
  }
  /* POST /courses/:id/review-pack, when it would make a new pack from notes. */
  checkPack(userId: string, at = new Date()) {
    const { tier } = this.entitlement(userId, at), n = tier.packsPerMonth;
    if (n === null) return;
    const m = this.month(at);
    if (this.d.store.packsUsed(userId, m.start.toISOString()) >= n)
      fail(429, `You have made the ${n === 1 ? "1 review pack" : n + " review packs"} that ${tier.name} includes this month. ${this.more(tier, "more review packs", m.next)}`);
  }
  dailyLiveMinutes(userId: string, at = new Date()) { return this.entitlement(userId, at).tier.dailyLiveMinutes; }

  /* ---------- GET /plans ---------- */
  features(t: Tier) {
    const n = (k: number | null, one: string, many: string, none: string) => k === null ? none : k === 1 ? `1 ${one}` : `${k} ${many}`;
    return [
      `${t.dailyLiveMinutes} minutes of live recording a day`,
      n(t.lecturesPerMonth, "lecture a month", "lectures a month", "Unlimited lectures"),
      n(t.packsPerMonth, "review pack a month", "review packs a month", "Unlimited review packs"),
      t.audioDays === null ? "Recordings kept for good" : `Recordings kept for ${t.audioDays} days`
    ];
  }
  plans(userId: string, at = new Date()): Plans {
    const ent = this.entitlement(userId, at), cur = this.book.currency;
    const day = ent.until ? shortDate(localDate(new Date(ent.until), this.d.config.timezone), true) : "";
    const plans = cards(this.book).map(c => {
      const f = this.features(c.tier);
      if (c.kind === "free") return { id: c.id, name: c.tier.name, priceText: "Free", features: f };
      f.push("Pay once by card, Alipay or WeChat Pay. Does not renew.");
      /* The paid time running: on the card last bought, and on the other passes of that plan, which add to it. */
      if (ent.until && c.id === ent.current) f.unshift(`Paid until ${day}`);
      else if (ent.until && c.tier.id === ent.tier.id) f.unshift(`Adds ${days(c.pass.days)} after ${day}`);
      return { id: c.id, name: c.pass.name, priceText: `${money(cur, c.pass.price)} for ${days(c.pass.days)}`, features: f };
    });
    return { plans, current: ent.current };
  }

  /* ---------- POST /checkout ---------- */
  /* -> the Stripe Checkout page to send the student to; null when payments are not set up (the front end then says
     checkout is not connected yet). Nothing renews, so there is nothing to cancel: choosing the free plan while paid
     time runs only says when it ends. */
  async checkout(user: UserRow, cardId: string, webBase: string, at = new Date()): Promise<string | null> {
    const card = cardById(this.book, cardId) ?? fail(404, "This plan does not exist. Reload the page to see the plans.");
    const { store } = this.d, pay = this.payments;
    /* The student's earlier Checkouts that are still open (another tab, a second click) are closed first, so only the
       latest choice can be paid, not two by mistake. One that was paid meanwhile is applied instead, and the rules below
       see it. */
    if (pay) for (const old of store.openCheckouts(user.id, new Date(at.getTime() - OPEN_CHECKOUT_MS).toISOString())) {
      try { await pay.expireCheckout(old.id); store.closeCheckout(old.id, "expired"); }
      catch (e) {
        console.warn(`[billing] closing checkout ${old.id}: ${(e as Error).message}`);
        try { await this.applyCheckout(await pay.checkout(old.id)); } catch { /* refresh() tries again later */ }
      }
    }
    const ent = this.entitlement(user.id, at);
    const day = (iso: string) => shortDate(localDate(new Date(iso), this.d.config.timezone), true);
    if (card.kind === "free") {
      if (!ent.until) fail(409, `${card.tier.name} is already your plan.`);
      const now = cardById(this.book, ent.current), name = now?.kind === "pass" ? now.pass.name : ent.tier.name;
      fail(409, `Your ${name} runs until ${day(ent.until!)} and does not renew. You are back on ${card.tier.name} after that day.`);
    }
    if (card.kind !== "pass") return null;
    /* Paid time of another plan runs: one plan at a time, so no day already paid for is lost. (Only with two paid plans.) */
    if (ent.until && ent.tier.id !== card.tier.id) fail(409, `You have ${ent.tier.name} until ${day(ent.until)}. You can choose ${card.pass.name} after that day.`);
    if (!pay) return null;
    return this.startCheckout(user, card, webBase + "/#/settings");
  }
  private async startCheckout(user: UserRow, card: Extract<Card, { kind: "pass" }>, back: string) {
    const { pass, tier } = card;
    const r = await this.payments!.createCheckout({
      productName: `Halfold ${pass.name}, ${days(pass.days)}`,
      currency: this.book.currency.toLowerCase(), amount: minorUnits(pass.price),
      successUrl: back, cancelUrl: back, userId: user.id, email: user.email,
      metadata: { user: user.id, plan: tier.id, card: card.id, days: String(pass.days) }
    }).catch(e => { console.warn(`[billing] checkout for ${user.id}: ${(e as Error).message}`); return fail(502, "Halfold could not start the payment just now. Try again in a moment."); });
    this.d.store.addCheckout({ id: r.id, user_id: user.id, card: card.id, plan: tier.id, days: pass.days });
    return r.url;
  }

  /* ---------- what Stripe tells us ---------- */
  /* What a Checkout bought: fixed when it was made, so a price or length changed in plans.json since does not change it.
     A Checkout made before 2026-11-24 has neither: from its card, else 30 days of the first paid plan. */
  private bought(row: CheckoutRow) {
    const card = cardById(this.book, row.card);
    return { plan: row.plan ?? card?.tier.id ?? this.paidTier("").id, days: row.days ?? (card?.kind === "pass" ? card.pass.days : 30) };
  }

  /* A Checkout, from the webhook or from asking Stripe. Each one is applied once, however often the news comes. */
  async applyCheckout(c: CheckoutInfo, failed = false) {
    const { store } = this.d;
    let row = store.checkout(c.id);
    if (!row) {
      /* Started on another copy of the database, or the row was lost: the metadata says whose it is and what it bought. */
      const uid = c.metadata.user, cardId = c.metadata.card;
      if (!uid || !store.user(uid) || !cardId) return;
      const card = cardById(this.book, cardId), n = Number(c.metadata.days);
      store.addCheckout({ id: c.id, user_id: uid, card: cardId, plan: c.metadata.plan || card?.tier.id || null,
        days: Number.isInteger(n) && n > 0 ? n : card?.kind === "pass" ? card.pass.days : null });
      row = store.checkout(c.id)!;
    }
    if (row.status !== "open") return;
    if (c.status === "expired") { store.closeCheckout(c.id, "expired"); return; }
    if (c.status !== "complete") return;
    /* Cards, Alipay and WeChat Pay are paid at once; a payment still on its way (paymentStatus "unpaid") waits for
       checkout.session.async_payment_succeeded, or fails. */
    if (c.paymentStatus === "paid" || c.paymentStatus === "no_payment_required") {
      const { plan, days: n } = this.bought(row), r = row;
      store.closeCheckout(c.id, "complete", () => { store.extendPass(r.user_id, plan, n, new Date(), r.card); store.setPayment(c.id, c.paymentIntent); });
    } else if (failed) store.closeCheckout(c.id, "failed");
  }

  /* Money given back for a payment (share: the part given back in all, 0 to 1): a refund made in the Stripe Dashboard, in
     full or in part, or a dispute lost. The same share of the days it bought comes off (Store.takeBack). */
  async moneyBack(paymentIntent: string | null, share: number, what: string) {
    if (!paymentIntent) return;
    const { store } = this.d;
    let row = store.checkoutByPayment(paymentIntent);
    /* Paid, but this server never heard (the webhook was missed and the student did not come back): the Checkout is
       applied first, so the days it bought are there to take back, and a later look at it gives nothing. */
    if (!row && this.payments) {
      const c = await this.payments.checkoutOfPayment(paymentIntent);
      if (c) { await this.applyCheckout(c); row = store.checkoutByPayment(paymentIntent); }
    }
    if (!row) { console.warn(`[billing] ${what} for payment ${paymentIntent}, which paid for no plan here`); return; }
    const { plan, days: n } = this.bought(row), r = store.takeBack(row.id, share, plan, n);
    if (r) console.log(`[billing] ${what}: student ${row.user_id}, ${row.card}, ${Math.round(Math.min(1, share) * 100)}% given back; ${(r.taken / DAY).toFixed(1)} days taken off, paid until ${r.until ?? "never"}`);
  }

  async handle(e: PaymentEvent) {
    if (e.type.startsWith("checkout.session.")) return this.applyCheckout(readCheckout(e.object), e.type === "checkout.session.async_payment_failed");
    /* Sent for every refund, in full or in part, with all that has been given back so far. */
    if (e.type === "charge.refunded") { const ch = readCharge(e.object); return this.moneyBack(ch.paymentIntent, ch.amount > 0 ? ch.refunded / ch.amount : 0, "refund"); }
    if (e.type === "charge.dispute.closed") { const d = readDispute(e.object); if (d.status === "lost") return this.moneyBack(d.paymentIntent, 1, "dispute lost"); }
  }

  /* GET /home and GET /plans: the student's open Checkouts of the last day. Never fails: when Stripe cannot be reached,
     the student sees what the database has. */
  async refresh(userId: string, at = new Date()) {
    const pay = this.payments, { store } = this.d;
    if (!pay) return;
    /* The three newest: a student who opened Checkout several times and paid in none of them does not slow every page. */
    for (const c of store.openCheckouts(userId, new Date(at.getTime() - OPEN_CHECKOUT_MS).toISOString()).slice(-3)) {
      try { await this.applyCheckout(await pay.checkout(c.id)); }
      catch (e) { console.warn(`[billing] checking checkout ${c.id}: ${(e as Error).message}`); }
    }
  }
}
