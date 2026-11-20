/* Plans and payment (phase 4, DESIGN.md 第四阶段). Which plan a student is on, what it lets them do this month, the cards
   of the settings page (GET /plans), sending them to Stripe Checkout (POST /checkout), and what Stripe tells us back.

   A student is on a paid plan while a monthly subscription is active, or while a pass runs; otherwise on the free plan
   (the first in plans.json). When paid time ends (cancelled, a payment failed, a pass ran out) they are back on the free
   plan straight away and keep everything; recordings then follow the free plan's audioDays, counted from the day the paid
   time ended (audio.ts keptUntil).

   What Stripe says comes from the webhook (POST /api/stripe/webhook). So that a missed webhook does not leave a student
   who paid on the free plan, GET /home and GET /plans also ask Stripe about the student's Checkouts of the last day that
   are still open, and about a subscription whose paid period has passed (refresh). */
import type { Plans } from "../../src/types";
import type { Config } from "./config";
import type { Store, SubscriptionRow, UserRow } from "./db";
import { fail } from "./http/errors";
import { cardById, cards, freeTier, minorUnits, money, nextTier, tierById, type Card, type Tier } from "./plans";
import type { CheckoutInfo, PaymentEvent, Payments } from "./pay/stripe";
import { readCheckout, readSubscription } from "./pay/stripe";
import { localDate, monthOf, shortDate } from "./time";

/* Stripe statuses in which the student has paid for the current period. past_due (a renewal payment failed and Stripe is
   trying again), unpaid, incomplete and canceled are not: the student is on the free plan until it is paid. */
const PAID = new Set(["active", "trialing"]);
/* An active subscription whose period ended this long ago without news from Stripe still counts (the renewal is usually
   paid within the hour); refresh() asks Stripe before then. */
const STALE_MS = 2 * 86400_000;
const RECHECK_MS = 10 * 60_000;
const OPEN_CHECKOUT_MS = 86400_000;   // a Stripe Checkout link works for 24 hours

export interface Entitlement {
  tier: Tier;                 // what the student may do now
  current: string;            // the card shown as "Your plan"
  until: string | null;       // ISO: the paid period renews or ends (subscription), or the pass ends
  renews: boolean;            // a subscription that will renew
  paidEnd: string | null;     // ISO, on the free plan: when paid time last ended
}

export class Billing {
  constructor(private readonly d: { config: Config; store: Store; payments: Payments | null }) {}
  get payments() { return this.d.payments; }
  private get book() { return this.d.config.plans; }
  private paidTier(planId: string) { return tierById(this.book, planId) ?? this.book.plans[1] ?? freeTier(this.book); }

  entitlement(userId: string, at = new Date()): Entitlement {
    const { store } = this.d, now = at.getTime(), sub = store.subscription(userId), pass = store.pass(userId);
    if (sub && PAID.has(sub.status) && Date.parse(sub.period_end) + STALE_MS > now) {
      const tier = this.paidTier(sub.plan);
      return { tier, current: tier.monthly ? tier.id : tier.pass?.id ?? tier.id, until: sub.period_end, renews: !sub.cancel_at_end, paidEnd: null };
    }
    if (pass && Date.parse(pass.until) > now) {
      const tier = this.paidTier(pass.plan);
      return { tier, current: tier.pass?.id ?? tier.id, until: pass.until, renews: false, paidEnd: null };
    }
    const ends = [sub ? sub.ended_at ?? sub.period_end : null, pass?.until ?? null].filter((x): x is string => !!x && Date.parse(x) <= now).sort();
    return { tier: freeTier(this.book), current: freeTier(this.book).id, until: null, renews: false, paidEnd: ends.length ? ends[ends.length - 1] : null };
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
    const ent = this.entitlement(userId, at), cur = this.book.currency, tz = this.d.config.timezone;
    const plans = cards(this.book).map(c => {
      const f = this.features(c.tier);
      if (c.kind === "monthly") f.push("Pay by card, Apple Pay or Google Pay. Renews every month; cancel any time.");
      if (c.kind === "pass") f.push(`Pay once by card, Alipay or WeChat Pay. Does not renew.`);
      if (c.id === ent.current && ent.until) {
        const day = shortDate(localDate(new Date(ent.until), tz), true);
        f.unshift(c.kind === "pass" ? `Paid until ${day}` : ent.renews ? `Renews on ${day}` : `Ends on ${day}`);
      }
      const priceText = c.kind === "free" ? "Free" : c.kind === "monthly" ? `${money(cur, c.tier.monthly!)} / month` : `${money(cur, c.tier.pass!.price)} for ${c.tier.pass!.days} days`;
      return { id: c.id, name: c.kind === "pass" ? c.tier.pass!.name : c.tier.name, priceText, features: f };
    });
    return { plans, current: ent.current };
  }

  /* ---------- POST /checkout ---------- */
  /* -> the Stripe page to send the student to; null when payments are not set up (the front end then says checkout is
     not connected yet). Choosing the free plan while paying every month opens Stripe's billing page, where the
     subscription is cancelled (it runs to the end of the period paid for); a pass simply runs out. */
  async checkout(user: UserRow, cardId: string, webBase: string, at = new Date()): Promise<string | null> {
    const card = cardById(this.book, cardId) ?? fail(404, "This plan does not exist. Reload the page to see the plans.");
    const { store } = this.d, pay = this.payments;
    /* The student's earlier Checkouts that are still open (another tab, a second click) are closed first, so only the
       latest choice can be paid: two monthly plans would both renew. One that was paid meanwhile is applied instead, and
       the rules below see it. */
    if (pay) for (const old of store.openCheckouts(user.id, new Date(at.getTime() - OPEN_CHECKOUT_MS).toISOString())) {
      try { await pay.expireCheckout(old.id); store.closeCheckout(old.id, "expired"); }
      catch (e) {
        console.warn(`[billing] closing checkout ${old.id}: ${(e as Error).message}`);
        try { await this.applyCheckout(await pay.checkout(old.id)); } catch { /* refresh() tries again later */ }
      }
    }
    const ent = this.entitlement(user.id, at), sub = store.subscription(user.id);
    const tz = this.d.config.timezone, day = (iso: string) => shortDate(localDate(new Date(iso), tz), true);
    const back = webBase + "/#/settings";
    const portal = async (s: SubscriptionRow) => {
      if (!pay || !s.customer) return null;
      try { return await pay.billingPortal(s.customer, back); }
      catch (e) { console.warn(`[billing] billing page for ${user.id}: ${(e as Error).message}`); fail(502, "Halfold could not open the billing page just now. Try again in a moment."); }
      return null;
    };
    if (card.id === ent.current) fail(409, `${card.kind === "pass" ? card.tier.pass!.name : card.tier.name} is already your plan.`);
    const subPaid = !!sub && PAID.has(sub.status) && ent.until === sub.period_end;
    if (card.kind === "free") {
      if (subPaid) return portal(sub!);
      fail(409, `Your ${ent.tier.pass?.name ?? ent.tier.name} runs until ${day(ent.until!)} and does not renew. You are back on ${card.tier.name} after that day.`);
    }
    /* A renewal payment failed: the billing page is where the card is changed (or the plan cancelled). */
    if (sub && (sub.status === "past_due" || sub.status === "unpaid")) return portal(sub);
    if (card.kind === "monthly") {
      if (subPaid) return portal(sub!);   // another monthly plan: changed on the billing page
      if (ent.until) fail(409, `You have ${ent.tier.name} until ${day(ent.until)} from your ${ent.tier.pass?.name ?? "pass"}. Choose the monthly plan after that day.`);
    }
    if (card.kind === "pass" && subPaid) fail(409, `You already pay for ${ent.tier.name} every month. To pay for a semester instead, choose ${freeTier(this.book).name} to cancel the monthly plan, then come back when it ends.`);
    if (!pay) return null;
    return this.startCheckout(user, card, back, sub);
  }
  private async startCheckout(user: UserRow, card: Card, back: string, sub: SubscriptionRow | undefined) {
    const t = card.tier, monthly = card.kind === "monthly", { store } = this.d;
    const r = await this.payments!.createCheckout({
      mode: monthly ? "subscription" : "payment",
      productName: monthly ? `Halfold ${t.name}, monthly` : `Halfold ${t.pass!.name}, ${t.pass!.days} days`,
      currency: this.book.currency.toLowerCase(), amount: minorUnits(monthly ? t.monthly! : t.pass!.price),
      successUrl: back, cancelUrl: back, userId: user.id,
      customer: user.stripe_customer ?? sub?.customer ?? null, email: user.email,
      metadata: { user: user.id, plan: t.id, card: card.id }
    }).catch(e => { console.warn(`[billing] checkout for ${user.id}: ${(e as Error).message}`); return fail(502, "Halfold could not start the payment just now. Try again in a moment."); });
    store.addCheckout({ id: r.id, user_id: user.id, card: card.id, mode: monthly ? "subscription" : "payment" });
    return r.url;
  }

  /* ---------- what Stripe tells us ---------- */
  /* A Checkout, from the webhook or from asking Stripe. Each one is applied once, however often the news comes. */
  async applyCheckout(c: CheckoutInfo, failed = false) {
    const { store } = this.d;
    let row = store.checkout(c.id);
    if (!row) {
      /* Started on another copy of the database, or the row was lost: the metadata says whose it is. */
      const uid = c.metadata.user, card = c.metadata.card;
      if (!uid || !store.user(uid) || !card) return;
      store.addCheckout({ id: c.id, user_id: uid, card, mode: c.mode === "subscription" ? "subscription" : "payment" });
      row = store.checkout(c.id)!;
    }
    if (row.status !== "open") return;
    if (c.status === "expired") { store.closeCheckout(c.id, "expired"); return; }
    if (c.status !== "complete") return;
    if (row.mode === "subscription") {
      if (c.subscription) await this.syncSubscription(c.subscription, row.user_id);
      store.closeCheckout(c.id, "complete");
      return;
    }
    /* A pass. Alipay and WeChat Pay are paid at once; a payment still on its way (paymentStatus "unpaid") waits for
       checkout.session.async_payment_succeeded, or fails. */
    if (c.paymentStatus === "paid" || c.paymentStatus === "no_payment_required") {
      const card = cardById(this.book, row.card), tier = card?.tier ?? this.paidTier(c.metadata.plan || "");
      const days = card?.kind === "pass" ? tier.pass!.days : tier.pass?.days ?? 30;
      store.closeCheckout(c.id, "complete", () => { store.extendPass(row!.user_id, tier.id, days); });
    } else if (failed) store.closeCheckout(c.id, "failed");
  }

  /* The subscription as Stripe has it now (events can arrive out of order, so the event's copy is not trusted). */
  async syncSubscription(subId: string, userHint?: string) {
    const { store } = this.d, s = await this.payments!.subscription(subId);
    const byMeta = s.metadata.user && store.user(s.metadata.user) ? s.metadata.user : null;
    const userId = byMeta ?? store.userBySubscription(s.id)?.user_id ?? (s.customer ? store.userByCustomer(s.customer)?.id : undefined) ?? userHint;
    if (!userId) { console.warn(`[billing] subscription ${s.id} belongs to no student here`); return; }
    const old = store.subscription(userId);
    /* News about an older subscription does not replace a newer one that is paid. */
    if (old && old.sub_id !== s.id && PAID.has(old.status) && !PAID.has(s.status)) return;
    if (old && old.sub_id !== s.id && PAID.has(old.status) && PAID.has(s.status))
      console.warn(`[billing] student ${userId} now has two paid subscriptions (${old.sub_id} and ${s.id}): cancel one in the Stripe Dashboard and refund it`);
    store.saveSubscription({
      user_id: userId, sub_id: s.id, customer: s.customer, plan: s.metadata.plan || old?.plan || this.paidTier("").id, status: s.status,
      period_end: s.periodEnd, cancel_at_end: s.cancelAtEnd ? 1 : 0, ended_at: s.endedAt, checked_at: new Date().toISOString()
    });
  }

  async handle(e: PaymentEvent) {
    if (e.type.startsWith("checkout.session.")) return this.applyCheckout(readCheckout(e.object), e.type === "checkout.session.async_payment_failed");
    if (e.type.startsWith("customer.subscription.")) return this.syncSubscription(readSubscription(e.object).id);
  }

  /* GET /home and GET /plans: open Checkouts of the last day, and a paid period that has passed. Never fails: when
     Stripe cannot be reached, the student sees what the database has. */
  async refresh(userId: string, at = new Date()) {
    const pay = this.payments, { store } = this.d;
    if (!pay) return;
    /* The three newest: a student who opened Checkout several times and paid in none of them does not slow every page. */
    for (const c of store.openCheckouts(userId, new Date(at.getTime() - OPEN_CHECKOUT_MS).toISOString()).slice(-3)) {
      try { await this.applyCheckout(await pay.checkout(c.id)); }
      catch (e) { console.warn(`[billing] checking checkout ${c.id}: ${(e as Error).message}`); }
    }
    const sub = store.subscription(userId);
    if (sub && PAID.has(sub.status) && Date.parse(sub.period_end) <= at.getTime() && at.getTime() - Date.parse(sub.checked_at) > RECHECK_MS) {
      try { await this.syncSubscription(sub.sub_id, userId); }
      catch (e) { console.warn(`[billing] checking subscription ${sub.sub_id}: ${(e as Error).message}`); store.subscriptionChecked(userId); }
    }
  }
}
