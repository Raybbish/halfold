/* ---------- the profile and the two consents (handoff of 2026-11-23, item 4; API-CHANGES.md 14) ----------
   #/welcome: asked once after signing in, while GET /home says askProfile (state/router.ts sends every signed-in page
   here first). "signup", a new account: the form has to be filled in. "once", an account from before: it can be put off
   with Not now, and is not asked again either way. Settings has the same fields (ProfileCard) and the two consents on a
   card of their own (ConsentCard), so either can be withdrawn without touching the rest.
   The two boxes are separate, never ticked to begin with, and not tied to anything else. Their wording is a placeholder
   until the final text comes; the server keeps which wording each answer was given to (server/src/profile.ts). */
import type { Origin, Profile, ProfileUpdate, YearOfStudy } from "../types";
import { api } from "../api/api";
import { bump } from "../lib/bus";
import { S } from "../state/app";
import { act, toast } from "../state/overlay";
import { LANG, t } from "../i18n";
import { Logo, Hal } from "../ui/icons";
import { LangBtn } from "../ui/Shell";
import { css } from "../ui/css";

export const YEARS: [YearOfStudy, string][] = [["year1", "Year 1"], ["year2", "Year 2"], ["year3", "Year 3"], ["year4", "Year 4"], ["year5", "Year 5"], ["masters", "Master's"], ["phd", "PhD"]];
export const ORIGINS: [Origin, string][] = [["mainland", "Mainland China"], ["hk-local", "Hong Kong (local student)"], ["taiwan", "Taiwan"], ["other", "Somewhere else"]];
/* Placeholder wording (handoff, item 4), the same in Chinese as the handoff's table. */
export const CONSENT_MARKETING = "I am willing to receive recruiting, further study and student offer messages.";
export const CONSENT_SURVEY = "I am willing to take part in paid surveys.";

/* What is typed, kept across redraws (every bump() draws the page anew, and a change of language too). It starts again
   from the saved profile whenever that changes. school: null until the student types in it, so the school guessed from
   the email address follows the interface language. */
const draft = { from: undefined as Profile | null | undefined, school: null as string | null, major: "", year: "", grad: "", origin: "", mkt: false, srv: false, busy: false, err: "" };
function fresh() {
  if (draft.from === S.profile) return draft;
  const p = S.profile;
  return Object.assign(draft, { from: p, school: p && p.school ? p.school : null, major: p ? p.major : "", year: (p && p.yearOfStudy) || "", grad: p && p.gradYear ? String(p.gradYear) : "",
    origin: (p && p.origin) || "", mkt: !!(p && p.consentMarketing), srv: !!(p && p.consentSurvey), busy: false, err: "" });
}
const guess = () => { const g = S.schoolGuess; return !g ? "" : LANG === "zh-Hant" ? g.zhHant : LANG === "zh-Hans" ? g.zhHans : g.en; };
const school = () => draft.school ?? guess();
const fields = (): ProfileUpdate => ({ school: school().trim(), major: draft.major.trim(), yearOfStudy: draft.year as YearOfStudy, gradYear: Number(draft.grad), origin: draft.origin as Origin });

function Fields() {
  return <>
    <label className="field"><span>{t("School")}</span><input name="school" autoComplete="organization" maxLength={100} placeholder={t("Your university or college")} defaultValue={school()} onInput={e => { draft.school = e.currentTarget.value; }} required /></label>
    <label className="field"><span>{t("Major")}</span><input name="major" maxLength={100} placeholder={t("For example Economics")} defaultValue={draft.major} onInput={e => { draft.major = e.currentTarget.value; }} required /></label>
    <div style={css("display:flex;gap:0 12px;flex-wrap:wrap")}>
      <label className="field" style={css("flex:1 1 150px")}><span>{t("Year of study")}</span><select name="yearOfStudy" defaultValue={draft.year} onChange={e => { draft.year = e.currentTarget.value; }} required>
        <option value="">{t("Choose")}</option>{YEARS.map(([v, n]) => <option key={v} value={v}>{t(n)}</option>)}</select></label>
      <label className="field" style={css("flex:1 1 150px")}><span>{t("Year you graduate")}</span><input name="gradYear" inputMode="numeric" pattern="[0-9]{4}" maxLength={4} placeholder={t("For example 2028")} defaultValue={draft.grad} onInput={e => { draft.grad = e.currentTarget.value.trim(); }} required /></label>
    </div>
    <label className="field"><span>{t("Where you are from")}</span><select name="origin" defaultValue={draft.origin} onChange={e => { draft.origin = e.currentTarget.value; }} required>
      <option value="">{t("Choose")}</option>{ORIGINS.map(([v, n]) => <option key={v} value={v}>{t(n)}</option>)}</select></label>
  </>;
}

/* The two boxes, each on its own. "Agreed on" under a ticked one that was saved ticked: when the student agreed. */
const agreed = (at: string | null | undefined, on: boolean) => on && at ? <span className="small muted consent-at" style={css("display:block;font-weight:400;margin-top:2px")}>{t("Agreed on " + new Date(at).toLocaleDateString(LANG === "zh-Hant" ? "zh-HK" : LANG === "zh-Hans" ? "zh-CN" : "en-GB", { day: "numeric", month: "short", year: "numeric" }))}</span> : null;
function Consents({ saved }: { saved?: boolean }) {
  const p = S.profile;
  return <div className="consents" style={css("margin:4px 0 16px")}>
    <label style={css("display:flex;gap:10px;align-items:flex-start;margin-bottom:10px;font-weight:600;cursor:pointer")}><input type="checkbox" name="consentMarketing" defaultChecked={draft.mkt} onChange={e => { draft.mkt = e.currentTarget.checked; }} style={css("margin-top:4px")} />
      <span>{t(CONSENT_MARKETING)}{saved ? agreed(p && p.consentMarketingAt, !!(p && p.consentMarketing)) : null}</span></label>
    <label style={css("display:flex;gap:10px;align-items:flex-start;margin-bottom:10px;font-weight:600;cursor:pointer")}><input type="checkbox" name="consentSurvey" defaultChecked={draft.srv} onChange={e => { draft.srv = e.currentTarget.checked; }} style={css("margin-top:4px")} />
      <span>{t(CONSENT_SURVEY)}{saved ? agreed(p && p.consentSurveyAt, !!(p && p.consentSurvey)) : null}</span></label>
    <p className="small muted">{t(saved ? "Both are up to you, and separate. Untick one and save to withdraw it." : "Both are up to you, and separate. You can untick either one at any time in Settings.")}</p>
  </div>;
}

export function Welcome() {
  fresh(); const once = S.askProfile === "once";
  return <div className="pub dots" style={css("min-height:100vh")}><nav className="pub-nav"><Logo href="#/" /><span className="sp"></span><LangBtn /></nav>
    <div className="center"><form className="auth welcome" style={css("max-width:520px")} onSubmit={e => { e.preventDefault(); answer(); }}>
      <div style={css("display:flex;gap:12px;align-items:center;margin-bottom:6px")}><Hal size={44} mood="smile" /><h1 style={css("font-size:26px")}>{t("A few things about you")}</h1></div>
      <p className="muted" style={css("margin-bottom:20px")}>{t(once ? "Halfold now asks every student for these. Answer once, or choose Not now and you will not be asked again. You can change them any time in Settings." : "Tell us about your studies to finish signing up. You can change this any time in Settings.")}</p>
      <Fields /><Consents />
      {draft.err ? <p className="err" role="alert">{t(draft.err)}</p> : null}
      <button className="btn primary" style={css("width:100%")} disabled={draft.busy}>{t(draft.busy ? "Saving" : once ? "Save" : "Continue")}</button>
      {once ? <button type="button" className="btn plain sm later" style={css("margin-top:12px")} onClick={putOff} disabled={draft.busy}>{t("Not now")}</button> : null}
    </form></div></div>;
}

function onward() { S.askProfile = null; const n = S.next && S.next !== "#/welcome" ? S.next : "#/home"; S.next = null; location.hash = n; }
async function answer() {
  Object.assign(draft, { busy: true, err: "" }); bump();
  try { const p = await api.updateProfile({ ...fields(), consentMarketing: draft.mkt, consentSurvey: draft.srv }); S.profile = p; S.schoolGuess = null; draft.busy = false; onward(); }
  catch (e) { Object.assign(draft, { busy: false, err: (e as Error).message }); bump(); }
}
async function putOff() {
  Object.assign(draft, { busy: true, err: "" }); bump();
  try { await api.profileLater(); draft.busy = false; onward(); }
  catch (e) { Object.assign(draft, { busy: false, err: (e as Error).message }); bump(); }
}

/* ---------- Settings ---------- */
export function ProfileCard() {
  fresh();
  return <form className="card profile-card" style={css("padding:22px;max-width:640px;margin-bottom:18px")} onSubmit={e => { e.preventDefault(); act(async () => { S.profile = await api.updateProfile(fields()); S.schoolGuess = null; toast("Details saved"); bump(); }); }}>
    <h2 style={css("font-size:18px;margin-bottom:14px")}>{t("Your studies")}</h2>
    <Fields />
    <button className="btn primary">{t("Save details")}</button></form>;
}
export function ConsentCard() {
  fresh();
  return <form className="card consent-card" style={css("padding:22px;max-width:640px;margin-bottom:18px")} onSubmit={e => { e.preventDefault(); act(async () => { S.profile = await api.updateProfile({ consentMarketing: draft.mkt, consentSurvey: draft.srv }); toast("Choices saved"); bump(); }); }}>
    <h2 style={css("font-size:18px;margin-bottom:14px")}>{t("Messages and surveys")}</h2>
    <Consents saved />
    <button className="btn primary">{t("Save choices")}</button></form>;
}
