/* ---------- sign in ---------- */
import { api } from "../api/api";
import { bump } from "../lib/bus";
import { S, auth, exHref, session } from "../state/app";
import { t } from "../i18n";
import { Logo, Sid } from "../ui/icons";
import { LangBtn } from "../ui/Shell";
import { css } from "../ui/css";
import { val } from "../ui/form";

export function SignIn() {
  return <div className="pub dots" style={css("min-height:100vh")}><nav className="pub-nav"><Logo href="#/" /><span className="sp"></span><LangBtn /></nav>
    <div className="center"><form className="auth" onSubmit={e => { e.preventDefault(); doSignIn(e.currentTarget); }}>
      <div style={css("display:flex;gap:12px;align-items:center;margin-bottom:6px")}><Sid size={44} mood="smile" /><h1 style={css("font-size:26px")}>{t("Sign in to Sidenote")}</h1></div>
      <p className="muted" style={css("margin-bottom:20px")}>{t("Sidenote is invite only for now. Enter the code you were given.")}</p>
      <label className="field"><span>{t("Invite code")}</span><input name="code" autoComplete="one-time-code" placeholder={t("For example a3f9c2")} defaultValue={auth.code} required /></label>
      <label className="field"><span>{t("Your name (optional)")}</span><input name="name" autoComplete="given-name" placeholder={t("What should we call you?")} defaultValue={auth.name} /></label>
      {auth.err ? <p className="err" role="alert">{t(auth.err)}</p> : null}
      <button className="btn primary" style={css("width:100%")} disabled={auth.busy}>{t(auth.busy ? "Signing in" : "Sign in")}</button>
      <p className="small muted" style={css("margin-top:14px")}>{exHref() ? <>{t("No code? Ask a classmate who uses Sidenote, or open the ")}<a href={exHref()}>{t("example notes")}</a>{t(".")}</> : t("No code? Ask a classmate who uses Sidenote.")}</p>
    </form></div></div>;
}

async function doSignIn(f: HTMLFormElement) {
  const code = val(f, "code"), name = val(f, "name"); Object.assign(auth, { busy: true, err: "", code, name }); bump();
  try { const r = await api.signIn(code, name); S.token = r.token; S.user = r.user; session.save(); Object.assign(auth, { busy: false, code: "", name: "" }); const n = S.next || "#/home"; S.next = null; location.hash = n; }
  catch (e) { auth.busy = false; auth.err = (e as Error).message; bump(); }
}
