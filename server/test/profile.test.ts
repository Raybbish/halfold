/* The profile and the two consents asked for after the first sign-in (handoff of 2026-11-23, item 4), in the shape of the
   designers' draft of 2026-11-24 (src/profile.ts): user.profile is null until saved, every field is optional, anyone can
   skip and the skip is kept, Settings changes the profile and gives or withdraws each consent, and every answer and change
   is kept with its time. Also the daily sign-ups and consent shares of scripts/signups.ts (item 8). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { ErrorReplySchema, HomeSchema, ProfileReplySchema } from "../src/shapes";
import { CONSENT_WORDING } from "../src/profile";
import { signUpReport } from "../src/signups";
import { setup, type TestServer } from "./helpers";

const isError = (r: { body: unknown }) => ErrorReplySchema.parse(r.body);
const home = async (s: TestServer, token: string) => HomeSchema.parse((await s.call("GET", "/home", { token })).body);
const put = (s: TestServer, token: string, json: unknown) => s.call("PUT", "/profile", { token, json });
const saved = async (s: TestServer, token: string, json: unknown) => { const r = await put(s, token, json); assert.equal(r.status, 200, JSON.stringify(r.body)); return ProfileReplySchema.parse(r.body).profile; };
const skip = (s: TestServer, token: string) => s.call("POST", "/profile/later", { token });
const year = new Date().getUTCFullYear();
/* What the profile form sends (the draft's readProfile): every field, as text. */
const FORM = { school: "清华大学", major: "Economics", yearOfStudy: "y2", gradYear: String(year + 2), origin: "cn", consentMarketing: true, consentSurvey: false };
const EMPTY_FORM = { school: "", major: "", yearOfStudy: "", gradYear: "", origin: "", consentMarketing: false, consentSurvey: false };

/* Signs in through the real endpoints: the code emailed, then the code (with an invite code the first time). */
async function signIn(s: TestServer, email: string, invite = "") {
  if (s.store.lastCodeSent(email)) s.store.db.exec("UPDATE code_sends SET created_at = strftime('%Y-%m-%dT%H:%M:%fZ', created_at, '-61 seconds')");
  await s.call("POST", "/session/code", { json: { email } });
  const r = await s.call("POST", "/session", { json: { email, code: s.mailer.code(email), inviteCode: invite } });
  assert.equal(r.status, 200);
  return r.body.token as string;
}
/* Moves every recorded time back, as if it had happened earlier: lets a test see a time change without waiting. */
const anHourEarlier = (s: TestServer) => {
  for (const [table, cols] of [["profiles", ["consent_marketing_at", "consent_survey_at", "saved_at", "skipped_at", "updated_at"]], ["consents", ["created_at"]], ["users", ["signed_up_at"]]] as const)
    for (const c of cols) s.store.db.exec(`UPDATE ${table} SET ${c} = strftime('%Y-%m-%dT%H:%M:%fZ', ${c}, '-1 hour') WHERE ${c} IS NOT NULL`);
};

test("a new sign-up has no profile until it saves one; the form's answer is kept, each consent with its time", async t => {
  const s = setup(); t.after(() => s.close());
  const before = new Date().toISOString();
  const token = await signIn(s, "li@mails.tsinghua.edu.cn", "CODE-A");
  const user = s.store.userByCode("CODE-A")!;
  assert.ok(user.signed_up_at && user.signed_up_at >= before, "the sign-up time is kept");

  const h = await home(s, token);
  assert.deepEqual(h.user, { name: "Ann", profile: null }, "null: the front end asks (#/welcome)");
  /* The school from the email address, in each language: a mainland school by its own (Simplified) name in Chinese. */
  assert.deepEqual(h.schoolGuess, { en: "Tsinghua University", zhHant: "清華大學", zhHans: "清华大学" });

  const p = await saved(s, token, FORM);
  assert.deepEqual({ ...p, consentMarketingAt: null, consentSurveyAt: null },
    { ...FORM, gradYear: year + 2, consentMarketingAt: null, consentSurveyAt: null });
  assert.ok(p.consentMarketingAt! >= before && p.consentSurveyAt === p.consentMarketingAt, "both answers are timed, the unticked one too");

  const after = await home(s, token);
  assert.deepEqual(after.user, { name: "Ann", profile: p }, "saved: not asked again");
  assert.equal(after.schoolGuess, undefined, "a school is saved: no guess");
  /* The log: both answers, with the wording shown, as the first answer. */
  assert.deepEqual(s.store.consentLog(user.id).map(c => [c.kind, c.given, c.wording, c.source, c.created_at]),
    [["marketing", 1, CONSENT_WORDING, "first", p.consentMarketingAt], ["survey", 0, CONSENT_WORDING, "first", p.consentSurveyAt]]);
  /* Signing in again later: still there. */
  assert.deepEqual((await home(s, await signIn(s, "li@mails.tsinghua.edu.cn"))).user.profile, p);
});

test("every field is optional: an empty form is a saved profile, \"Prefer not to say\" is origin \"\"", async t => {
  const s = setup(); t.after(() => s.close());
  const token = await signIn(s, "ann@example.edu", "CODE-A");
  assert.equal((await home(s, token)).schoolGuess, undefined, "an unknown address: no guess");
  const p = await saved(s, token, EMPTY_FORM);
  assert.deepEqual({ ...p, consentMarketingAt: null, consentSurveyAt: null }, { ...EMPTY_FORM, gradYear: null, consentMarketingAt: null, consentSurveyAt: null });
  assert.deepEqual((await home(s, token)).user.profile, p, "not null any more: not asked again");
  /* Any school text; a field left out is kept; null clears like "". */
  const q = await saved(s, token, { school: "  My Community College ", gradYear: year + 6 });
  assert.equal(q.school, "My Community College"); assert.equal(q.gradYear, year + 6); assert.equal(q.origin, "");
  assert.equal((await saved(s, token, { gradYear: null })).gradYear, null);
});

test("Skip for now is kept: user.profileSkipped on every device until a profile is saved; an account from before is asked the same way", async t => {
  const s = setup(); t.after(() => s.close());
  /* An account from before this change: its email bound earlier, with no sign-up time. */
  s.store.db.prepare("UPDATE users SET email = 'ben@example.edu' WHERE invite_code = 'code-b'").run();
  const phone = await signIn(s, "ben@example.edu");
  assert.equal(s.store.userByCode("CODE-B")!.signed_up_at, null, "signing in again is not a sign-up");
  assert.deepEqual((await home(s, phone)).user, { name: "Ben", profile: null });

  assert.equal((await skip(s, phone)).status, 204);
  const laptop = await signIn(s, "ben@example.edu");
  for (const token of [phone, laptop]) assert.deepEqual((await home(s, token)).user, { name: "Ben", profile: null, profileSkipped: true });
  assert.equal((await skip(s, laptop)).status, 204, "a second skip changes nothing");
  assert.deepEqual(s.store.consentLog(), [], "nothing answered");

  /* Filled in later (from the home page's reminder, or Settings): saved, and no longer skipped. */
  const p = await saved(s, laptop, { ...FORM, school: "Lingnan University", origin: "hk", consentMarketing: false, consentSurvey: true });
  assert.deepEqual((await home(s, phone)).user, { name: "Ben", profile: p });
  assert.deepEqual(s.store.consentLog().map(c => [c.kind, c.given, c.source]), [["marketing", 0, "first"], ["survey", 1, "first"]]);
  /* Only the student's own profile. */
  assert.deepEqual((await home(s, await s.signIn("CODE-A"))).user.profile, null);
});

test("the school is guessed from the address in Hong Kong, Taiwan and abroad", async t => {
  const s = setup(); t.after(() => s.close());
  s.store.addInviteCode("CODE-C");
  const guess = async (email: string, invite: string) => (await home(s, await signIn(s, email, invite))).schoolGuess;
  assert.deepEqual(await guess("ann@connect.hku.hk", "CODE-A"), { en: "The University of Hong Kong", zhHant: "香港大學", zhHans: "香港大学" });
  assert.deepEqual(await guess("ben@ntu.edu.tw", "CODE-B"), { en: "National Taiwan University", zhHant: "國立臺灣大學", zhHans: "国立台湾大学" });
  assert.deepEqual(await guess("cat@u.nus.edu", "CODE-C"), { en: "National University of Singapore", zhHant: "National University of Singapore", zhHans: "National University of Singapore" });
});

test("Settings changes the profile and gives or withdraws each consent; each change is timed and logged", async t => {
  const s = setup(); t.after(() => s.close());
  const token = await signIn(s, "ann@connect.hku.hk", "CODE-A"), id = s.store.userByCode("CODE-A")!.id;
  const first = await saved(s, token, { ...FORM, school: "HKU" });
  anHourEarlier(s);
  const t0 = s.store.profile(id)!;

  /* The whole form again with only the profile changed: the consents and their times stay. */
  const edited = await saved(s, token, { ...FORM, school: "The University of Hong Kong", major: "Physics", yearOfStudy: "tpg", gradYear: String(year + 1), origin: "mo" });
  assert.deepEqual(edited, { ...first, school: "The University of Hong Kong", major: "Physics", yearOfStudy: "tpg", gradYear: year + 1, origin: "mo",
    consentMarketingAt: t0.consent_marketing_at, consentSurveyAt: t0.consent_survey_at });
  assert.ok(s.store.profile(id)!.updated_at > t0.updated_at);
  assert.equal(s.store.profile(id)!.saved_at, t0.saved_at, "saved_at is the first save");

  /* Withdrawing the first consent: its time moves, the other's does not. */
  const withdrawn = await saved(s, token, { ...FORM, school: "The University of Hong Kong", consentMarketing: false });
  assert.equal(withdrawn.consentMarketing, false);
  assert.ok(withdrawn.consentMarketingAt! > t0.consent_marketing_at!, "the withdrawal is timed");
  assert.equal(withdrawn.consentSurveyAt, t0.consent_survey_at);
  /* Giving the second one, sent alone. */
  const given = await saved(s, token, { consentSurvey: true });
  assert.equal(given.consentSurvey, true);
  assert.equal(given.consentMarketingAt, withdrawn.consentMarketingAt, "left out: its time stays");
  assert.ok(given.consentSurveyAt! > t0.consent_survey_at!);
  assert.deepEqual((await home(s, token)).user.profile, given);
  assert.deepEqual(s.store.consentLog(id).map(c => [c.kind, c.given, c.source]),
    [["marketing", 1, "first"], ["survey", 0, "first"], ["marketing", 0, "change"], ["survey", 1, "change"]]);

  /* Wrong values: 400 with a sentence, nothing saved. */
  for (const [json, msg] of [
    [{ school: "x".repeat(81) }, "The university can be at most 80 characters."], [{ school: 5 }, "The university can be at most 80 characters."],
    [{ major: "x".repeat(81) }, "What you study can be at most 80 characters."],
    [{ yearOfStudy: "year1" }, "Choose your year from the list."], [{ yearOfStudy: "phd" }, "Choose your year from the list."],
    [{ gradYear: "28" }, "Choose the year you graduate from the list."], [{ gradYear: year + 11 }, "Choose the year you graduate from the list."],
    [{ gradYear: 2027.5 }, "Choose the year you graduate from the list."], [{ origin: "mainland" }, "Choose where you studied before university from the list."],
    [{ consentSurvey: "yes" }, "Tick or untick each box."], [{ consentMarketing: null }, "Tick or untick each box."]
  ] as const) { const bad = await put(s, token, json); assert.equal(bad.status, 400, JSON.stringify(json)); assert.equal(isError(bad).message, msg); }
  assert.deepEqual((await home(s, token)).user.profile, given);
  assert.equal((await s.call("PUT", "/profile", { json: { consentSurvey: false } })).status, 401);
  assert.equal((await s.call("POST", "/profile/later")).status, 401);
});

test("signups: sign-ups a day in the server's time zone, and the share of answers that ticked each consent", async t => {
  const s = setup(); t.after(() => s.close());
  for (const c of ["CODE-C", "CODE-D", "CODE-E"]) s.store.addInviteCode(c);
  s.store.db.prepare("UPDATE users SET email = 'old@example.edu' WHERE invite_code = 'code-e'").run();   // from before: no sign-up day
  const a = await signIn(s, "a@example.edu", "CODE-A"), b = await signIn(s, "b@example.edu", "CODE-B"), c = await signIn(s, "c@example.edu", "CODE-C");
  /* A ticks both, B neither, C skips; then A withdraws the survey. D never signed up. */
  await put(s, a, { ...FORM, consentMarketing: true, consentSurvey: true });
  await put(s, b, EMPTY_FORM);
  await skip(s, c);
  await put(s, a, { consentSurvey: false });
  /* B signed up the day before (Hong Kong time). */
  s.store.db.prepare("UPDATE users SET signed_up_at = strftime('%Y-%m-%dT%H:%M:%fZ', signed_up_at, '-1 day') WHERE invite_code = 'code-b'").run();

  const now = new Date(), r = signUpReport(s.store, "Asia/Hong_Kong", { days: 3, now });
  const day = (ago: number) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Hong_Kong" }).format(new Date(now.getTime() - ago * 86400_000));
  assert.deepEqual(r.days, [{ date: day(2), signUps: 0 }, { date: day(1), signUps: 1 }, { date: day(0), signUps: 2 }]);
  assert.equal(r.accounts, 4); assert.equal(r.undated, 1);
  assert.deepEqual(r.profiles, { saved: 2, skipped: 1, neither: 1 });
  assert.deepEqual(r.marketing, { answered: 2, ticked: 1, share: 0.5, withdrawn: 0 });
  assert.deepEqual(r.survey, { answered: 2, ticked: 0, share: 0, withdrawn: 1 });
  assert.equal(signUpReport(s.store, "Asia/Hong_Kong").days.length, 30, "30 days unless asked");
});
