/* ---------- home ---------- */
import type { Lecture } from "../types";
import { fmt, mins, plural } from "../lib/helpers";
import { refresh } from "../lib/bus";
import { S, colorOf, course, daysLeft, dayMon, meta, setPendingPos, state } from "../state/app";
import { t } from "../i18n";
import { live } from "../features/recording/recorder";
import { addToCalendar } from "../features/export";
import { Sid } from "../ui/icons";
import { Shell, addCourseModal } from "../ui/Shell";
import { css } from "../ui/css";

export const statusTag = (l: Lecture) => l.status === "processing" ? <span className="tag grey">{t("Writing notes")}</span> : l.status === "failed" ? <span className="tag red">{t("Not written")}</span>
  : l.status === "recording" ? (live.active && live.id === l.id ? <span className="tag amber">{t("Recording")}</span> : <span className="tag grey">{t("Not finished")}</span>) : null;

/* The lecture list under the search box. Typing redraws it without dropping focus from the search box (refresh()). */
function LecList() {
  const q = state.q.trim().toLowerCase();
  const hay = (l: Lecture) => { const c = course(l.course), d = S.detail[l.id]; return [l.title, c && c.code, c && c.name, d ? d.sections.map(s => s.title + " " + s.points.map(p => p.text).join(" ")).join(" ") : ""].join(" ").toLowerCase(); };
  const ls = (q ? S.lectures.filter(l => hay(l).includes(q)) : S.lectures).slice(0, q ? 20 : 6);
  if (!ls.length) return <li><span className="muted">{t(q ? "No lecture matches that search." : "No lectures yet.")}</span></li>;
  return <>{ls.map(l => { const c = course(l.course); return <li key={l.id}><i className="cdot" style={{ background: colorOf(c) }}></i><div className="grow"><a className="t" data-notr="" href={"#/lecture/" + encodeURIComponent(l.id)}>{l.title}</a><div className="small muted">{t(meta({ ...l, duration: 0 }, c))}</div></div>{statusTag(l) || <span className="small muted num">{l.duration ? t(mins(l.duration)) : ""}</span>}</li>; })}</>;
}

export const CourseCards = () => <>{S.courses.map(c => <a key={c.id} href={"#/course/" + encodeURIComponent(c.id)}><div className="top" style={{ background: colorOf(c) }}>{c.code}</div><div className="bot"><div className="small" style={css("font-weight:600;color:var(--ink)")} data-notr="">{c.name}</div><div className="small muted" style={css("margin-top:4px")}>{t(plural(S.lectures.filter(l => l.course === c.id).length, "lecture"))}</div></div></a>)}<button className="addcard" onClick={addCourseModal}>{t("Add a course")}</button></>;

export function Home() {
  const up = S.upcoming.filter(u => daysLeft(u.date) >= 0).sort((a, b) => +new Date(a.date) - +new Date(b.date)), w = S.week, n = up[0]; S._up = up;
  if (!S.lectures.length) return <Shell active="home"><div className="center" style={css("min-height:60vh")}><div style={css("text-align:center;max-width:420px")}><Sid size={84} mood="smile" /><h1 style={css("font-size:30px;margin:16px 0 8px")}>{t("Hi " + S.user!.name + ". Nothing here yet.")}</h1><p className="muted" style={css("margin-bottom:22px")}>{t("Record your next class or upload a recording you already have. Notes, flashcards and a quiz arrive a minute or two after it ends.")}</p><a className="btn primary" href="#/new">{t("Add your first lecture")}</a></div></div></Shell>;
  return <Shell active="home">
    <div className="page-h"><div className="hello"><Sid size={52} mood="smile" /><div><h1>{t("Hi " + S.user!.name)}</h1><p className="muted" style={css("margin-top:4px")}>{t(n ? `Next up: ${n.kind.toLowerCase()} for ${n.course}, ${daysLeft(n.date) === 0 ? "today" : "in " + plural(daysLeft(n.date), "day")}.` : "No exam dates on the radar.")}</p></div></div>
      <a className="btn primary desk" href="#/new">{t("New lecture")}</a></div>
    {w ? <div className="stats">
      <div className="stat" style={css("background:var(--blue-soft)")}><b className="num">{w.lectures}</b><span>{t("lectures recorded this week")}</span></div>
      <div className="stat" style={css("background:var(--mint-soft)")}><b className="num">{w.known}</b><span>{t("flashcards you know")}</span></div>
      <div className="stat" style={css("background:var(--violet-soft)")}><b className="num">{w.quiz + "%"}</b><span>{t("average quiz score")}</span></div></div> : null}
    <div className="grid2">
      <div className="card"><div style={css("display:flex;justify-content:space-between;align-items:center;gap:10px;padding:14px 18px 4px;flex-wrap:wrap")}><h2 style={css("font-size:17px")}>{t("Lectures")}</h2>
        <input className="search" type="search" aria-label={t("Search lectures")} placeholder={t("Search course, title or notes")} defaultValue={state.q} onChange={e => { state.q = e.currentTarget.value; refresh(); }} /></div>
        <ul className="list" id="lecList"><LecList /></ul></div>
      <div className="card"><h2 className="sec-h">{t("Exam radar")}</h2><ul className="list">
        {up.length ? up.map((u, i) => <li key={i}><div className="count"><b className="num">{daysLeft(u.date)}</b><span>{t(daysLeft(u.date) === 1 ? "day" : "days")}</span></div><div className="grow"><div><span className="tag amber">{t(u.kind)}</span>{" "}<span className="small muted">{t(u.course + ", " + dayMon(u.date))}</span></div><div className="small" style={css("margin-top:3px")} data-notr="">{u.text}</div><a className="small" href={"#/lecture/" + encodeURIComponent(u.lecture)} onClick={() => setPendingPos(+u.t)}>{t("Said at " + fmt(u.t))}</a><button className="ts" style={css("margin-left:12px")} onClick={() => addToCalendar(i)}>{t("Add to calendar")}</button></div></li>)
          : <li><span className="muted">{t("No dates yet. They appear here when a lecturer mentions an exam or a deadline.")}</span></li>}
      </ul></div>
    </div>
    <h2 style={css("font-size:20px;margin-top:32px")}>{t("Your courses")}</h2>
    <div className="courses"><CourseCards /></div>
  </Shell>;
}

export const Courses = () => <Shell active="courses"><div className="page-h"><h1>{t("Courses")}</h1></div><div className="courses" style={css("margin-top:0")}><CourseCards /></div></Shell>;
