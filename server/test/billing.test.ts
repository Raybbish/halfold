/* Plans and payment (phase 4) with plans.json as committed: GET /plans, POST /checkout, what Stripe tells the server
   (webhook, or asking Stripe when the student comes back), what each plan allows, and how long recordings are kept when
   a plan ends. Stripe is stubbed (StubPayments); the real requests are checked in payments.test.ts. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { ErrorReplySchema, HomeSchema, PlansSchema, UrlReplySchema } from "../src/shapes";
import { addDays, sweepAudio } from "../src/audio";
import { localDate, monthOf, shortDate } from "../src/time";
import { readyLecture, setup, type TestServer } from "./helpers";

const isError = (r: { body: unknown }) => ErrorReplySchema.parse(r.body);
const ORIGIN = "https://app.example.com";
const plansOf = async (s: TestServer, token: string) => PlansSchema.parse((await s.call("GET", "/plans", { token })).body);
const home = async (s: TestServer, token: string) => HomeSchema.parse((await s.call("GET", "/home", { token })).body);
const choose = (s: TestServer, token: string, planId: string) => s.call("POST", "/checkout", { token, json: { planId }, headers: { Origin: ORIGIN } });
const uid = (s: TestServer, code = "CODE-A") => s.store.userByCode(code)!.id;
const webhook = (s: TestServer, type: string, object: unknown, at?: Date, secret?: string) => {
  const { payload, signature } = s.payments.signed(type, object, at, secret);
  return s.call("POST", "/stripe/webhook", { body: payload, headers: { "Content-Type": "application/json", "Stripe-Signature": signature } });
};
/* A Checkout as Stripe sends it in an event. */
const session = (s: TestServer, id: string, paymentStatus = "paid") => {
  const c = s.payments.checkouts.get(id)!;
  return { id, object: "checkout.session", status: "complete", payment_status: paymentStatus, mode: c.mode, subscription: c.subscription, customer: c.customer, metadata: c.metadata };
};
const day = (s: TestServer, iso: string) => shortDate(localDate(new Date(iso), s.config.timezone), true);
const DAY = 86400_000;

test("GET /plans: Free, Plus every month and Plus for a semester, as plans.json says; the free plan's usage on /home", async t => {
  const s = setup({ realPlans: true }); t.after(() => s.close());
  const token = await s.signIn();
  assert.deepEqual(await plansOf(s, token), { current: "free", plans: [
    { id: "free", name: "Free", priceText: "Free", features: ["90 minutes of live recording a day", "4 lectures a month", "1 review pack a month", "Recordings kept for 30 days"] },
    { id: "plus", name: "Plus", priceText: "HK$98 / month", features: ["240 minutes of live recording a day", "40 lectures a month", "Unlimited review packs", "Recordings kept for good",
      "Pay by card, Apple Pay or Google Pay. Renews every month; cancel any time."] },
    { id: "plus-semester", name: "Plus for a semester", priceText: "HK$348 for 120 days", features: ["240 minutes of live recording a day", "40 lectures a month", "Unlimited review packs",
      "Recordings kept for good", "Pay once by card, Alipay or WeChat Pay. Does not renew."] }
  ] });
  assert.deepEqual((await home(s, token)).usage, { minutesToday: 0, minutesLimit: 90, audioDays: 30, lecturesThisMonth: 0, lecturesLimit: 4 });
});

test("Plus every month: Stripe Checkout; the plan starts when Stripe says it is paid; cancelling on the billing page; back to Free", async t => {
  const s = setup({ realPlans: true }); t.after(() => s.close());
  const token = await s.signIn(), me = uid(s);
  const r = await choose(s, token, "plus");
  assert.equal(r.status, 200); assert.deepEqual(UrlReplySchema.parse(r.body), { url: "https://checkout.stripe.test/cs_test_1" });
  assert.deepEqual(s.payments.requests[0], {
    mode: "subscription", productName: "Halfold Plus, monthly", currency: "hkd", amount: 9800,
    successUrl: ORIGIN + "/#/settings", cancelUrl: ORIGIN + "/#/settings", userId: me, customer: null, email: null,
    metadata: { user: me, plan: "plus", card: "plus" }
  });
  /* Not paid yet (the student closed the page): still Free. */
  assert.equal((await plansOf(s, token)).current, "free");

  /* Paid. No webhook yet: coming back to the settings page, the server asks Stripe about the open Checkout. */
  s.payments.pay("cs_test_1");
  assert.deepEqual((await home(s, token)).usage, { minutesToday: 0, minutesLimit: 240, lecturesThisMonth: 0, lecturesLimit: 40 });
  const sub = [...s.payments.subs.values()][0];
  const paid = await plansOf(s, token);
  assert.equal(paid.current, "plus");
  assert.equal(paid.plans[1].features![0], `Renews on ${day(s, sub.periodEnd)}`);
  assert.equal(s.store.checkout("cs_test_1")!.status, "complete");
  /* The webhook for the same Checkout comes later: nothing changes, and Stripe is not asked again about it. */
  s.payments.fetched.length = 0;
  assert.equal((await webhook(s, "checkout.session.completed", session(s, "cs_test_1"))).status, 200);
  assert.equal((await plansOf(s, token)).current, "plus"); assert.deepEqual(s.payments.fetched, []);

  /* Choosing Free opens Stripe's billing page, where the student cancels. */
  const free = await choose(s, token, "free");
  assert.deepEqual(free.body, { url: `https://billing.stripe.test/${sub.customer}` });
  assert.deepEqual(s.payments.portals, [{ customer: sub.customer, returnUrl: ORIGIN + "/#/settings" }]);
  s.payments.setSubscription(sub.id, { cancelAtEnd: true });
  assert.equal((await webhook(s, "customer.subscription.updated", { id: sub.id, object: "subscription" })).status, 200);
  const ending = await plansOf(s, token);
  assert.equal(ending.current, "plus"); assert.equal(ending.plans[1].features![0], `Ends on ${day(s, sub.periodEnd)}`);

  /* The period ends: Free again, everything kept. */
  const ended = new Date().toISOString();
  s.payments.setSubscription(sub.id, { status: "canceled", endedAt: ended });
  await webhook(s, "customer.subscription.deleted", { id: sub.id, object: "subscription" });
  assert.equal((await plansOf(s, token)).current, "free");
  assert.equal((await home(s, token)).usage!.minutesLimit, 90);
  assert.equal(s.billing.entitlement(me).paidEnd, ended);
  /* Subscribing again: the same Stripe customer. */
  await choose(s, token, "plus");
  assert.equal(s.payments.requests[1].customer, sub.customer);
});

test("Plus for a semester: paid once (the webhook may come twice); 120 days, then back to Free", async t => {
  const s = setup({ realPlans: true }); t.after(() => s.close());
  const token = await s.signIn(), me = uid(s);
  s.store.bindEmail(me, "ann@example.edu");
  assert.equal((await choose(s, token, "plus-semester")).body.url, "https://checkout.stripe.test/cs_test_1");
  const q = s.payments.requests[0];
  assert.deepEqual([q.mode, q.amount, q.productName, q.email, q.metadata], ["payment", 34800, "Halfold Plus for a semester, 120 days", "ann@example.edu", { user: me, plan: "plus", card: "plus-semester" }]);
  s.payments.pay("cs_test_1");
  for (let i = 0; i < 2; i++) assert.equal((await webhook(s, "checkout.session.completed", session(s, "cs_test_1"))).status, 200);
  const until = s.store.pass(me)!.until;
  assert.ok(Math.abs(Date.parse(until) - (Date.now() + 120 * DAY)) < 60_000, until);
  const p = await plansOf(s, token);
  assert.equal(p.current, "plus-semester"); assert.equal(p.plans[2].features![0], `Paid until ${day(s, until)}`);

  /* A pass does not renew: nothing to cancel, and no monthly plan on top of it. */
  const free = await choose(s, token, "free");
  assert.equal(free.status, 409);
  assert.equal(isError(free).message, `Your Plus for a semester runs until ${day(s, until)} and does not renew. You are back on Free after that day.`);
  const monthly = await choose(s, token, "plus");
  assert.equal(monthly.status, 409);
  assert.equal(isError(monthly).message, `You have Plus until ${day(s, until)} from your Plus for a semester. Choose the monthly plan after that day.`);
  assert.equal(isError(await choose(s, token, "plus-semester")).message, "Plus for a semester is already your plan.");

  s.store.db.prepare("UPDATE passes SET until = ?").run(new Date(Date.now() - 1000).toISOString());
  assert.equal((await plansOf(s, token)).current, "free");
});

test("a payment still on its way starts the plan when it arrives; a failed one never does", async t => {
  const s = setup({ realPlans: true }); t.after(() => s.close());
  const a = await s.signIn(), b = await s.signIn("CODE-B");
  await choose(s, a, "plus-semester"); s.payments.pay("cs_test_1", { paymentStatus: "unpaid" });
  await webhook(s, "checkout.session.completed", session(s, "cs_test_1", "unpaid"));
  assert.equal((await plansOf(s, a)).current, "free");
  await webhook(s, "checkout.session.async_payment_succeeded", session(s, "cs_test_1", "paid"));
  assert.equal((await plansOf(s, a)).current, "plus-semester");

  await choose(s, b, "plus-semester"); s.payments.pay("cs_test_2", { paymentStatus: "unpaid" });
  await webhook(s, "checkout.session.async_payment_failed", session(s, "cs_test_2", "unpaid"));
  assert.equal(s.store.checkout("cs_test_2")!.status, "failed");
  assert.equal((await plansOf(s, b)).current, "free");
  /* An abandoned Checkout expires. */
  await choose(s, b, "plus");
  await webhook(s, "checkout.session.expired", { ...session(s, "cs_test_3", "unpaid"), status: "expired" });
  assert.equal(s.store.checkout("cs_test_3")!.status, "expired");
});

test("POST /checkout: what goes to Stripe, what to the billing page, what is refused; no Stripe key: url null", async t => {
  const s = setup({ realPlans: true }); t.after(() => s.close());
  const token = await s.signIn(), me = uid(s);
  const unknown = await choose(s, token, "gold");
  assert.equal(unknown.status, 404); assert.equal(isError(unknown).message, "This plan does not exist. Reload the page to see the plans.");
  assert.equal((await s.call("POST", "/checkout", { token, json: {} })).status, 400);
  const already = await choose(s, token, "free");
  assert.equal(already.status, 409); assert.equal(isError(already).message, "Free is already your plan.");
  s.payments.error = new Error("Stripe 500");
  const down = await choose(s, token, "plus");
  assert.equal(down.status, 502); assert.equal(isError(down).message, "Halfold could not start the payment just now. Try again in a moment.");
  s.payments.error = null;

  await choose(s, token, "plus"); s.payments.pay("cs_test_1"); await plansOf(s, token);
  const pass = await choose(s, token, "plus-semester");
  assert.equal(pass.status, 409);
  assert.equal(isError(pass).message, "You already pay for Plus every month. To pay for a semester instead, choose Free to cancel the monthly plan, then come back when it ends.");
  /* A renewal payment failed (past_due): the billing page, to change the card. */
  const sub = [...s.payments.subs.values()][0];
  s.payments.setSubscription(sub.id, { status: "past_due" });
  await webhook(s, "customer.subscription.updated", { id: sub.id });
  assert.equal((await plansOf(s, token)).current, "free");
  assert.equal((await choose(s, token, "plus")).body.url, `https://billing.stripe.test/${sub.customer}`);
  s.payments.error = new Error("Stripe 500");
  assert.equal(isError(await choose(s, token, "plus")).message, "Halfold could not open the billing page just now. Try again in a moment.");
  assert.equal(s.store.subscription(me)!.status, "past_due");

  const off = setup({ realPlans: true, payments: false }); t.after(() => off.close());
  const ot = await off.signIn();
  assert.deepEqual((await choose(off, ot, "plus")).body, { url: null });
  assert.equal((await plansOf(off, ot)).plans.length, 3);
  assert.equal((await off.call("POST", "/stripe/webhook", { body: "{}" })).status, 404);
});

test("a newer Checkout closes the student's older open ones; one paid meanwhile is applied, not bought twice", async t => {
  const s = setup({ realPlans: true }); t.after(() => s.close());
  const token = await s.signIn();
  await choose(s, token, "plus");
  assert.equal((await choose(s, token, "plus-semester")).body.url, "https://checkout.stripe.test/cs_test_2");
  assert.deepEqual(s.payments.expired, ["cs_test_1"]);
  assert.equal(s.store.checkout("cs_test_1")!.status, "expired");
  /* The first tab cannot be paid now. The second was paid in another tab before the student chose again: it is applied
     (closing it at Stripe fails), and the new choice is checked against it. Stripe is not asked first here, as GET /home
     and GET /plans do, so this is the only place that sees it. */
  s.payments.pay("cs_test_2");
  const monthly = await s.billing.checkout(s.store.userByCode("CODE-A")!, "plus", ORIGIN).catch(e => e as Error);
  assert.match((monthly as Error).message, /^You have Plus until .* from your Plus for a semester\. Choose the monthly plan after that day\.$/);
  assert.equal(s.store.checkout("cs_test_2")!.status, "complete");
  assert.equal((await plansOf(s, token)).current, "plus-semester");
  /* Same for a monthly plan: no second subscription. */
  const b = await s.signIn("CODE-B");
  await choose(s, b, "plus"); s.payments.pay("cs_test_3");
  const again = await s.billing.checkout(s.store.userByCode("CODE-B")!, "plus", ORIGIN).catch(e => e as Error);
  assert.equal((again as Error).message, "Plus is already your plan.");
  assert.equal(s.payments.requests.length, 3);
});

test("the webhook takes only Stripe's signed, recent events; one about a Checkout this database does not know is applied by its metadata", async t => {
  const s = setup({ realPlans: true }); t.after(() => s.close());
  const token = await s.signIn(), me = uid(s);
  await choose(s, token, "plus-semester"); s.payments.pay("cs_test_1");
  const ev = session(s, "cs_test_1");
  assert.equal((await s.call("POST", "/stripe/webhook", { body: JSON.stringify({ type: "checkout.session.completed", data: { object: ev } }) })).status, 400);
  assert.equal((await webhook(s, "checkout.session.completed", ev, undefined, "whsec_wrong")).status, 400);
  assert.equal((await webhook(s, "checkout.session.completed", ev, new Date(Date.now() - 10 * 60_000))).status, 400);
  assert.equal(s.store.pass(me), undefined);
  assert.equal((await webhook(s, "invoice.created", { id: "in_1" })).status, 200);   // not used: ignored

  const lost = { id: "cs_elsewhere", object: "checkout.session", status: "complete", payment_status: "paid", mode: "payment", metadata: { user: me, plan: "plus", card: "plus-semester" } };
  assert.equal((await webhook(s, "checkout.session.completed", lost)).status, 200);
  assert.equal((await plansOf(s, token)).current, "plus-semester");
  assert.equal((await webhook(s, "checkout.session.completed", { ...lost, id: "cs_nobody", metadata: {} })).status, 200);
  assert.equal(s.store.checkout("cs_nobody"), undefined);
});

test("a paid period that passed without a webhook: GET /home asks Stripe; when Stripe cannot be reached, the student sees what is known", async t => {
  const s = setup({ realPlans: true }); t.after(() => s.close());
  const token = await s.signIn(), me = uid(s);
  await choose(s, token, "plus"); s.payments.pay("cs_test_1"); await home(s, token);
  const sub = [...s.payments.subs.values()][0], hourAgo = new Date(Date.now() - 3600_000).toISOString();
  /* Renewed at Stripe; the webhook was missed. */
  s.payments.setSubscription(sub.id, { periodEnd: new Date(Date.now() + 30 * DAY).toISOString() });
  s.store.db.prepare("UPDATE subscriptions SET period_end = ?, checked_at = ?").run(hourAgo, hourAgo);
  assert.equal((await home(s, token)).usage!.minutesLimit, 240);
  assert.equal(s.store.subscription(me)!.period_end, s.payments.subs.get(sub.id)!.periodEnd);
  /* Ended at Stripe; the webhook was missed. */
  s.payments.setSubscription(sub.id, { status: "canceled", endedAt: hourAgo });
  s.store.db.prepare("UPDATE subscriptions SET period_end = ?, checked_at = ?").run(hourAgo, hourAgo);
  assert.equal((await home(s, token)).usage!.minutesLimit, 90);
  /* Stripe down: the page still opens. */
  s.payments.error = new Error("ECONNRESET");
  await choose(s, token, "plus-semester").catch(() => null);
  assert.equal((await s.call("GET", "/plans", { token })).status, 200);
  assert.equal((await s.call("GET", "/home", { token })).status, 200);
});

test("the free plan's limits: lectures a month (copies of shared notes are free), review packs a month, live minutes a day; Plus lifts them", async t => {
  const s = setup({ realPlans: true }); t.after(() => s.close());
  const token = await s.signIn(), me = uid(s), next = shortDate(monthOf(new Date(), s.config.timezone).next);
  const ids: string[] = [];
  for (let i = 0; i < 3; i++) ids.push(await readyLecture(s, token, { title: "L" + i }));
  const courseId = s.store.lecture(ids[0])!.course_id;
  const add = (source = "upload") => s.call("POST", "/lectures", { token, json: { courseId, title: "New", language: "en", source } });
  /* The fourth is being uploaded: it counts already. */
  const fourth = await add();
  assert.equal(fourth.status, 200);
  const usage = (await home(s, token)).usage!;
  assert.deepEqual([usage.lecturesThisMonth, usage.lecturesLimit], [4, 4], "home shows 4 of 4 lectures used");
  const over = await add();
  assert.equal(over.status, 429);
  assert.equal(isError(over).message, `You have used the 4 lectures that Free includes this month. Choose Plus in Settings for more lectures, or wait until ${next}.`);
  /* Deleted before its notes: it no longer counts. Deleted after its notes: it still does. */
  await s.call("DELETE", `/lectures/${fourth.body.id}`, { token });
  const again = await add();
  assert.equal(again.status, 200);
  await s.call("DELETE", `/lectures/${again.body.id}`, { token });
  const fourthReady = await readyLecture(s, token, { courseId });
  await s.call("DELETE", `/lectures/${fourthReady}`, { token });
  assert.equal((await add()).status, 429);
  /* Saving a classmate's shared notes is not a lecture of the month. */
  const bt = await s.signIn("CODE-B"), theirs = await readyLecture(s, bt);
  const link = (await s.call("POST", `/lectures/${theirs}/share`, { token: bt, headers: { Origin: ORIGIN } })).body.url as string;
  assert.equal((await s.call("POST", `/shared/${link.split("/").pop()}/save`, { token })).status, 200);
  assert.equal(s.store.lecturesUsed(me, monthOf(new Date(), s.config.timezone).start.toISOString()), 4);

  /* One review pack a month. Asking while it is made does not count again; a course without notes makes an empty pack, free. */
  let release!: () => void; s.notes.gate = new Promise<void>(r => { release = r; });
  assert.equal((await s.call("POST", `/courses/${courseId}/review-pack`, { token })).status, 200);
  assert.equal((await s.call("POST", `/courses/${courseId}/review-pack`, { token })).status, 200);
  release(); s.notes.gate = null; await s.packs.idle();
  assert.equal((await s.call("GET", `/courses/${courseId}/review-pack`, { token })).body.status, "ready");
  const other = s.store.lecture(ids[1])!.course_id;
  const pack = await s.call("POST", `/courses/${other}/review-pack`, { token });
  assert.equal(pack.status, 429);
  assert.equal(isError(pack).message, `You have made the 1 review pack that Free includes this month. Choose Plus in Settings for more review packs, or wait until ${next}.`);
  const empty = (await s.call("POST", "/courses", { token, json: { code: "MATH 1013", name: "" } })).body.id;
  assert.equal((await s.call("POST", `/courses/${empty}/review-pack`, { token })).status, 200);

  /* 90 minutes of live recording a day. */
  const t0 = await s.call("POST", "/lectures", { token: bt, json: { courseId: s.store.lecture(theirs)!.course_id, title: "Live", language: "en", source: "record" } });
  s.store.db.prepare("UPDATE lectures SET duration = 5400 WHERE id = ?").run(t0.body.id);
  const live = await s.call("POST", "/lectures", { token: bt, json: { courseId: s.store.lecture(theirs)!.course_id, title: "Live 2", language: "en", source: "record" } });
  assert.equal(live.status, 429); assert.equal(isError(live).message, "You have used today's recording minutes. Upload a recording instead, or come back tomorrow.");

  /* Plus (here 30 days given by hand, as npm run plan -- give does) lifts all three. */
  s.store.extendPass(me, "plus", 30); s.store.extendPass(uid(s, "CODE-B"), "plus", 30);
  assert.equal((await add()).status, 200);
  assert.equal((await s.call("POST", `/courses/${other}/review-pack`, { token })).status, 200);
  assert.equal((await s.call("POST", "/lectures", { token: bt, json: { courseId: s.store.lecture(theirs)!.course_id, title: "Live 2", language: "en", source: "record" } })).status, 200);
  await s.packs.idle();
});

test("recordings on the free plan: 30 days from the lecture, but never from before plans began or before paid time ended", async t => {
  const ago = (days: number) => new Date(Date.now() - days * DAY).toISOString();
  /* Plans began today on this server: a recording from 60 days ago still has 30 days. */
  const s = setup({ realPlans: true }); t.after(() => s.close());
  const tz = s.config.timezone, today = localDate(new Date(), tz), on = (iso: string) => localDate(new Date(iso), tz);
  const a = await s.signIn(), fresh = await readyLecture(s, a), old = await readyLecture(s, a);
  s.store.db.prepare("UPDATE lectures SET created_at = ? WHERE id = ?").run(ago(60), old);
  for (const id of [fresh, old]) assert.equal((await s.call("GET", `/lectures/${id}`, { token: a })).body.detail.audio.keptUntil, addDays(today, 30));
  assert.equal(await sweepAudio(s, new Date(Date.now() + 30 * DAY)), 0);
  assert.equal(await sweepAudio(s, new Date(Date.now() + 31 * DAY)), 2);
  assert.deepEqual((await s.call("GET", `/lectures/${fresh}`, { token: a })).body.detail.audio, { expired: true });

  /* Plans began 100 days ago. Free all along: 30 days from the lecture. On Plus: kept for good; Plus ended two days
     ago: 30 days from that day. */
  const p = setup({ realPlans: true }); t.after(() => p.close());
  p.store.db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('plans_since', ?)").run(ago(100));
  const pa = await p.signIn(), pb = await p.signIn("CODE-B");
  const never = await readyLecture(p, pa);
  p.store.extendPass(uid(p, "CODE-B"), "plus", 30);
  const paid = await readyLecture(p, pb);
  p.store.db.prepare("UPDATE lectures SET created_at = ?").run(ago(40));
  assert.equal((await p.call("GET", `/lectures/${never}`, { token: pa })).body.detail.audio.keptUntil, addDays(on(ago(40)), 30));
  assert.deepEqual(Object.keys((await p.call("GET", `/lectures/${paid}`, { token: pb })).body.detail.audio), ["url"]);
  assert.equal((await home(p, pb)).usage!.audioDays, undefined);
  p.store.db.prepare("UPDATE passes SET until = ?").run(ago(2));
  assert.equal((await p.call("GET", `/lectures/${paid}`, { token: pb })).body.detail.audio.keptUntil, addDays(on(ago(2)), 30));
  assert.equal((await home(p, pb)).usage!.audioDays, 30);
  assert.equal(await sweepAudio(p), 1);   // the one never paid for, 40 days old
  assert.equal(p.files.exists(never, "audio.m4a"), false); assert.equal(p.files.exists(paid, "audio.m4a"), true);
  assert.equal(await sweepAudio(p, new Date(Date.now() + 28 * DAY)), 0);
  assert.equal(await sweepAudio(p, new Date(Date.now() + 29 * DAY)), 1);
});
