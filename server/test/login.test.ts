/* Signing in with an emailed code (SIGN_IN=email, phase 4): the code, the invite code the first time (and how students
   of phases 1 to 3 keep their lectures), wrong and expired codes, limits on sending, allowed addresses, and how long a
   sign-in lasts. The email service is stubbed (StubMailer); its request is checked in payments.test.ts. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { ErrorReplySchema, HomeSchema, SessionReplySchema } from "../src/shapes";
import { NEW_ADDRESS } from "../src/login";
import { readyLecture, setup, type TestServer } from "./helpers";

const isError = (r: { body: unknown }) => ErrorReplySchema.parse(r.body);
const askCode = (s: TestServer, email: string) => s.call("POST", "/session/code", { json: { email } });
const signIn = (s: TestServer, json: Record<string, unknown>) => s.call("POST", "/session", { json });
/* Every code sent a minute earlier than it was: lets a test ask for another code without waiting. */
const aMinuteLater = (s: TestServer) => s.store.db.exec("UPDATE code_sends SET created_at = strftime('%Y-%m-%dT%H:%M:%fZ', created_at, '-61 seconds')");

test("a new address: the code is emailed; signing in asks for an invite code once, and the address is bound to it", async t => {
  const s = setup(); t.after(() => s.close());
  assert.equal((await askCode(s, "  Ann@Example.EDU ")).status, 204);
  const mail = s.mailer.sent[0];
  assert.equal(mail.to, "ann@example.edu");
  assert.match(mail.subject, /^\d{6} is your Sidenote code$/);
  const code = s.mailer.code("ann@example.edu")!;
  assert.ok(mail.text.includes(code) && mail.html.includes(code) && mail.text.includes("10 minutes") && mail.text.includes("登入碼"));
  /* Only a keyed hash of the code is stored. */
  assert.ok(!JSON.stringify(s.store.db.prepare("SELECT * FROM login_codes").all()).includes(code));

  const first = await signIn(s, { email: "ann@example.edu", code, name: "" });
  assert.equal(first.status, 403); assert.equal(isError(first).message, NEW_ADDRESS);
  const wrongInvite = await signIn(s, { email: "ann@example.edu", code, inviteCode: "nope" });
  assert.equal(wrongInvite.status, 403); assert.equal(isError(wrongInvite).message, "That invite code is not valid.");
  /* The right code still works after those: the invite code was the problem, not the code. */
  const ok = await signIn(s, { email: "ann@example.edu", code: ` ${code.slice(0, 3)} ${code.slice(3)} `, inviteCode: " code-a ", name: "Annie" });
  assert.equal(ok.status, 200);
  const reply = SessionReplySchema.parse(ok.body);
  assert.equal(reply.user.name, "Annie");
  assert.equal(s.store.userByCode("CODE-A")!.email, "ann@example.edu");
  assert.equal(HomeSchema.parse((await s.call("GET", "/home", { token: reply.token })).body).user.name, "Annie");
  /* A code works once. */
  assert.equal((await signIn(s, { email: "ann@example.edu", code, inviteCode: "CODE-A" })).status, 401);

  /* An invite code is one account: it cannot be bound to a second address. */
  await askCode(s, "eve@example.edu");
  const taken = await signIn(s, { email: "eve@example.edu", code: s.mailer.code("eve@example.edu"), inviteCode: "CODE-A" });
  assert.equal(taken.status, 403); assert.equal(isError(taken).message, "That invite code is already used with another email address.");
});

test("a returning address signs in with the code alone and finds the lectures it had with its invite code", async t => {
  const s = setup(); t.after(() => s.close());
  /* A student of phases 1 to 3: lectures made with the invite code alone. */
  const old = await s.signIn("CODE-B"), lecture = await readyLecture(s, old);
  await askCode(s, "ben@example.edu");
  const bound = await signIn(s, { email: "ben@example.edu", code: s.mailer.code("ben@example.edu"), inviteCode: "CODE-B" });
  assert.equal(bound.status, 200);
  assert.deepEqual(HomeSchema.parse((await s.call("GET", "/home", { token: bound.body.token })).body).lectures.map(l => l.id), [lecture]);
  /* Next time: no invite code; an invite code sent anyway is ignored. */
  aMinuteLater(s); await askCode(s, "BEN@example.edu");
  const again = await signIn(s, { email: "ben@example.edu", code: s.mailer.code("ben@example.edu"), name: "" });
  assert.equal(again.status, 200); assert.equal(again.body.user.name, "Ben");
  assert.deepEqual((await s.call("GET", "/home", { token: again.body.token })).body.lectures.map((l: { id: string }) => l.id), [lecture]);
  /* The old token still works (signing in elsewhere does not sign this device out). */
  assert.equal((await s.call("GET", "/home", { token: old })).status, 200);
});

test("wrong, expired and missing codes are refused with a message; five wrong tries end the code", async t => {
  const s = setup(); t.after(() => s.close());
  assert.equal(isError(await signIn(s, { email: "ann@example.edu", code: "123456" })).message, "That code has expired. Ask for a new one.");
  await askCode(s, "ann@example.edu");
  const code = s.mailer.code("ann@example.edu")!, wrong = code === "000000" ? "111111" : "000000";
  for (const [body, msg] of [
    [{ email: "ann@example.edu", code: "12345" }, "Enter the 6-digit code from the email."],
    [{ email: "ann@example", code }, "Enter your email address."],
    [{ code }, "Enter your email address."],
    /* A page from before phase 4 sends the invite code alone. */
    [{ inviteCode: "CODE-A", name: "" }, "Sign in with your email address now. Reload the page to see the new sign-in."]
  ] as const) { const r = await signIn(s, body); assert.equal(r.status, 400); assert.equal(isError(r).message, msg); }
  for (let i = 1; i <= 4; i++) {
    const r = await signIn(s, { email: "ann@example.edu", code: wrong, inviteCode: "CODE-A" });
    assert.equal(r.status, 401); assert.equal(isError(r).message, "That code is not right. Check the latest email from Sidenote.");
  }
  const fifth = await signIn(s, { email: "ann@example.edu", code: wrong, inviteCode: "CODE-A" });
  assert.equal(isError(fifth).message, "That code is not right, and it has now stopped working. Ask for a new one.");
  assert.equal((await signIn(s, { email: "ann@example.edu", code, inviteCode: "CODE-A" })).status, 401);   // even the right one now

  /* A code works for LOGIN_CODE_MINUTES; a new code replaces the last one. */
  aMinuteLater(s); await askCode(s, "ann@example.edu");
  const c1 = s.mailer.code("ann@example.edu")!;
  aMinuteLater(s); await askCode(s, "ann@example.edu");
  const c2 = s.mailer.code("ann@example.edu")!;
  if (c1 !== c2) assert.equal((await signIn(s, { email: "ann@example.edu", code: c1, inviteCode: "CODE-A" })).status, 401);
  s.store.db.exec("UPDATE login_codes SET expires_at = '2000-01-01T00:00:00.000Z'");
  assert.equal(isError(await signIn(s, { email: "ann@example.edu", code: c2, inviteCode: "CODE-A" })).message, "That code has expired. Ask for a new one.");
});

test("sending codes: one a minute and five an hour to an address, LOGIN_CODES_PER_HOUR in all; a failed email is a 502", async t => {
  const s = setup({ env: { LOGIN_CODES_PER_HOUR: "7" } }); t.after(() => s.close());
  assert.equal((await askCode(s, "a@example.edu")).status, 204);
  const soon = await askCode(s, "a@example.edu");
  assert.equal(soon.status, 429); assert.match(isError(soon).message, /less than a minute ago/);
  for (let i = 0; i < 4; i++) { aMinuteLater(s); assert.equal((await askCode(s, "a@example.edu")).status, 204); }
  s.store.db.exec("UPDATE code_sends SET created_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-2 minutes')");
  const hour = await askCode(s, "a@example.edu");
  assert.equal(hour.status, 429); assert.match(isError(hour).message, /^Too many codes were sent to this address/);
  /* 5 sent; 2 more to other addresses reach the limit of 7. */
  assert.equal((await askCode(s, "b@example.edu")).status, 204);
  assert.equal((await askCode(s, "c@example.edu")).status, 204);
  const all = await askCode(s, "d@example.edu");
  assert.equal(all.status, 429); assert.equal(isError(all).message, "Too many people are signing in right now. Try again in a few minutes.");

  const f = setup(); t.after(() => f.close());
  f.mailer.error = new Error("Resend 500");
  const failed = await askCode(f, "a@example.edu");
  assert.equal(failed.status, 502); assert.equal(isError(failed).message, "Sidenote could not send the email just now. Try again in a moment.");
  assert.equal(f.store.loginCode("a@example.edu"), undefined);
});

test("EMAIL_DOMAINS: only university addresses (and their subdomains) get a code", async t => {
  const s = setup({ env: { EMAIL_DOMAINS: "connect.hku.hk, @ust.hk" } }); t.after(() => s.close());
  const r = await askCode(s, "a@gmail.com");
  assert.equal(r.status, 400); assert.equal(isError(r).message, "Sign in with your university email (ending in @connect.hku.hk or @ust.hk).");
  assert.equal((await askCode(s, "a@notconnect.hku.hk")).status, 400);
  assert.equal((await askCode(s, "a@connect.hku.hk")).status, 204);
  assert.equal((await askCode(s, "b@cse.ust.hk")).status, 204);
  assert.equal((await signIn(s, { email: "x@gmail.com", code: "123456" })).status, 400);
});

test("SIGN_IN=invite: no codes by email; the invite code alone signs in", async t => {
  const s = setup({ env: { SIGN_IN: "invite" } }); t.after(() => s.close());
  assert.equal((await askCode(s, "a@example.edu")).status, 404);
  assert.equal(s.mailer.sent.length, 0);
  assert.equal((await signIn(s, { inviteCode: "CODE-A" })).status, 200);
  assert.throws(() => setup({ env: { SIGN_IN: "google" } }), /SIGN_IN must be email or invite/);
});

test("a sign-in not used for SESSION_DAYS ends; one in use goes on", async t => {
  const s = setup({ env: { SESSION_DAYS: "30" } }); t.after(() => s.close());
  const used = await s.signIn(), idle = await s.signIn("CODE-B");
  const ago = (days: number) => new Date(Date.now() - days * 86400_000).toISOString();
  s.store.db.prepare("UPDATE sessions SET last_used = ?").run(ago(29));
  assert.equal((await s.call("GET", "/home", { token: used })).status, 200);   // and marks it used now
  s.store.db.prepare("UPDATE sessions SET last_used = ? WHERE user_id = ?").run(ago(31), s.store.userByCode("CODE-B")!.id);
  const ended = await s.call("GET", "/home", { token: idle });
  assert.equal(ended.status, 401); assert.equal(isError(ended).message, "Please sign in again.");
  assert.equal(s.store.db.prepare("SELECT COUNT(*) AS n FROM sessions").get()!.n, 1);
  /* Sign-ins from phases 1 to 3 (no last_used yet) count from when they were made. */
  s.store.db.prepare("UPDATE sessions SET last_used = NULL, created_at = ?").run(ago(1));
  assert.equal((await s.call("GET", "/home", { token: used })).status, 200);
});
