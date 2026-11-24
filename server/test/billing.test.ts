/* Plans and payment (phase 4; one-time payments and refunds from 2026-11-24) with plans.json as committed: GET /plans,
   POST /checkout, what Stripe tells the server (webhook, or asking Stripe when the student comes back), refunds and
   disputes, what each plan allows, and how long recordings are kept when a plan ends. Stripe is stubbed (StubPayments);
   the real requests are checked in payments.test.ts, and the whole flow against a fake Stripe in stripe-flow.test.ts. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { ErrorReplySchema, HomeSchema, PlansSchema, UrlReplySchema } from "../src/shapes";
import { addDays, sweepAudio } from "../src/audio";
import { localDate, monthOf, shortDate } from "../src/time";
import { readyLecture, setup, uploadedLecture, type TestServer } from "./helpers";

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
  return { id, object: "checkout.session", status: "complete", payment_status: paymentStatus, mode: "payment", payment_intent: c.paymentIntent, metadata: c.metadata };
};
/* A payment as Stripe sends it in charge.refunded: what was paid and what has been given back so far, in cents. */
const charge = (pi: string, amount: number, refunded: number) =>
  ({ id: "ch_" + pi, object: "charge", amount, amount_refunded: refunded, refunded: refunded >= amount, payment_intent: pi, currency: "hkd" });
const dispute = (pi: string, status: string) => ({ id: "dp_" + pi, object: "dispute", status, payment_intent: pi, charge: "ch_" + pi, amount: 34800 });
const day = (s: TestServer, iso: string) => shortDate(localDate(new Date(iso), s.config.timezone), true);
const DAY = 86400_000;
const ago = (days: number) => new Date(Date.now() - days * DAY).toISOString();
const near = (iso: string | undefined, ms: number) => !!iso && Math.abs(Date.parse(iso) - ms) < 60_000;
const untilOf = (s: TestServer, code = "CODE-A") => s.store.pass(uid(s, code))?.until;

test("GET /plans: Free, Plus for a month and Plus for a semester, as plans.json says, each paid once; the free plan's usage on /home", async t => {
  const s = setup({ realPlans: true }); t.after(() => s.close());
  const token = await s.signIn();
  const plus = ["240 minutes of live recording a day", "40 lectures a month", "Unlimited review packs", "Recordings kept for good", "Pay once by card, Alipay or WeChat Pay. Does not renew."];
  assert.deepEqual(await plansOf(s, token), { current: "free", plans: [
    { id: "free", name: "Free", priceText: "Free", features: ["90 minutes of live recording a day", "4 lectures a month", "1 review pack a month", "Recordings kept for 30 days"] },
    { id: "plus-month", name: "Plus for a month", priceText: "HK$98 for 30 days", features: plus },
    { id: "plus-semester", name: "Plus for a semester", priceText: "HK$348 for 120 days", features: plus }
  ] });
  assert.deepEqual((await home(s, token)).usage, { minutesToday: 0, minutesLimit: 90, audioDays: 30, lecturesThisMonth: 0, lecturesLimit: 4 });
});

test("Plus for a month: paid once in Stripe Checkout; the plan starts when Stripe says it is paid; 30 days, then back to Free", async t => {
  const s = setup({ realPlans: true }); t.after(() => s.close());
  const token = await s.signIn(), me = uid(s);
  const r = await choose(s, token, "plus-month");
  assert.equal(r.status, 200); assert.deepEqual(UrlReplySchema.parse(r.body), { url: "https://checkout.stripe.test/cs_test_1" });
  assert.deepEqual(s.payments.requests[0], {
    productName: "Halfold Plus for a month, 30 days", currency: "hkd", amount: 9800,
    successUrl: ORIGIN + "/#/settings", cancelUrl: ORIGIN + "/#/settings", userId: me, email: null,
    metadata: { user: me, plan: "plus", card: "plus-month", days: "30" }
  });
  assert.deepEqual([s.store.checkout("cs_test_1")!.plan, s.store.checkout("cs_test_1")!.days], ["plus", 30]);
  /* Not paid yet (the student closed the page): still Free. */
  assert.equal((await plansOf(s, token)).current, "free");

  /* Paid. No webhook yet: coming back to the settings page, the server asks Stripe about the open Checkout. */
  s.payments.pay("cs_test_1");
  assert.deepEqual((await home(s, token)).usage, { minutesToday: 0, minutesLimit: 240, lecturesThisMonth: 0, lecturesLimit: 40 });
  const until = untilOf(s)!;
  assert.ok(near(until, Date.now() + 30 * DAY), until);
  const paid = await plansOf(s, token);
  assert.equal(paid.current, "plus-month");
  assert.equal(paid.plans[1].features![0], `Paid until ${day(s, until)}`);
  assert.equal(paid.plans[2].features![0], `Adds 120 days after ${day(s, until)}`);
  assert.deepEqual([s.store.checkout("cs_test_1")!.status, s.store.checkout("cs_test_1")!.payment_intent], ["complete", "pi_test_1"]);
  /* The webhook for the same Checkout comes later: nothing changes, and Stripe is not asked again about it. */
  s.payments.fetched.length = 0;
  assert.equal((await webhook(s, "checkout.session.completed", session(s, "cs_test_1"))).status, 200);
  assert.equal(untilOf(s), until); assert.deepEqual(s.payments.fetched, []);

  /* Nothing renews, so there is nothing to cancel: choosing Free says when the paid time ends. */
  const free = await choose(s, token, "free");
  assert.equal(free.status, 409);
  assert.equal(isError(free).message, `Your Plus for a month runs until ${day(s, until)} and does not renew. You are back on Free after that day.`);
  assert.equal(s.payments.requests.length, 1);

  /* The month runs out: Free again, everything kept. */
  const ended = ago(0.001);
  s.store.db.prepare("UPDATE passes SET until = ?").run(ended);
  assert.equal((await plansOf(s, token)).current, "free");
  assert.equal((await home(s, token)).usage!.minutesLimit, 90);
  assert.equal(s.billing.entitlement(me).paidEnd, ended);
});

test("Plus for a semester: paid once (the webhook may come twice); more Plus bought before it ends adds its days after the ones paid for", async t => {
  const s = setup({ realPlans: true }); t.after(() => s.close());
  const token = await s.signIn(), me = uid(s);
  s.store.bindEmail(me, "ann@example.edu");
  assert.equal((await choose(s, token, "plus-semester")).body.url, "https://checkout.stripe.test/cs_test_1");
  const q = s.payments.requests[0];
  assert.deepEqual([q.amount, q.productName, q.email, q.metadata], [34800, "Halfold Plus for a semester, 120 days", "ann@example.edu", { user: me, plan: "plus", card: "plus-semester", days: "120" }]);
  s.payments.pay("cs_test_1");
  for (let i = 0; i < 2; i++) assert.equal((await webhook(s, "checkout.session.completed", session(s, "cs_test_1"))).status, 200);
  const until = untilOf(s)!;
  assert.ok(near(until, Date.now() + 120 * DAY), until);
  const p = await plansOf(s, token);
  assert.equal(p.current, "plus-semester"); assert.equal(p.plans[2].features![0], `Paid until ${day(s, until)}`);
  assert.equal(p.plans[1].features![0], `Adds 30 days after ${day(s, until)}`);

  /* A month more before the semester ends: from the semester's last day, not from today. It is now "Your plan". */
  await choose(s, token, "plus-month"); s.payments.pay("cs_test_2"); await webhook(s, "checkout.session.completed", session(s, "cs_test_2"));
  const later = untilOf(s)!;
  assert.equal(Date.parse(later), Date.parse(until) + 30 * DAY);
  assert.equal((await plansOf(s, token)).current, "plus-month");
  /* The same pass again (the page shows "Your plan" on it rather than a button, but the server takes it): adds too. */
  await choose(s, token, "plus-month"); s.payments.pay("cs_test_3"); await webhook(s, "checkout.session.completed", session(s, "cs_test_3"));
  assert.equal(Date.parse(untilOf(s)!), Date.parse(later) + 30 * DAY);
  /* Days given by hand (npm run plan -- give) keep the card shown. */
  s.store.extendPass(me, "plus", 7);
  assert.equal((await plansOf(s, token)).current, "plus-month");

  s.store.db.prepare("UPDATE passes SET until = ?").run(ago(0.001));
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
  await choose(s, b, "plus-month");
  await webhook(s, "checkout.session.expired", { ...session(s, "cs_test_3", "unpaid"), status: "expired" });
  assert.equal(s.store.checkout("cs_test_3")!.status, "expired");
});

test("POST /checkout: what is refused; another paid plan waits until the paid time ends; Stripe down; no Stripe key: url null", async t => {
  const pro = { id: "pro", name: "Pro", dailyLiveMinutes: 480, lecturesPerMonth: null, packsPerMonth: null, audioDays: null, passes: [{ id: "pro-month", name: "Pro for a month", price: 198, days: 30 }] };
  const s = setup({ realPlans: true, plans: p => { p.plans.push(pro); } }); t.after(() => s.close());
  const token = await s.signIn();
  const unknown = await choose(s, token, "gold");
  assert.equal(unknown.status, 404); assert.equal(isError(unknown).message, "This plan does not exist. Reload the page to see the plans.");
  assert.equal((await choose(s, token, "plus")).status, 404, "a plan is not a card: its passes are");
  assert.equal((await s.call("POST", "/checkout", { token, json: {} })).status, 400);
  const already = await choose(s, token, "free");
  assert.equal(already.status, 409); assert.equal(isError(already).message, "Free is already your plan.");
  s.payments.error = new Error("Stripe 500");
  const down = await choose(s, token, "plus-month");
  assert.equal(down.status, 502); assert.equal(isError(down).message, "Halfold could not start the payment just now. Try again in a moment.");
  /* Stripe down: the pages still open, with what the database has. */
  assert.equal((await s.call("GET", "/plans", { token })).status, 200);
  assert.equal((await s.call("GET", "/home", { token })).status, 200);
  s.payments.error = null;

  await choose(s, token, "plus-month"); s.payments.pay("cs_test_1"); await plansOf(s, token);
  const other = await choose(s, token, "pro-month");
  assert.equal(other.status, 409);
  assert.equal(isError(other).message, `You have Plus until ${day(s, untilOf(s)!)}. You can choose Pro for a month after that day.`);
  assert.equal(s.payments.requests.length, 1);
  s.store.db.prepare("UPDATE passes SET until = ?").run(ago(0.001));
  assert.equal((await choose(s, token, "pro-month")).body.url, "https://checkout.stripe.test/cs_test_2");

  const off = setup({ realPlans: true, payments: false }); t.after(() => off.close());
  const ot = await off.signIn();
  assert.deepEqual((await choose(off, ot, "plus-month")).body, { url: null });
  assert.equal((await plansOf(off, ot)).plans.length, 3);
  assert.equal((await off.call("POST", "/stripe/webhook", { body: "{}" })).status, 404);
});

test("a newer Checkout closes the student's older open ones; one paid meanwhile is applied, not lost", async t => {
  const s = setup({ realPlans: true }); t.after(() => s.close());
  const token = await s.signIn();
  await choose(s, token, "plus-month");
  assert.equal((await choose(s, token, "plus-semester")).body.url, "https://checkout.stripe.test/cs_test_2");
  assert.deepEqual(s.payments.expired, ["cs_test_1"]);
  assert.equal(s.store.checkout("cs_test_1")!.status, "expired");
  /* The first tab cannot be paid now. The second was paid in another tab before the student chose again: it is applied
     (closing it at Stripe fails) before the new Checkout is made. Stripe is not asked first here, as GET /home and
     GET /plans do, so this is the only place that sees it. */
  s.payments.pay("cs_test_2");
  assert.equal(await s.billing.checkout(s.store.userByCode("CODE-A")!, "plus-month", ORIGIN), "https://checkout.stripe.test/cs_test_3");
  assert.equal(s.store.checkout("cs_test_2")!.status, "complete");
  assert.ok(near(untilOf(s), Date.now() + 120 * DAY));
  assert.equal((await plansOf(s, token)).current, "plus-semester");
});

test("the webhook takes only Stripe's signed, recent events; one about a Checkout this database does not know is applied by its metadata", async t => {
  const s = setup({ realPlans: true }); t.after(() => s.close());
  const token = await s.signIn(), me = uid(s);
  await choose(s, token, "plus-semester"); s.payments.pay("cs_test_1");
  const ev = session(s, "cs_test_1");
  assert.equal((await s.call("POST", "/stripe/webhook", { body: JSON.stringify({ type: "checkout.session.completed", data: { object: ev } }) })).status, 400);
  assert.equal((await webhook(s, "checkout.session.completed", ev, undefined, "whsec_wrong")).status, 400);
  assert.equal((await webhook(s, "checkout.session.completed", ev, new Date(Date.now() - 10 * 60_000))).status, 400);
  assert.equal((await webhook(s, "charge.refunded", charge("pi_test_1", 34800, 34800), undefined, "whsec_wrong")).status, 400);
  assert.equal(s.store.pass(me), undefined);
  assert.equal((await webhook(s, "invoice.created", { id: "in_1" })).status, 200);   // not used: ignored

  const lost = { id: "cs_elsewhere", object: "checkout.session", status: "complete", payment_status: "paid", mode: "payment", payment_intent: "pi_elsewhere",
    metadata: { user: me, plan: "plus", card: "plus-semester", days: "120" } };
  assert.equal((await webhook(s, "checkout.session.completed", lost)).status, 200);
  assert.equal((await plansOf(s, token)).current, "plus-semester");
  assert.deepEqual([s.store.checkout("cs_elsewhere")!.days, s.store.checkout("cs_elsewhere")!.payment_intent], [120, "pi_elsewhere"]);
  assert.equal((await webhook(s, "checkout.session.completed", { ...lost, id: "cs_nobody", metadata: {} })).status, 200);
  assert.equal(s.store.checkout("cs_nobody"), undefined);
});

test("a refund in full ends the plan now, not earlier: recordings are kept 30 days from today; the same news again takes nothing more", async t => {
  const s = setup({ realPlans: true }); t.after(() => s.close());
  const token = await s.signIn(), me = uid(s), today = localDate(new Date(), s.config.timezone);
  const lecture = await readyLecture(s, token), audio = async () => (await s.call("GET", `/lectures/${lecture}`, { token })).body.detail.audio;
  await choose(s, token, "plus-semester"); const pi = s.payments.pay("cs_test_1").paymentIntent!;
  await webhook(s, "checkout.session.completed", session(s, "cs_test_1"));
  /* As if bought 60 days ago (60 days left), on a server whose plans began 100 days ago, for a lecture 70 days old. */
  s.store.db.prepare("UPDATE passes SET until = ?").run(new Date(Date.now() + 60 * DAY).toISOString());
  s.store.db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('plans_since', ?)").run(ago(100));
  s.store.db.prepare("UPDATE lectures SET created_at = ? WHERE id = ?").run(ago(70), lecture);
  assert.deepEqual(Object.keys(await audio()), ["url"], "kept for good on Plus");

  /* Refunded in full from the Stripe Dashboard: all 120 days come off, but the paid time ends now, not 60 days ago,
     so the recording is not deleted at once. */
  assert.equal((await webhook(s, "charge.refunded", charge(pi, 34800, 34800))).status, 200);
  assert.ok(near(untilOf(s), Date.now()), untilOf(s));
  assert.equal(s.store.checkout("cs_test_1")!.returned, 1);
  assert.equal((await plansOf(s, token)).current, "free");
  assert.equal((await home(s, token)).usage!.minutesLimit, 90);
  assert.equal((await audio()).keptUntil, addDays(today, 30));
  assert.equal(await sweepAudio(s), 0);
  /* Days given by hand afterwards are not taken by the same refund told again. */
  s.store.extendPass(me, "plus", 7);
  const given = untilOf(s);
  assert.equal((await webhook(s, "charge.refunded", charge(pi, 34800, 34800))).status, 200);
  assert.equal(untilOf(s), given);
});

test("a partial refund takes the same share of the days off the end; news out of order takes nothing more", async t => {
  const s = setup({ realPlans: true }); t.after(() => s.close());
  const token = await s.signIn();
  await choose(s, token, "plus-month"); const pi = s.payments.pay("cs_test_1").paymentIntent!;
  await plansOf(s, token);   // applied when the student comes back
  const until = Date.parse(untilOf(s)!);
  /* Half the money back: half of the 30 days. */
  await webhook(s, "charge.refunded", charge(pi, 9800, 4900));
  assert.equal(Date.parse(untilOf(s)!), until - 15 * DAY);
  assert.equal((await plansOf(s, token)).current, "plus-month");
  /* The rest later: the plan ends now. The first refund's event arriving after it takes nothing more. */
  await webhook(s, "charge.refunded", charge(pi, 9800, 9800));
  const ended = untilOf(s)!;
  assert.ok(near(ended, Date.now()), ended);
  await webhook(s, "charge.refunded", charge(pi, 9800, 4900));
  assert.equal(untilOf(s), ended);
  assert.equal((await plansOf(s, token)).current, "free");
});

test("refunding one of two passes takes off only its days; a dispute lost counts as a full refund, one won changes nothing", async t => {
  const s = setup({ realPlans: true }); t.after(() => s.close());
  const token = await s.signIn();
  await choose(s, token, "plus-month"); const month = s.payments.pay("cs_test_1").paymentIntent!; await plansOf(s, token);
  await choose(s, token, "plus-semester"); const semester = s.payments.pay("cs_test_2").paymentIntent!; await plansOf(s, token);
  assert.ok(near(untilOf(s), Date.now() + 150 * DAY));
  assert.equal((await plansOf(s, token)).current, "plus-semester");
  /* The semester, bought last, refunded in full: the month is left, and it is "Your plan" again. */
  await webhook(s, "charge.refunded", charge(semester, 34800, 34800));
  assert.ok(near(untilOf(s), Date.now() + 30 * DAY));
  assert.equal((await plansOf(s, token)).current, "plus-month");

  assert.equal((await webhook(s, "charge.dispute.closed", dispute(month, "won"))).status, 200);
  assert.ok(near(untilOf(s), Date.now() + 30 * DAY));
  assert.equal((await webhook(s, "charge.dispute.closed", dispute(month, "lost"))).status, 200);
  assert.ok(near(untilOf(s), Date.now()));
  assert.equal((await plansOf(s, token)).current, "free");
});

test("a refund of a payment this server never heard of: its Checkout is applied first, then taken back; a plan that already ended stays as it was", async t => {
  const s = setup({ realPlans: true }); t.after(() => s.close());
  const token = await s.signIn(), me = uid(s);
  await choose(s, token, "plus-month"); const pi = s.payments.pay("cs_test_1").paymentIntent!;
  /* The webhook about the payment was missed and the student did not come back, then the payment was refunded. */
  assert.equal(s.store.checkout("cs_test_1")!.status, "open");
  assert.equal((await webhook(s, "charge.refunded", charge(pi, 9800, 9800))).status, 200);
  assert.deepEqual([s.store.checkout("cs_test_1")!.status, s.store.checkout("cs_test_1")!.returned], ["complete", 1]);
  assert.ok(near(untilOf(s), Date.now()));
  /* Coming back later does not give the month after all. */
  assert.equal((await plansOf(s, token)).current, "free");
  /* A refund of a payment that paid for no plan here (made some other way): ignored. */
  assert.equal((await webhook(s, "charge.refunded", charge("pi_elsewhere", 500, 500))).status, 200);

  /* Stripe cannot be reached to find the Checkout: 500, so Stripe sends the event again later. */
  await choose(s, token, "plus-month"); const pi2 = s.payments.pay("cs_test_2").paymentIntent!;
  s.payments.error = new Error("ECONNRESET");
  assert.equal((await webhook(s, "charge.refunded", charge(pi2, 9800, 9800))).status, 500);
  s.payments.error = null;
  assert.equal((await webhook(s, "charge.refunded", charge(pi2, 9800, 9800))).status, 200);
  assert.equal(s.store.checkout("cs_test_2")!.returned, 1);

  /* Refunded after the month ran out: nothing to take, and the day it ended (recordings count from it) stays. */
  await choose(s, token, "plus-month"); const pi3 = s.payments.pay("cs_test_3").paymentIntent!; await plansOf(s, token);
  const ended = ago(2);
  s.store.db.prepare("UPDATE passes SET until = ?").run(ended);
  await webhook(s, "charge.refunded", charge(pi3, 9800, 9800));
  assert.equal(untilOf(s), ended); assert.equal(s.billing.entitlement(me).paidEnd, ended);
});

test("a lecture that fails is not one of the month's lectures; a retry counts it again, and so does a later delete", async t => {
  const s = setup({ realPlans: true }); t.after(() => s.close());
  const token = await s.signIn();
  const used = async () => (await home(s, token)).usage!.lecturesThisMonth;
  const id = await uploadedLecture(s, token);
  s.stt.error = new Error("elevenlabs replied 500: busy");
  await s.call("POST", `/lectures/${id}/finish`, { token, json: { duration: 600 } }); await s.pipeline.idle();
  assert.equal(s.store.lecture(id)!.status, "failed");
  assert.equal(await used(), 0, "the failed lecture does not count");
  s.stt.error = null;
  assert.equal((await s.call("POST", `/lectures/${id}/retry`, { token })).status, 200);
  assert.equal(await used(), 1, "tried again: it counts while it is made");
  await s.pipeline.idle();
  assert.equal(s.store.lecture(id)!.status, "ready");
  await s.call("DELETE", `/lectures/${id}`, { token });
  assert.equal(await used(), 1, "notes were written: deleting it does not give it back");
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
