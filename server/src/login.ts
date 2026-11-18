/* Signing in (public endpoints). SIGN_IN=email (phase 4, the default): POST /session/code sends a 6-digit code to the
   student's address, and POST /session with that code signs them in. An address Halfold has not seen yet also needs
   an invite code the first time: the address is then bound to that code's account for good. That is how students of
   phases 1 to 3 keep their lectures: they enter their old invite code once, with their email. One invite code is still
   one account, so a code works for one address only.
   SIGN_IN=invite: the invite code alone, as in phases 1 to 3 (POST /session {inviteCode, name}).
   Wrong codes and invite codes are 401 and 403 with a message; the sign-in page shows it as it is (http.ts: public calls). */
import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { Hono } from "hono";
import type { SessionReply } from "../../src/types";
import type { UserRow } from "./db";
import { fail, jsonBody } from "./http/errors";
import { codeMail } from "./mail";
import { str, type AppEnv, type Deps } from "./routes";

const MAX_TRIES = 5;                  // wrong codes before the code stops working
const RESEND_AFTER_MS = 60_000;       // one code a minute to an address
const PER_ADDRESS_HOUR = 5;           // and five an hour
export const NEW_ADDRESS = "This email is new to Halfold. Enter your invite code to finish signing in. Used Halfold before? Enter the invite code you signed in with, and your lectures come with you.";

export const normEmail = (v: unknown) => str(v).toLowerCase();
const looksLikeEmail = (e: string) => e.length <= 254 && /^[^\s@]{1,64}@[^\s@.]+(\.[^\s@.]+)+$/.test(e);

export function loginRoutes(deps: Deps) {
  const { config, store, mailer } = deps;
  const r = new Hono<AppEnv>();
  const hash = (email: string, code: string) => createHmac("sha256", store.secret()).update(`login:${email}:${code}`).digest("hex");
  const signedIn = (user: UserRow, name: string) => {
    if (name && name !== user.name) store.setUserName(user.id, name);
    return { token: store.createSession(user.id), user: { name: name || user.name } } satisfies SessionReply;
  };
  const address = (v: unknown) => {
    const email = normEmail(v);
    if (!looksLikeEmail(email)) fail(400, "Enter your email address.");
    const domains = config.login.emailDomains;
    if (domains.length && !domains.some(d => email.endsWith("@" + d) || email.endsWith("." + d)))
      fail(400, `Sign in with your university email (ending in ${domains.map(d => "@" + d).join(" or ")}).`);
    return email;
  };

  r.post("/session/code", async c => {
    if (config.signIn !== "email") fail(404, "Sign in with your invite code.");
    const email = address((await jsonBody(c)).email), now = Date.now();
    const last = store.lastCodeSent(email);
    if (last && now - Date.parse(last) < RESEND_AFTER_MS) fail(429, "A code was sent to this address less than a minute ago. Check your inbox and spam folder, or ask again in a minute.");
    const hourAgo = new Date(now - 3600_000).toISOString();
    if (store.codesSent(email, hourAgo) >= PER_ADDRESS_HOUR) fail(429, "Too many codes were sent to this address in the last hour. Use the latest one, or try again later.");
    if (store.codesSent(null, hourAgo) >= config.login.codesPerHour) fail(429, "Too many people are signing in right now. Try again in a few minutes.");
    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    store.saveLoginCode(email, hash(email, code), new Date(now + config.login.codeMinutes * 60_000).toISOString());
    try { await mailer.send(codeMail(email, code, config.login.codeMinutes)); }
    catch (e) {
      console.warn(`[login] sending a code with ${mailer.provider}: ${(e as Error).message}`);
      store.dropLoginCode(email);
      fail(502, "Halfold could not send the email just now. Try again in a moment.");
    }
    return c.body(null, 204);
  });

  r.post("/session", async c => {
    const b = await jsonBody(c), name = str(b.name).slice(0, 60), invite = str(b.inviteCode);
    if (config.signIn === "invite") {
      if (!invite) fail(400, "Enter your invite code.");
      return c.json(signedIn(store.userByCode(invite) ?? fail(401, "That invite code is not valid."), name));
    }
    if (!str(b.email)) fail(400, invite ? "Sign in with your email address now. Reload the page to see the new sign-in." : "Enter your email address.");
    const email = address(b.email), code = str(b.code).replace(/\s+/g, "");
    if (!/^\d{6}$/.test(code)) fail(400, "Enter the 6-digit code from the email.");
    const row = store.loginCode(email);
    if (!row || Date.parse(row.expires_at) < Date.now()) fail(401, "That code has expired. Ask for a new one.");
    const want = Buffer.from(row!.code_hash), got = Buffer.from(hash(email, code));
    if (want.length !== got.length || !timingSafeEqual(want, got)) {
      if (store.wrongCode(email) >= MAX_TRIES) { store.dropLoginCode(email); fail(401, "That code is not right, and it has now stopped working. Ask for a new one."); }
      fail(401, "That code is not right. Check the latest email from Halfold.");
    }
    let user = store.userByEmail(email);
    if (!user) {
      /* The code is right but the address is new: the code stays valid, so the student can send it again with an invite code. */
      if (!invite) fail(403, NEW_ADDRESS);
      const owner = store.userByCode(invite) ?? fail(403, "That invite code is not valid.");
      if (owner.email || !store.bindEmail(owner.id, email)) fail(403, "That invite code is already used with another email address.");
      user = store.user(owner.id)!;
    }
    store.dropLoginCode(email);
    return c.json(signedIn(user, name));
  });

  return r;
}
