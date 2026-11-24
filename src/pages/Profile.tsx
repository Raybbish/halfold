/* ---------- who you are: asked once after the first sign-in, and kept in Settings ----------
   The designers' draft of 2026-11-24 (halfold(1).html: YEARS, ORIGINS, profileFields, readProfile, needsWelcome,
   welcomePage, saveProfile, skipProfile, profileNudge, profileCard), for the handoff of 2026-11-23, item 4. API-CHANGES.md 14.
   - #/welcome is shown on the way to the home page while GET /home says user.profile is null, unless the student chose
     "Skip for now" (kept in this browser as in the draft, and on the server as user.profileSkipped, so another device does
     not ask again), or an unfinished recording is waiting (state/router.ts).
   - Every field is optional. Both consent boxes start empty, each on its own, tied to nothing else. Their wording is the
     draft's; the server keeps which wording each answer was given to (server/src/profile.ts CONSENT_WORDING).
   - Someone who skipped sees one quiet line on the home page (ProfileNudge); Settings has the same form (AboutCard).
   The draft's promo code field on this page is left out: billing is not built. */
import type { Origin, Profile, ProfileUpdate, YearOfStudy } from "../types";
import { api } from "../api/api";
import { bump } from "../lib/bus";
import { store } from "../lib/store";
import { CONFIG } from "../config";
import { S, session } from "../state/app";
import { act, toast } from "../state/overlay";
import { LANG, t } from "../i18n";
import { live } from "../features/recording/recorder";
import { Logo, Hal } from "../ui/icons";
import { LangBtn } from "../ui/Shell";
import { css } from "../ui/css";

export const YEARS: [YearOfStudy, string][] = [["y1", "Year 1"], ["y2", "Year 2"], ["y3", "Year 3"], ["y4", "Year 4 or above"], ["tpg", "Taught master's"], ["rpg", "Research postgraduate"], ["other", "Other"]];
export const ORIGINS: ["" | Origin, string][] = [["", "Prefer not to say"], ["hk", "Hong Kong"], ["cn", "Mainland China"], ["tw", "Taiwan"], ["mo", "Macau"], ["other", "Somewhere else"]];
export const CONSENT_MARKETING = "Send me messages about jobs, further study and student offers that fit my course and year. Halfold sends them itself and does not pass my details to anyone.";
export const CONSENT_SURVEY = "Invite me to paid student surveys.";

/* Ask on the way to the home page: only when the server says there is no profile yet (a server that does not know about
   profiles sends nothing), and not over an unfinished recording. */
export const needsWelcome = () => !!(S.user && S.user.profile === null && !store.get("welcomed") && !S.user.profileSkipped && !S.orphan && !live.active);
const skipped = () => !!(S.user && S.user.profile === null && (store.get("welcomed") || S.user.profileSkipped));

/* What is typed, kept across redraws (every bump() draws the page anew, and a change of language too). It starts again
   from the saved profile whenever that changes. school: null until the student types in it, so the school guessed from
   the email address follows the interface language. */
type Draft = { from: Profile | null | undefined; school: string | null; major: string; year: string; grad: string; origin: string; mk: boolean; sv: boolean };
const draft: Draft = { from: undefined, school: null, major: "", year: "", grad: "", origin: "", mk: false, sv: false };
function fresh() {
  const p = S.user ? S.user.profile : undefined;
  if (draft.from === p) return;
  Object.assign(draft, { from: p, school: p ? p.school : null, major: p ? p.major : "", year: p ? p.yearOfStudy : "", grad: p && p.gradYear ? String(p.gradYear) : "",
    origin: p ? p.origin : "", mk: !!(p && p.consentMarketing), sv: !!(p && p.consentSurvey) });
}
const guess = () => { const g = S.schoolGuess; return !g ? "" : LANG === "zh-Hant" ? g.zhHant : LANG === "zh-Hans" ? g.zhHans : g.en; };
const school = () => draft.school ?? guess();
/* The draft's readProfile: every field, as typed. */
const readProfile = (): ProfileUpdate => ({ school: school().trim(), major: draft.major.trim(), yearOfStudy: draft.year as YearOfStudy | "", gradYear: draft.grad, origin: draft.origin as Origin | "", consentMarketing: draft.mk, consentSurvey: draft.sv });

function ProfileFields() {
  const y = new Date().getFullYear(), years = [0, 1, 2, 3, 4, 5, 6].map(i => String(y + i)), g = guess();
  if (draft.grad && !years.includes(draft.grad)) years.unshift(draft.grad);   // a year saved before, no longer in the list: kept
  const schools = [g, ...CONFIG.SCHOOLS.filter(s => s !== g)].filter(Boolean);
  return <>
    <label className="field"><span>{t("University")}</span><input name="school" list="schools" maxLength={80} autoComplete="organization" placeholder="HKUST" data-notr="" defaultValue={school()} onInput={e => { draft.school = e.currentTarget.value; }} />
      <datalist id="schools">{schools.map(s => <option key={s} value={s} />)}</datalist></label>
    <label className="field"><span>{t("What you study")}</span><input name="major" maxLength={80} placeholder={t("Economics and Finance")} defaultValue={draft.major} onInput={e => { draft.major = e.currentTarget.value; }} /></label>
    <div style={css("display:grid;grid-template-columns:1fr 1fr;gap:12px")}>
      <label className="field"><span>{t("Year")}</span><select name="year" defaultValue={draft.year} onChange={e => { draft.year = e.currentTarget.value; }}>
        <option value="" data-notr=""></option>{YEARS.map(([v, n]) => <option key={v} value={v}>{t(n)}</option>)}</select></label>
      <label className="field"><span>{t("Graduating in")}</span><select name="grad" data-notr="" defaultValue={draft.grad} onChange={e => { draft.grad = e.currentTarget.value; }}>
        <option value=""></option>{years.map(v => <option key={v} value={v}>{v}</option>)}</select></label>
    </div>
    <label className="field"><span>{t("Where you studied before university (optional)")}</span><select name="origin" defaultValue={draft.origin} onChange={e => { draft.origin = e.currentTarget.value; }}>
      {ORIGINS.map(([v, n]) => <option key={v} value={v}>{t(n)}</option>)}</select></label>
    <div className="consent">
      <label><input type="checkbox" name="mk" defaultChecked={draft.mk} onChange={e => { draft.mk = e.currentTarget.checked; }} /><span>{t(CONSENT_MARKETING)}</span></label>
      <label><input type="checkbox" name="sv" defaultChecked={draft.sv} onChange={e => { draft.sv = e.currentTarget.checked; }} /><span>{t(CONSENT_SURVEY)}</span></label>
      <p className="small muted">{t("Both are off unless you tick them, and you can change them in Settings at any time.")}</p>
    </div>
  </>;
}

export function Welcome() {
  fresh();
  return <div className="pub dots" style={css("min-height:100vh")}><nav className="pub-nav"><Logo href="#/home" /><span className="sp"></span><LangBtn /></nav>
    <div className="center"><form className="auth welcome" style={css("max-width:520px")} onSubmit={e => { e.preventDefault(); saveProfile(true); }}>
      <div style={css("display:flex;gap:12px;align-items:center;margin-bottom:6px")}><Hal size={44} mood="smile" /><h1 style={css("font-size:26px")}>{t("One more step")}</h1></div>
      <p className="muted" style={css("margin-bottom:18px")}>{t("This puts you with classmates on the same courses, so the notes they share are easy to find.")}</p>
      <ProfileFields />
      <button className="btn primary" style={css("width:100%")}>{t("Save and continue")}</button>
      <p className="small muted" style={css("margin-top:12px;text-align:center")}><button type="button" className="ts skip" style={css("font-size:inherit")} onClick={skipProfile}>{t("Skip for now")}</button></p>
    </form></div></div>;
}

function saveProfile(first: boolean) { act(async () => {
  const r = await api.updateProfile(readProfile());
  S.user!.profile = r.profile; S.user!.profileSkipped = false; S.schoolGuess = r.profile.school ? null : S.schoolGuess; session.save(); store.set("welcomed", "1");
  if (!first) { toast("Saved"); bump(); return; }
  location.hash = "#/home"; }); }
/* Kept in this browser at once (as in the draft), and on the server for other devices; a failed request does not stop the student. */
function skipProfile() { store.set("welcomed", "1"); api.profileLater().catch(() => {}); location.hash = "#/home"; }

/* On the home page, for someone who skipped the step: one quiet line, not a wall. */
export function ProfileNudge() {
  if (!skipped()) return null;
  return <a className="card nudge" href="#/welcome"><Hal size={30} mood="smile" /><span className="grow"><b>{t("Tell Halfold your university and year")}</b><span className="small muted">{t("It puts you with classmates on the same courses.")}</span></span><span className="ts">{t("Fill it in")}</span></a>;
}

/* Settings: the same form. A server that does not know about profiles sends none, and the card is not shown. */
export function AboutCard() {
  if (!S.user || S.user.profile === undefined) return null;
  fresh();
  return <form className="card about-card" style={css("padding:22px;max-width:640px;margin-bottom:18px")} onSubmit={e => { e.preventDefault(); saveProfile(false); }}>
    <h2 style={css("font-size:18px;margin-bottom:14px")}>{t("About you")}</h2>
    <ProfileFields />
    <button className="btn primary">{t("Save")}</button></form>;
}
