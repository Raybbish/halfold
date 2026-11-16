/* ---------- settings, with the plans filled in by the backend ---------- */
import type { ZhScript } from "../types";
import { api } from "../api/api";
import { plural } from "../lib/helpers";
import { store } from "../lib/store";
import { bump } from "../lib/bus";
import { LANGS, S, nf, session } from "../state/app";
import { act, toast } from "../state/overlay";
import { LANG, setLang, t, trs } from "../i18n";
import { zhScript } from "../i18n/zhScript";
import { live } from "../features/recording/recorder";
import { plStop } from "../features/player/player";
import { unwatchAll } from "../features/notes/watch";
import { forgetUpload, uploading } from "../features/upload/upload";
import { Shell } from "../ui/Shell";
import { css } from "../ui/css";
import { checked, val } from "../ui/form";

export function Settings() {
  const u = S.usage, s = S.settings;
  return <Shell active="settings">
    <div className="crumb"><a href="#/home">{t("Home")}</a>{t(" / Settings")}</div>
    <div className="page-h"><h1>{t("Settings")}</h1></div>
    <form className="card" style={css("padding:22px;max-width:640px;margin-bottom:18px")} onSubmit={e => { e.preventDefault(); saveSettings(e.currentTarget); }}>
      <h2 style={css("font-size:18px;margin-bottom:14px")}>{t("You")}</h2>
      <label className="field"><span>{t("Name")}</span><input name="name" defaultValue={S.user!.name} maxLength={40} required /></label>
      <label className="field"><span>{t("Language usually spoken in class")}</span><select name="lang" defaultValue={s.classLanguage}>{LANGS.map(([v, n]) => <option key={v} value={v}>{t(n)}</option>)}</select></label>
      <label style={css("display:flex;gap:9px;align-items:center;margin-bottom:18px;font-weight:600;cursor:pointer")}><input type="checkbox" name="zh" defaultChecked={s.zhDefault} />{t(" Show 中文解釋 under each point by default")}</label>
      <label className="field"><span>{t("Show 中文解釋 in")}</span><select name="zs" data-notr="" defaultValue={zhScript() === "hans" ? "hans" : "hant"}><option value="hant">繁體中文</option><option value="hans">简体中文</option></select></label>
      <label className="field"><span>{t("Interface language")}</span><select onChange={e => setLang(e.currentTarget.value)} data-notr="" value={LANG}><option value="en">English</option><option value="zh-Hans">简体中文</option><option value="zh-Hant">繁體中文</option></select></label>
      <button className="btn primary">{t("Save settings")}</button></form>
    <div className="card" style={css("padding:22px;max-width:640px;margin-bottom:18px")}>
      <h2 style={css("font-size:18px;margin-bottom:10px")}>{t("Plan and usage")}</h2>
      {u ? <><p className="num" style={css("margin-bottom:8px")}>{t(u.minutesToday + " of " + u.minutesLimit + " recording minutes used today")}</p><div className="ubar"><b style={css(`width:${Math.min(100, u.minutesToday / u.minutesLimit * 100)}%`)}></b></div></> : null}
      {u && u.audioDays ? <p className="small muted" style={css("margin-top:10px")}>{t("Recordings are kept for " + plural(+u.audioDays, "day") + " on your plan.")}</p> : null}
      <Plans /></div>
    <div className="card" style={css("padding:22px;max-width:640px;display:flex;gap:14px;align-items:center;justify-content:space-between;flex-wrap:wrap")}>
      <div><h2 style={css("font-size:18px")}>{t("Sign out")}</h2><p className="small muted">{t("This device will no longer remember you.")}</p></div><button className="btn plain" onClick={signOut}>{t("Sign out")}</button></div>
  </Shell>;
}
function saveSettings(f: HTMLFormElement) { act(async () => { const p = { name: val(f, "name").trim(), classLanguage: val(f, "lang"), zhDefault: checked(f, "zh"), zhScript: val(f, "zs") as ZhScript }; await api.updateSettings(p); S.user!.name = p.name; S.settings = { classLanguage: p.classLanguage, zhDefault: p.zhDefault, zhScript: p.zhScript }; store.set("zhScript", p.zhScript); nf.lang = p.classLanguage; session.save(); toast("Settings saved"); bump(); }); }
export function signOut() { if (live.active) { toast("End or discard the recording before signing out."); return; }
  if (uploading()) { toast("Wait for the upload to finish or cancel it before signing out."); return; }   // the file lives only in this page
  live.id = null; plStop(); unwatchAll(); forgetUpload(); session.clear(); location.hash = "#/"; }

/* Names, prices and features come from the backend and are shown as they are (data-notr); only the two button labels are interface text. */
function Plans() { const p = S.plans;
  if (!p || !p.plans || !p.plans.length) return <div className="drop" style={css("margin-top:16px;text-align:left")}>{t("Plans and prices are not decided yet. This space is reserved for them.")}</div>;
  return <div className="plans">{p.plans.map(x => <div key={x.id} className={`plan ${x.id === p.current ? "cur" : ""}`} data-notr=""><b>{x.name}</b><div className="price">{x.priceText}</div><ul>{(x.features || []).map((f, i) => <li key={i}>{f}</li>)}</ul>{x.id === p.current ? <span className="tag grey">{trs("Your plan")}</span> : <button className="btn primary sm" onClick={() => choosePlan(x.id)}>{trs("Choose this plan")}</button>}</div>)}</div>; }
function choosePlan(id: string) { act(async () => { const r = await api.startCheckout(id); if (r && r.url) location.href = r.url; else toast("Checkout is not connected yet."); }); }
