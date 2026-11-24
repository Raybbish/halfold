/* ---------- home ---------- */
import { useEffect, type ReactNode } from "react";
import type { Lecture, NoteHit } from "../types";
import { fmt, mins, plural } from "../lib/helpers";
import { refresh } from "../lib/bus";
import { S, colorOf, course, daysLeft, dayMon, lecture, meta, setPendingPoint, setPendingPos, state } from "../state/app";
import { t } from "../i18n";
import { store } from "../lib/store";
import { quickRecord } from "./NewLecture";
import { live } from "../features/recording/recorder";
import { up, uploading } from "../features/upload/upload";
import { addToCalendar } from "../features/export";
import { MIN_QUERY, found, norm, searchNotes } from "../features/search";
import { Hal } from "../ui/icons";
import { Shell, addCourseModal } from "../ui/Shell";
import { css } from "../ui/css";
import { ProfileNudge } from "./Profile";

/* A lecture whose recording is being uploaded right now is "Uploading", not "Not finished". */
export const statusTag = (l: Lecture) => uploading() && up.id === l.id ? <span className="tag amber">{t("Uploading")}</span> : l.status === "processing" ? <span className="tag grey">{t("Writing notes")}</span> : l.status === "failed" ? <span className="tag red">{t("Not written")}</span>
  : l.status === "recording" ? (live.active && live.id === l.id ? <span className="tag amber">{t("Recording")}</span> : <span className="tag grey">{t("Not finished")}</span>) : null;

/* The note matches from the server for the text in the box (features/search.ts). While a new search is on its way
   the last matches stay, so the list does not flicker with each letter typed. */
const noteHits = (): NoteHit[] => { const q = norm(state.q); return !found.off && q.length >= MIN_QUERY && !found.failed && (found.q === q || found.busy) ? found.hits.filter(h => lecture(h.lecture)) : []; };

/* The lecture list under the search box. Typing redraws it without dropping focus from the search box (refresh()).
   A lecture whose notes matched on the server is listed too, under the lectures matched here. */
function LecList() {
  const q = state.q.trim().toLowerCase(), inNotes = new Set(noteHits().map(h => h.lecture));
  const hay = (l: Lecture) => { const c = course(l.course), d = S.detail[l.id]; return [l.title, c && c.code, c && c.name, d ? d.sections.map(s => s.title + " " + s.points.map(p => p.text).join(" ")).join(" ") : ""].join(" ").toLowerCase(); };
  const ls = (q ? S.lectures.filter(l => hay(l).includes(q) || inNotes.has(l.id)) : S.lectures).slice(0, q ? 20 : 6);
  if (!ls.length) return <li><span className="muted">{t(!q ? "No lectures yet." : found.busy ? "Searching the notes" : "No lecture matches that search.")}</span></li>;
  return <>{ls.map(l => { const c = course(l.course); return <li key={l.id}><i className="cdot" style={{ background: colorOf(c) }}></i><div className="grow"><a className="t" data-notr="" href={"#/lecture/" + encodeURIComponent(l.id)}>{l.title}</a><div className="small muted">{t(meta({ ...l, duration: 0 }, c))}</div></div>{statusTag(l) || <span className="small muted num">{l.duration ? t(mins(l.duration)) : ""}</span>}</li>; })}</>;
}

/* The query's words marked in a point's text. */
function Marked({ text, q }: { text: string; q: string }) {
  const words = q.split(" ").filter(Boolean).map(w => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (!words.length) return <>{text}</>;
  const re = new RegExp("(" + words.join("|") + ")", "gi"), out: ReactNode[] = [];
  text.split(re).forEach((part, i) => { if (part) out.push(i % 2 ? <mark key={i}>{part}</mark> : part); });
  return <>{out}</>;
}

/* "Found in the notes": the points that matched on the server. Each one opens its lecture at that point. */
function NoteHits() {
  const q = norm(state.q), hits = noteHits();
  if (found.off || q.length < MIN_QUERY) return null;
  if (found.failed && found.q === q && !found.busy) return <p className="small muted hits-note">{t("The notes could not be searched just now. Try again in a moment.")}</p>;
  if (!hits.length) return null;
  return <div className="hits"><h3>{t("Found in the notes")}</h3><ul className="list">{hits.map((h, i) => { const l = lecture(h.lecture)!, c = course(l.course);
    return <li key={i}><i className="cdot" style={{ background: colorOf(c) }}></i><div className="grow"><a className="snip" data-notr="" href={"#/lecture/" + encodeURIComponent(h.lecture)} onClick={() => { setPendingPoint(h); setPendingPos(h.t != null ? +h.t : 0); }}><Marked text={h.text} q={found.q} /></a>
      <div className="small muted" data-notr="">{(c ? c.code + ", " : "") + l.title}</div></div>{h.t != null ? <span className="small muted num">{fmt(h.t)}</span> : null}</li>; })}</ul></div>;
}

export const CourseCards = () => <>{S.courses.map(c => <a key={c.id} href={"#/course/" + encodeURIComponent(c.id)}><div className="top" style={{ background: colorOf(c) }}>{c.code}</div><div className="bot"><div className="small" style={css("font-weight:600;color:var(--ink)")} data-notr="">{c.name}</div><div className="small muted" style={css("margin-top:4px")}>{t(plural(S.lectures.filter(l => l.course === c.id).length, "lecture"))}</div></div></a>)}<button className="addcard" onClick={addCourseModal}>{t("Add a course")}</button></>;

/* "Class starting?": one tap to record with the course last used. While a recording runs it says so and goes back to it. */
function RecordCard() {
  const lc = store.get("lastCourse"), cid = lc && course(lc) ? lc : S.courses[0] && S.courses[0].id;
  if (live.active) return <div className="rec-hero on"><div className="grow"><h2>{t("Recording")} <span data-notr="">{live.courseCode}</span></h2><p className="clk num" style={css("font-size:24px;font-weight:800;color:var(--ink)")}>{fmt(live.sec)}</p></div><a className="btn dark" href="#/live">{t("Return to the recording")}</a></div>;
  return <div className="rec-hero"><div className="grow"><h2>{t("Class starting?")}</h2><p>{t("One tap to record. Add the title later.")}</p>
    {S.courses.length ? <label className="rec-course small">{t("Course")}<select data-notr="" aria-label={t("Course")} defaultValue={cid || undefined} onChange={e => store.set("lastCourse", e.currentTarget.value)}>{S.courses.map(c => <option key={c.id} value={c.id}>{c.code}</option>)}</select></label> : null}
    <a className="small" href="#/new">{t("Upload a file, paste a link or record an online class")}</a></div>
    <button className="rec-btn" onClick={() => { quickRecord(); }} aria-label={t("Record this class")}><i></i><span>{t("Record")}</span></button></div>;
}

/* The lecture opened last, to carry on from. */
function LastCard() {
  const id = store.get("lastLec"), l = id ? lecture(id) : undefined; if (!l) return null;
  return <div className="today"><a className="card tcard" href={"#/lecture/" + encodeURIComponent(l.id)}><span className="small muted">{t("Pick up where you left off")}</span><b data-notr="">{l.title}</b><span className="small muted">{t(meta(l, course(l.course)))}</span></a></div>;
}

export function Home() {
  /* Text left in the box from earlier in this visit: search the notes again, they may have changed since. */
  useEffect(() => { if (S.lectures.length && norm(state.q).length >= MIN_QUERY) { searchNotes(state.q, true); refresh(); } }, []);
  const up = S.upcoming.filter(u => daysLeft(u.date) >= 0).sort((a, b) => +new Date(a.date) - +new Date(b.date)), w = S.week, n = up[0]; S._up = up;
  if (!S.lectures.length) return <Shell active="home"><div className="center" style={css("min-height:60vh;flex-direction:column;gap:28px")}><div style={css("text-align:center;max-width:420px")}><Hal size={84} mood="smile" /><h1 style={css("font-size:30px;margin:16px 0 8px")}>{t("Hi " + S.user!.name + ". Nothing here yet.")}</h1><p className="muted" style={css("margin-bottom:22px")}>{t("Record your next class or upload a recording you already have. Notes, flashcards and a quiz arrive a minute or two after it ends.")}</p><a className="btn primary" href="#/new">{t("Add your first lecture")}</a></div><div style={css("width:100%;max-width:560px")}><RecordCard /><div style={css("margin-top:16px")}><ProfileNudge /></div></div></div></Shell>;
  return <Shell active="home">
    <div className="page-h"><div className="hello"><Hal size={52} mood="smile" /><div><h1>{t("Hi " + S.user!.name)}</h1><p className="muted" style={css("margin-top:4px")}>{t(n ? `Next up: ${n.kind.toLowerCase()} for ${n.course}, ${daysLeft(n.date) === 0 ? "today" : "in " + plural(daysLeft(n.date), "day")}.` : "No exam dates on the radar.")}</p></div></div>
      <a className="btn primary desk" href="#/new">{t("New lecture")}</a></div>
    <ProfileNudge />
    <div className="top2"><RecordCard /><LastCard /></div>
    {w ? <div className="stats">
      <div className="stat" style={css("background:var(--blue-soft)")}><b className="num">{w.lectures}</b><span>{t("lectures recorded this week")}</span></div>
      <div className="stat" style={css("background:var(--mint-soft)")}><b className="num">{w.known}</b><span>{t("flashcards you know")}</span></div>
      <div className="stat" style={css("background:var(--violet-soft)")}><b className="num">{w.quiz + "%"}</b><span>{t("average quiz score")}</span></div></div> : null}
    <div className="grid2">
      <div className="card"><div style={css("display:flex;justify-content:space-between;align-items:center;gap:10px;padding:14px 18px 4px;flex-wrap:wrap")}><h2 style={css("font-size:17px")}>{t("Lectures")}</h2>
        <input className="search" type="search" aria-label={t("Search lectures")} placeholder={t("Search course, title or notes")} defaultValue={state.q} onChange={e => { state.q = e.currentTarget.value; searchNotes(state.q); refresh(); }} /></div>
        <ul className="list" id="lecList"><LecList /></ul><NoteHits /></div>
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
