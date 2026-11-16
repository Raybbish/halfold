/* ---------- shell ----------
   The signed-in frame: sidebar on desktop; top bar and bottom navigation on phones (under 900px). Also the loading
   skeleton, the "problem" card, the language button and the notice about an unfinished recording. */
import type { ReactNode } from "react";
import { CONFIG } from "../config";
import { api } from "../api/api";
import { fmt, plural } from "../lib/helpers";
import { bump } from "../lib/bus";
import { R, S, colorOf, course, nf } from "../state/app";
import { act, closeModal, toast } from "../state/overlay";
import { LANG, isZh, setLang, t } from "../i18n";
import { live } from "../features/recording/recorder";
import { recoverOrphan, dropOrphan } from "../features/recording/orphan";
import { ICON, Logo, Hal } from "./icons";
import { openModal } from "./Overlay";
import { css } from "./css";
import { val } from "./form";

/* The button's text is the name of the other language, so it stays as it is (data-notr); its label is translated. */
export const LangBtn = () => <select className="lang" data-notr="" value={LANG} onChange={e => setLang(e.currentTarget.value)} aria-label={t("Switch language")}><option value="en">EN</option><option value="zh-Hans">简体</option><option value="zh-Hant">繁體</option></select>;

export function Shell({ active, children }: { active: string; children: ReactNode }) {
  const dn = isZh() ? ["一", "二", "三", "四", "五"] : ["M", "T", "W", "T", "F"], w = S.week, recOn = live.active && R.a !== "live";
  return <div className="shell">
    <aside className="side">
      <div style={css("display:flex;align-items:center;justify-content:space-between;gap:8px")}><Logo href="#/home" /><LangBtn /></div>
      <a className="btn primary new" href="#/new">{t("New lecture")}</a>
      <a className={`n ${active === "home" ? "on" : ""}`} href="#/home">{t("Home")}</a>
      <a className={`n ${active === "settings" ? "on" : ""}`} href="#/settings">{t("Settings")}</a>
      <div className="lbl">{t("Courses")}</div>
      {S.courses.map(c => <a key={c.id} className={`n c ${active === c.id ? "on" : ""}`} href={"#/course/" + encodeURIComponent(c.id)}><i className="cdot" style={{ background: colorOf(c) }}></i>{c.code}<span className="ct num">{S.lectures.filter(l => l.course === c.id).length}</span></a>)}
      <button className="n c addc" onClick={addCourseModal}>{t("Add a course")}</button>
      {w ? <div className="streak"><b className="num">{t(plural(w.lectures, "lecture") + " this week")}</b><div className="small">{t("One more and Hal gets a gold corner.")}</div>
        <div className="days" data-notr="">{dn.map((x, i) => <span key={i} className={w.days && w.days[i] ? "d" : ""}>{x}</span>)}</div></div> : null}
    </aside>
    <header className="mtop"><Logo href="#/home" />{CONFIG.USE_MOCK ? <span className="mtag">{t("Sample data")}</span> : null}<span className="sp"></span><LangBtn /><a className={`ico ${active === "settings" ? "on" : ""}`} href="#/settings" aria-label={t("Settings")}>{ICON.settings}</a></header>
    <main className="main"><div className="inner">
      {live.active && R.a !== "live" ? <a className="pill-rec" href="#/live"><i></i>{t("Recording " + live.courseCode + " ")}<span className="clk num">{fmt(live.sec)}</span>{t(" Return")}</a> : null}
      <OrphanNotice />
      {children}</div></main>
    {R.a === "live" ? null : <nav className="mnav" aria-label={t("Main")}>
      <a className={`t ${active === "home" ? "on" : ""}`} href="#/home">{ICON.home}{t("Home")}</a>
      {recOn ? <a className="go btn dark" href="#/live" aria-label={t("Return to the recording")}><i className="dot"></i><span className="clk num">{fmt(live.sec)}</span></a> : <a className="go btn primary" href="#/new">{ICON.plus}{t("New lecture")}</a>}
      <a className={`t ${active === "courses" || course(active) ? "on" : ""}`} href="#/courses">{ICON.courses}{t("Courses")}</a></nav>}
  </div>;
}

export const Skeleton = () => <><div className="sk" style={css("width:40%;height:30px")}></div><div className="sk" style={css("width:65%")}></div><div className="card" style={css("padding:22px;margin-top:20px")}><div className="sk"></div><div className="sk" style={css("width:80%")}></div><div className="sk" style={css("width:55%;margin:0")}></div></div></>;

export function Problem({ title, text, btn }: { title: string; text: string; btn?: ReactNode }) {
  return <div className="card" style={css("padding:28px;display:flex;gap:18px;align-items:center;flex-wrap:wrap")}><Hal size={52} mood="sad" /><div className="grow"><h3>{t(title)}</h3><p className="muted" style={css("margin:8px 0 16px")}>{t(text)}</p>{btn || <a className="btn primary" href="#/home">{t("Go to home")}</a>}</div></div>;
}

/* A recording cut off by a closed tab (see features/recording/orphan.ts). */
function OrphanNotice() {
  const o = S.orphan; if (!o || live.active) return null;
  return <div className="alert" style={css("align-items:center;flex-wrap:wrap")}><span className="tag amber">{t("Unfinished")}</span><span>{t("A recording" + (o.code ? " of " + o.code : "") + " was interrupted at " + fmt(o.sec) + ", before its notes were made.")}</span><span style={css("margin-left:auto;display:flex;gap:14px")}><button className="ts" onClick={recoverOrphan}>{t("Make notes from it")}</button><button className="ts" style={css("color:var(--red)")} onClick={dropOrphan}>{t("Discard it")}</button></span></div>;
}

export function addCourseModal() {
  openModal(() => <><h3>{t("Add a course")}</h3><form onSubmit={e => { e.preventDefault(); doAddCourse(e.currentTarget); }}>
    <label className="field"><span>{t("Course code")}</span><input name="code" placeholder={t("FINA 2303")} required maxLength={20} /></label>
    <label className="field"><span>{t("Course name")}</span><input name="name" placeholder={t("Financial Management")} maxLength={80} /></label>
    <div style={css("display:flex;gap:10px;justify-content:flex-end")}><button type="button" className="btn plain" onClick={closeModal}>{t("Cancel")}</button><button className="btn primary">{t("Add course")}</button></div></form></>);
}
function doAddCourse(f: HTMLFormElement) { act(async () => { const c = await api.addCourse(val(f, "code").trim(), val(f, "name").trim()); if (!S.courses.find(x => x.id === c.id)) S.courses.push(c); nf.courseId = c.id; closeModal(); toast("Course added"); bump(); }); }
