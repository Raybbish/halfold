/* The profile and the two consents asked for at sign-up (handoff of 2026-11-23, item 4; src/profile.ts): a new sign-up has
   to fill them in, an account from before is asked once, Settings changes them and withdraws a consent, and every answer
   and change is kept with its time. Also the daily sign-ups and consent shares of scripts/signups.ts (item 8). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { ErrorReplySchema, HomeSchema, ProfileSchema } from "../src/shapes";
import { CONSENT_WORDING } from "../src/profile";
import { signUpReport } from "../src/signups";
import { setup, type TestServer } from "./helpers";

const isError = (r: { body: unknown }) => ErrorReplySchema.parse(r.body);
const home = async (s: TestServer, token: string) => HomeSchema.parse((await s.call("GET", "/home", { token })).body);
const put = (s: TestServer, token: string, json: unknown) => s.call("PUT", "/profile", { token, json });
const later = (s: TestServer, token: string) => s.call("POST", "/profile/later", { token });
const EMPTY = { school: "", major: "", yearOfStudy: null, gradYear: null, origin: null, consentMarketing: false, consentSurvey: false, consentMarketingAt: null, consentSurveyAt: null };
const FORM = { school: "清华大学", major: "Economics", yearOfStudy: "year2", gradYear: 2028, origin: "mainland", consentMarketing: true, consentSurvey: false };

/* Signs up through the real endpoints: the code emailed, then the code with an invite code. */
async function signUp(s: TestServer, email: string, invite: string) {
  await s.call("POST", "/session/code", { json: { email } });
  const r = await s.call("POST", "/session", { json: { email, code: s.mailer.code(email), inviteCode: invite } });
  assert.equal(r.status, 200);
  return r.body.token as string;
}
/* Moves every recorded time back, as if it had happened earlier: lets a test see a time change without waiting. */
const anHourEarlier = (s: TestServer) => {
  for (const [table, cols] of [["profiles", ["consent_marketing_at", "consent_survey_at", "asked_at", "updated_at"]], ["consents", ["created_at"]], ["users", ["signed_up_at"]]] as const)
    for (const c of cols) s.store.db.exec(`UPDATE ${table} SET ${c} = strftime('%Y-%m-%dT%H:%M:%fZ', ${c}, '-1 hour') WHERE ${c} IS NOT NULL`);
};

test("a new sign-up is asked for the profile and both consents, cannot put it off, and the answer is kept with its time", async t => {
  const s = setup(); t.after(() => s.close());
  const before = new Date().toISOString();
  const token = await signUp(s, "li@mails.tsinghua.edu.cn", "CODE-A");
  const user = s.store.userByCode("CODE-A")!;
  assert.ok(user.signed_up_at && user.signed_up_at >= before, "the sign-up time is kept");

  const h = await home(s, token);
  assert.equal(h.askProfile, "signup");
  assert.deepEqual(h.profile, EMPTY);
  /* The school from the email address, in each language: a mainland school by its own (Simplified) name in Chinese. */
  assert.deepEqual(h.schoolGuess, { en: "Tsinghua University", zhHant: "清華大學", zhHans: "清华大学" });

  /* A new account has to answer: no Not now, and not a part of the form. */
  const off = await later(s, token);
  assert.equal(off.status, 409); assert.equal(isError(off).message, "Fill in these details to finish signing up.");
  for (const missing of ["school", "major", "yearOfStudy", "gradYear", "origin", "consentMarketing", "consentSurvey"]) {
    const { [missing]: _gone, ...part } = FORM as Record<string, unknown>;
    const r = await put(s, token, part);
    assert.equal(r.status, 400, missing); assert.equal(isError(r).message, "Fill in every field.");
  }
  assert.equal((await home(s, token)).askProfile, "signup", "still asked after the refusals");

  const r = await put(s, token, FORM);
  assert.equal(r.status, 200);
  const p = ProfileSchema.parse(r.body);
  assert.deepEqual({ ...p, consentMarketingAt: null, consentSurveyAt: null }, { ...FORM, consentMarketingAt: null, consentSurveyAt: null });
  assert.ok(p.consentMarketingAt! >= before && p.consentSurveyAt === p.consentMarketingAt, "both answers are timed, the unticked one too");

  const after = await home(s, token);
  assert.equal(after.askProfile, undefined, "answered: not asked again");
  assert.equal(after.schoolGuess, undefined, "a school is saved: no guess");
  assert.deepEqual(after.profile, p);
  /* The log: both answers, with the wording shown and where they were given. */
  assert.deepEqual(s.store.consentLog(user.id).map(c => [c.kind, c.given, c.wording, c.source, c.created_at]),
    [["marketing", 1, CONSENT_WORDING, "signup", p.consentMarketingAt], ["survey", 0, CONSENT_WORDING, "signup", p.consentSurveyAt]]);

  /* Signing in again later: not asked. */
  await s.call("POST", "/session/code", { json: { email: "li@mails.tsinghua.edu.cn" } });
  s.store.db.exec("UPDATE code_sends SET created_at = strftime('%Y-%m-%dT%H:%M:%fZ', created_at, '-61 seconds')");
  await s.call("POST", "/session/code", { json: { email: "li@mails.tsinghua.edu.cn" } });
  const again = await s.call("POST", "/session", { json: { email: "li@mails.tsinghua.edu.cn", code: s.mailer.code("li@mails.tsinghua.edu.cn") } });
  assert.equal((await home(s, again.body.token)).askProfile, undefined);
});

test("the school is guessed from the address in Hong Kong, Taiwan and abroad, and not for an unknown address", async t => {
  const s = setup(); t.after(() => s.close());
  const guess = async (email: string, invite: string) => (await home(s, await signUp(s, email, invite))).schoolGuess;
  s.store.addInviteCode("CODE-C"); s.store.addInviteCode("CODE-D");
  assert.deepEqual(await guess("ann@connect.hku.hk", "CODE-A"), { en: "The University of Hong Kong", zhHant: "香港大學", zhHans: "香港大学" });
  assert.deepEqual(await guess("ben@ntu.edu.tw", "CODE-B"), { en: "National Taiwan University", zhHant: "國立臺灣大學", zhHans: "国立台湾大学" });
  assert.deepEqual(await guess("cat@u.nus.edu", "CODE-C"), { en: "National University of Singapore", zhHant: "National University of Singapore", zhHans: "National University of Singapore" });
  assert.equal(await guess("dan@example.edu", "CODE-D"), undefined);
});

test("an account from before is asked once: Not now, or an answer, and it is not asked again", async t => {
  const s = setup(); t.after(() => s.close());
  /* Accounts that signed in before this change: an email bound with no sign-up time, and one with the invite code alone. */
  s.store.db.prepare("UPDATE users SET email = 'ben@example.edu' WHERE invite_code = 'code-b'").run();
  const ann = await s.signIn("CODE-A");
  await s.call("POST", "/session/code", { json: { email: "ben@example.edu" } });
  const ben = (await s.call("POST", "/session", { json: { email: "ben@example.edu", code: s.mailer.code("ben@example.edu") } })).body.token as string;

  for (const token of [ann, ben]) { const h = await home(s, token); assert.equal(h.askProfile, "once"); assert.deepEqual(h.profile, EMPTY); }
  assert.equal(s.store.userByCode("CODE-B")!.signed_up_at, null, "signing in again is not a sign-up");

  /* Ann puts it off: never asked again, and nothing was answered. */
  assert.equal((await later(s, ann)).status, 204);
  assert.equal((await home(s, ann)).askProfile, undefined);
  assert.equal((await later(s, ann)).status, 204, "a second Not now changes nothing");
  assert.deepEqual((await home(s, ann)).profile, EMPTY);
  assert.deepEqual(s.store.consentLog(), []);
  assert.ok(s.store.profile(s.store.userByCode("CODE-A")!.id)!.asked_at);

  /* Ben answers it: the whole form, as at sign-up, logged as an answer to the question. */
  assert.equal(isError(await put(s, ben, { consentMarketing: true })).message, "Fill in every field.");
  const r = await put(s, ben, { ...FORM, school: "  Lingnan University ", consentMarketing: false, consentSurvey: true });
  assert.equal(r.status, 200);
  assert.equal(r.body.school, "Lingnan University");
  assert.equal((await home(s, ben)).askProfile, undefined);
  assert.deepEqual(s.store.consentLog().map(c => [c.kind, c.given, c.source]), [["marketing", 0, "prompt"], ["survey", 1, "prompt"]]);
  /* Only the student's own profile. */
  assert.deepEqual((await home(s, ann)).profile, EMPTY);
});

test("Settings changes the profile and gives or withdraws each consent apart; each change is timed and logged", async t => {
  const s = setup(); t.after(() => s.close());
  const token = await signUp(s, "ann@connect.hku.hk", "CODE-A"), id = s.store.userByCode("CODE-A")!.id;
  const first = ProfileSchema.parse((await put(s, token, { ...FORM, school: "HKU" })).body);
  anHourEarlier(s);
  const t0 = s.store.profile(id)!;

  /* The profile alone: the consents and their times stay. */
  const edited = ProfileSchema.parse((await put(s, token, { school: "The University of Hong Kong", major: "Physics", yearOfStudy: "masters", gradYear: "2027", origin: "hk-local" })).body);
  assert.deepEqual(edited, { ...first, school: "The University of Hong Kong", major: "Physics", yearOfStudy: "masters", gradYear: 2027, origin: "hk-local",
    consentMarketingAt: t0.consent_marketing_at, consentSurveyAt: t0.consent_survey_at });
  assert.ok(s.store.profile(id)!.updated_at > t0.updated_at);

  /* Withdrawing the first consent: its time moves, the other's does not. */
  const withdrawn = ProfileSchema.parse((await put(s, token, { consentMarketing: false })).body);
  assert.equal(withdrawn.consentMarketing, false);
  assert.ok(withdrawn.consentMarketingAt! > t0.consent_marketing_at!, "the withdrawal is timed");
  assert.equal(withdrawn.consentSurveyAt, t0.consent_survey_at);
  /* Giving the second one. */
  const given = ProfileSchema.parse((await put(s, token, { consentMarketing: false, consentSurvey: true })).body);
  assert.equal(given.consentSurvey, true);
  assert.equal(given.consentMarketingAt, withdrawn.consentMarketingAt, "saved unchanged: its time stays");
  assert.ok(given.consentSurveyAt! > t0.consent_survey_at!);
  assert.deepEqual((await home(s, token)).profile, given);
  assert.deepEqual(s.store.consentLog(id).map(c => [c.kind, c.given, c.source]),
    [["marketing", 1, "signup"], ["survey", 0, "signup"], ["marketing", 0, "settings"], ["survey", 1, "settings"]]);

  /* Wrong values: 400 with a sentence, nothing saved. */
  for (const [json, msg] of [
    [{ school: "  " }, "Enter your school."], [{ major: "" }, "Enter your major."], [{ school: "x".repeat(101) }, "The school can be at most 100 characters."],
    [{ major: "x".repeat(101) }, "The major can be at most 100 characters."], [{ yearOfStudy: "year6" }, "Choose your year of study."],
    [{ gradYear: 28 }, "Enter the year you graduate, with four digits, such as 2028."], [{ gradYear: "20288" }, "Enter the year you graduate, with four digits, such as 2028."],
    [{ gradYear: 2027.5 }, "Enter the year you graduate, with four digits, such as 2028."], [{ origin: "hongkong" }, "Choose where you are from."],
    [{ consentSurvey: "yes" }, "Tick or untick each box."], [{ consentMarketing: null }, "Tick or untick each box."]
  ] as const) { const bad = await put(s, token, json); assert.equal(bad.status, 400, JSON.stringify(json)); assert.equal(isError(bad).message, msg); }
  assert.deepEqual((await home(s, token)).profile, given);
  assert.equal((await s.call("PUT", "/profile", { json: { consentSurvey: false } })).status, 401);
});

test("signups: sign-ups a day in the server's time zone, and the share of answers that ticked each consent", async t => {
  const s = setup({ env: { APP_TIMEZONE: "Asia/Hong_Kong" } }); t.after(() => s.close());
  for (const c of ["CODE-C", "CODE-D", "CODE-E"]) s.store.addInviteCode(c);
  s.store.db.prepare("UPDATE users SET email = 'old@example.edu' WHERE invite_code = 'code-e'").run();   // from before: no sign-up day
  const a = await signUp(s, "a@example.edu", "CODE-A"), b = await signUp(s, "b@example.edu", "CODE-B"), c = await signUp(s, "c@example.edu", "CODE-C");
  /* A ticks both, B neither, C puts nothing in yet; then A withdraws the survey. D never signed up. */
  await put(s, a, { ...FORM, consentMarketing: true, consentSurvey: true });
  await put(s, b, { ...FORM, consentMarketing: false, consentSurvey: false });
  await put(s, a, { consentSurvey: false });
  /* B signed up the day before (Hong Kong time). */
  s.store.db.prepare("UPDATE users SET signed_up_at = strftime('%Y-%m-%dT%H:%M:%fZ', signed_up_at, '-1 day') WHERE invite_code = 'code-b'").run();
  void c;

  const now = new Date(), r = signUpReport(s.store, "Asia/Hong_Kong", { days: 3, now });
  const day = (ago: number) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Hong_Kong" }).format(new Date(now.getTime() - ago * 86400_000));
  assert.deepEqual(r.days, [{ date: day(2), signUps: 0 }, { date: day(1), signUps: 1 }, { date: day(0), signUps: 2 }]);
  assert.equal(r.accounts, 4); assert.equal(r.undated, 1);
  assert.deepEqual(r.profiles, { filledIn: 2, putOff: 0, notAskedYet: 2 });
  assert.deepEqual(r.marketing, { answered: 2, ticked: 1, share: 0.5, withdrawn: 0 });
  assert.deepEqual(r.survey, { answered: 2, ticked: 0, share: 0, withdrawn: 1 });
  assert.equal(signUpReport(s.store, "Asia/Hong_Kong").days.length, 30, "30 days unless asked");
});
