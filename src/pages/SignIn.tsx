/* ---------- sign in ----------
   CONFIG.SIGN_IN "invite" (the default): the invite code, as in sidenote.html. "email" (set by the backend from phase 4):
   the student's email, then the 6-digit code sent to it; an email new to Halfold also needs an invite code once. The
   invite code field is on the form from the start (empty for someone who signed in with this email before), so it is
   not sprung on people after they sent the code; when the server still asks for it (403), the field is marked and the
   code from the email stays typed in, since it is still good. */
import { api } from "../api/api";
import type { HttpError } from "../api/http";
import { CONFIG } from "../config";
import { bump } from "../lib/bus";
import { S, auth, exHref, session } from "../state/app";
import { toast } from "../state/overlay";
import { isZh, t } from "../i18n";
import { Logo, Hal } from "../ui/icons";
import { LangBtn } from "../ui/Shell";
import { css } from "../ui/css";
import { val } from "../ui/form";

export function SignIn() {
  if (CONFIG.SIGN_IN === "email") return <EmailSignIn />;
  return <div className="pub dots" style={css("min-height:100vh")}><nav className="pub-nav"><Logo href="#/" /><span className="sp"></span><LangBtn /></nav>
    <div className="center"><form className="auth" onSubmit={e => { e.preventDefault(); doSignIn(e.currentTarget); }}>
      <div style={css("display:flex;gap:12px;align-items:center;margin-bottom:6px")}><Hal size={44} mood="smile" /><h1 style={css("font-size:26px")}>{t("Sign in to Halfold")}</h1></div>
      <p className="muted" style={css("margin-bottom:20px")}>{t("Halfold is invite only for now. Enter the code you were given.")}</p>
      <label className="field"><span>{t("Invite code")}</span><input name="code" autoComplete="one-time-code" placeholder={t("For example a3f9c2")} defaultValue={auth.code} required /></label>
      <label className="field"><span>{t("Your name (optional)")}</span><input name="name" autoComplete="given-name" placeholder={t("What should we call you?")} defaultValue={auth.name} /></label>
      {auth.err ? <p className="err" role="alert">{t(auth.err)}</p> : null}
      <button className="btn primary" style={css("width:100%")} disabled={auth.busy}>{t(auth.busy ? "Signing in" : "Sign in")}</button>
      <p className="small muted" style={css("margin-top:14px")}>{exHref() ? <>{t("No code? Ask a classmate who uses Halfold, or open the ")}<a href={exHref()}>{t("example notes")}</a>{t(".")}</> : t("No code? Ask a classmate who uses Halfold.")}</p>
    </form></div></div>;
}

/* The invite code field, on both steps. Marked (and required) once the server asked for it. */
const InviteField = () => <label className={`field ${auth.invite ? "need" : ""}`}><span>{t("Invite code (only the first time)")}</span><input name="code" autoComplete="off" placeholder={t("For example a3f9c2")} defaultValue={auth.code} onInput={e => { auth.code = e.currentTarget.value; }} required={auth.invite} /></label>;

function EmailSignIn() {
  const second = auth.step === "code";
  return <div className="pub dots" style={css("min-height:100vh")}><nav className="pub-nav"><Logo href="#/" /><span className="sp"></span><LangBtn /></nav>
    <div className="center"><form className="auth" onSubmit={e => { e.preventDefault(); if (second) doCodeSignIn(e.currentTarget); else doSendCode(e.currentTarget); }}>
      <div style={css("display:flex;gap:12px;align-items:center;margin-bottom:6px")}><Hal size={44} mood="smile" /><h1 style={css("font-size:26px")}>{t("Sign in to Halfold")}</h1></div>
      {second ? <>
        <p className="muted" style={css("margin-bottom:20px")}>{t("We sent a 6-digit code to " + auth.email + ". Check your inbox and spam folder.")}</p>
        <label className="field"><span>{t("Code from the email")}</span><input name="otp" inputMode="numeric" autoComplete="one-time-code" maxLength={7} placeholder="123456" defaultValue={auth.otp} onInput={e => { auth.otp = e.currentTarget.value; }} required /></label>
        <InviteField />
        {auth.need ? <p className="small need-note" role="alert">{t(auth.need)}{isZh() ? "" : " "}{t("Your code from the email is still good.")}</p> : null}
        {auth.invite || auth.code ? <label className="field"><span>{t("Your name (optional)")}</span><input name="name" autoComplete="given-name" placeholder={t("What should we call you?")} defaultValue={auth.name} onInput={e => { auth.name = e.currentTarget.value; }} /></label> : null}
      </> : <>
        <p className="muted" style={css("margin-bottom:20px")}>{t("Enter your email. Halfold sends you a 6-digit code to sign in.")}</p>
        <label className="field"><span>{t("Email")}</span><input name="email" type="email" inputMode="email" autoComplete="email" placeholder={t("you@university.edu")} defaultValue={auth.email} onInput={e => { auth.email = e.currentTarget.value; }} required /></label>
        <InviteField />
      </>}
      {auth.err ? <p className="err" role="alert">{t(auth.err)}</p> : null}
      <button className="btn primary" style={css("width:100%")} disabled={auth.busy}>{t(auth.busy ? (second ? "Signing in" : "Sending") : (second ? "Sign in" : "Send code"))}</button>
      {second ? <div style={css("display:flex;gap:8px;flex-wrap:wrap;margin-top:12px")}>
        <button type="button" className="btn plain sm" onClick={otherEmail} disabled={auth.busy}>{t("Use another email")}</button>
        <button type="button" className="btn plain sm" onClick={resendCode} disabled={auth.busy}>{t("Send a new code")}</button></div>
        : <p className="small muted" style={css("margin-top:14px")}>{exHref() ? <>{t("Signed in with this email before? Leave the invite code empty. New to Halfold? Ask a classmate who uses it for an invite code, or open the ")}<a href={exHref()}>{t("example notes")}</a>{t(".")}</> : t("Signed in with this email before? Leave the invite code empty. New to Halfold? Ask a classmate who uses it for an invite code.")}</p>}
    </form></div></div>;
}

function signedIn(token: string, user: { name: string }) {
  S.token = token; S.user = user; session.save();
  Object.assign(auth, { busy: false, err: "", code: "", name: "", email: "", otp: "", step: "email", invite: false, need: "" });
  const n = S.next || "#/home"; S.next = null; location.hash = n;
}

async function doSignIn(f: HTMLFormElement) {
  const code = val(f, "code"), name = val(f, "name"); Object.assign(auth, { busy: true, err: "", code, name }); bump();
  try { const r = await api.signIn(code, name); signedIn(r.token, r.user); }
  catch (e) { auth.busy = false; auth.err = (e as Error).message; bump(); }
}

async function doSendCode(f: HTMLFormElement) {
  const email = val(f, "email").trim(), code = val(f, "code").trim(); Object.assign(auth, { busy: true, err: "", email, code }); bump();
  try { await api.sendCode(email); Object.assign(auth, { busy: false, step: "code", invite: false, need: "", otp: "" }); bump(); }
  catch (e) { auth.busy = false; auth.err = (e as Error).message; bump(); }
}

/* A 403 without an invite code is the server asking for one (an address new to Halfold): a note under the marked field,
   not an error. A 403 with one (not valid, used with another address) is an error, and the field is marked too. */
async function doCodeSignIn(f: HTMLFormElement) {
  const otp = val(f, "otp"), code = val(f, "code").trim(), name = f.querySelector("input[name=name]") ? val(f, "name") : "";
  Object.assign(auth, { busy: true, err: "", need: "", otp, code, name }); bump();
  try { const r = await api.signInWithCode(auth.email, otp, name, code); signedIn(r.token, r.user); }
  catch (e) { const msg = (e as Error).message; auth.busy = false;
    if ((e as HttpError).status === 403) { auth.invite = true; if (code) auth.err = msg; else auth.need = msg; } else auth.err = msg;
    bump(); (f.querySelector(auth.invite ? "input[name=code]" : "input[name=otp]") as HTMLInputElement | null)?.focus(); }
}

function otherEmail() { Object.assign(auth, { step: "email", err: "", invite: false, need: "", otp: "", name: "" }); bump(); }
async function resendCode() {
  Object.assign(auth, { busy: true, err: "" }); bump();
  try { await api.sendCode(auth.email); Object.assign(auth, { busy: false, otp: "" }); bump(); toast("A new code is on its way."); }
  catch (e) { auth.busy = false; auth.err = (e as Error).message; bump(); }
}
