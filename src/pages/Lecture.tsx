/* ---------- lecture ----------
   The lecture page and the body it shares with the shared page (pages/Shared.tsx): notes that are not written yet,
   the retention notice, timeline, tabs and player. */
import { useLayoutEffect, type ReactNode } from "react";
import { CONFIG } from "../config";
import { plural } from "../lib/helpers";
import { store } from "../lib/store";
import { S, course, cur, daysLeft, dayMon, lecture, meta, setCur, state, type Tab } from "../state/app";
import { t } from "../i18n";
import { live } from "../features/recording/recorder";
import { recoverOrphan } from "../features/recording/orphan";
import { retryNotes } from "../features/recording/finish";
import { isWatching } from "../features/notes/watch";
import { cancelUpload, ownReason, reupload, runUpload, up, upPct } from "../features/upload/upload";
import { hasAudio, pl, plLoad, plStop } from "../features/player/player";
import { Player } from "../features/player/PlayerBar";
import { Hal, type Mood } from "../ui/icons";
import { Shell, Problem } from "../ui/Shell";
import { css } from "../ui/css";
import { Timeline } from "./lecture/parts";
import { Notes } from "./lecture/Notes";
import { Slides } from "./lecture/Slides";
import { Transcript } from "./lecture/Transcript";
import { Cards } from "./lecture/Cards";
import { Quiz } from "./lecture/Quiz";
import { deleteModal, detailsModal, moreMenu, refreshLecture, setTab, share } from "./lecture/actions";

/* p: interface text (translated here), or backend text already wrapped so that it is shown as it is. */
const Box = ({ mood, h, p, btn }: { mood: Mood; h: ReactNode; p: string | ReactNode; btn: ReactNode }) =>
  <div className="card" style={css("padding:28px;display:flex;gap:18px;align-items:center;flex-wrap:wrap")}><Hal size={52} mood={mood} /><div className="grow"><h3>{h}</h3><p className="muted" style={css("margin:8px 0 16px")}>{typeof p === "string" ? t(p) : p}</p>{btn}</div></div>;

/* Notes being written. The lecture is checked in the background (features/notes/watch.ts) and this page updates by
   itself; "Check again" appears only when nothing is checking any more (it gave up after a long wait). */
const Writing = ({ id }: { id: string }) =>
  <div className="card wait"><Hal size={52} mood="wow" /><div className="grow"><h3>{t("Hal is writing your notes")}</h3><p className="muted">{t("First the transcript, then notes, flashcards and a quiz. This usually takes about two minutes.")}</p>
    <div className="bar ind" role="progressbar" aria-label={t("Writing notes")}><b></b></div>
    <p className="small muted">{t("You do not have to wait here. This page updates by itself, and the lecture is on your home page when it is ready.")}</p>
    <div className="brow"><a className="btn plain sm" href="#/home">{t("Go to home")}</a>{isWatching(id) ? null : <button className="btn plain sm" onClick={refreshLecture}>{t("Check again")}</button>}</div></div></div>;

/* The recording of this lecture is being uploaded in the background (features/upload/upload.ts). The bar and the
   percentage move without a redraw (paint() there finds #upBar and .upPct). */
function Uploading() { const pct = upPct();
  return <div className="card wait"><Hal size={52} mood="wow" /><div className="grow"><h3>{t("Uploading the recording")}</h3><p className="muted" data-notr="">{up.name}</p>
    <div className="bar" role="progressbar" aria-label={t("Upload progress")} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}><b id="upBar" style={{ width: pct + "%" }}></b></div>
    <p className="small muted"><b className="num upPct" data-notr="">{pct + "%"}</b>{" "}<span>{t("Keep this tab open until the upload finishes. You can use the rest of Halfold while you wait.")}</span></p>
    <div className="brow"><button className="btn plain sm" onClick={cancelUpload}>{t("Cancel upload")}</button></div></div></div>;
}
/* The upload failed. The file is still in memory: Send it again sends it to this same lecture. The reason is the server's
   message, shown as it is, or one of ours. */
const UploadFailed = () =>
  <div className="card wait"><Hal size={52} mood="sad" /><div className="grow"><h3>{t("The upload did not finish")}</h3><p className="muted">{ownReason(up.err) ? t(up.err) : <span data-notr="">{up.err}</span>}</p>
    <p className="small muted">{t("The file is still selected, so you can send it again without choosing it.")}</p>
    <div className="brow"><button className="btn primary" onClick={() => runUpload()}>{t("Send it again")}</button><button className="btn plain" onClick={cancelUpload}>{t("Delete this lecture")}</button></div></div></div>;

/* A lecture that was started but never got its notes, and is not being recorded or uploaded right now. What can be done
   depends on how it was made: the server refuses a file for a live recording, and refuses to make notes for an upload
   whose file never arrived. No source (an old lecture) is treated like a recording. */
function Unfinished() { const { l } = cur!, src = l.source;
  const mine = !!S.orphan && S.orphan.id === l.id;
  const rec = !src || src === "record" || src === "tab";
  const finish = <button className="btn primary" onClick={() => mine ? recoverOrphan() : retryNotes(true)}>{t("Make notes from what was recorded")}</button>;
  const send = <button className={"btn " + (src === "upload" ? "primary" : "plain")} onClick={() => document.getElementById("fRe")!.click()}>{t("Send a recording file")}</button>;
  return <div className="card wait"><Hal size={52} mood="sad" /><div className="grow"><h3>{t("This lecture was never finished")}</h3><p className="muted">{t("It was started, but its notes were not made. Finish it from what was recorded, send the recording again, or delete it.")}</p>
    <input type="file" id="fRe" accept="audio/*,video/*" hidden onChange={e => { const f = e.target.files && e.target.files[0]; e.target.value = ""; if (f) reupload(f); }} />
    <div className="brow">{rec ? finish : src === "link" ? (l.link ? <button className="btn primary" onClick={() => retryNotes(true)}>{t("Make notes from the link")}</button> : null) : send}<button className="btn plain" onClick={deleteModal}>{t("Delete lecture")}</button></div></div></div>; }

export function LectureBody() {
  /* The audio object lives in player.ts. After each draw it is loaded for this lecture, or stopped when there is none. */
  useLayoutEffect(() => { if (!cur || !cur.d) return; if (hasAudio()) plLoad(); else plStop(); });
  const { l, c, d, shared } = cur!;
  if (!d) {
    if (!shared && up.id === l.id) return up.state === "failed" ? <UploadFailed /> : <Uploading />;
    /* lecture.error: why it failed, from the backend (a video link that needs a sign-in, ...), shown as it is. */
    if (l.status === "failed") return <Box mood="sad" h={t("These notes could not be written")} p={l.error ? <span data-notr="">{l.error}</span> : "Your recording is safe. Hal can try again from it."} btn={<div className="brow"><button className="btn primary" onClick={() => retryNotes(false)}>{t("Try again")}</button><button className="btn plain" onClick={deleteModal}>{t("Delete lecture")}</button></div>} />;
    if (l.status === "recording") return live.active && live.id === l.id
      ? <Box mood="wow" h={t("This lecture is being recorded")} p="The notes are written when you end the recording." btn={<a className="btn primary" href="#/live">{t("Return to the recording")}</a>} />
      : <Unfinished />;
    if (CONFIG.USE_MOCK && l.status !== "processing") return <Box mood="plain" h={<span data-notr="">{l.title}</span>} p="The sample data has full notes for one lecture, ECON 1001 week 9. Every lecture uses this same page." btn={<a className="btn primary" href="#/lecture/econ-w9">{t("Open ECON 1001 week 9")}</a>} />;
    return <Writing id={l.id} />;
  }
  const audio = hasAudio();
  /* How long a recording is kept depends on the student's plan. The backend may send audio.keptUntil (a date) or
     audio.expired. Both notices link to the plans in Settings once the backend reports a plan-based limit (usage.audioDays). */
  const au = !shared && d.audio, left = au && au.keptUntil && !au.expired ? daysLeft(au.keptUntil) : null;
  const plans = S.usage && S.usage.audioDays ? <a className="ts" href="#/settings">{t("See plans")}</a> : null;
  const keep = au && au.expired ? <div className="alert noprint"><span className="tag grey">{t("Recording")}</span><span>{t("The recording of this lecture is no longer kept. The notes, transcript, flashcards and quiz are still here.")}</span>{plans}</div>
    : au && left != null && left >= 0 && left <= 7 ? <div className="alert noprint"><span className="tag amber">{t("Recording")}</span><span>{t("The recording of this lecture is kept until " + dayMon(au.keptUntil!) + (left ? ", " + plural(left, "more day") : ", which is today") + ". The notes stay after that.")}</span>{plans}</div> : null;
  const hasSlides = d.slides && d.slides.length;
  /* A tab appears only when it has something in it; if the one on screen is gone, the notes come back. */
  const tabs: [Tab, string][] = [["notes", "Notes"], ...(hasSlides ? [["slides", "Slides"] as [Tab, string]] : []), ...(d.transcript.length ? [["transcript", "Transcript"] as [Tab, string]] : []), ["cards", `Flashcards (${d.flashcards.length})`], ...(d.quiz.length ? [["quiz", `Quiz (${d.quiz.length})`] as [Tab, string]] : [])];
  if (!tabs.some(x => x[0] === state.tab)) state.tab = "notes";
  const Body = state.tab === "notes" ? Notes : state.tab === "slides" ? Slides : state.tab === "transcript" ? Transcript : state.tab === "cards" ? Cards : Quiz;
  return <>
    <div className="page-h" style={css("margin-bottom:10px")}><div><h1 data-notr="">{l.title}</h1><p className="muted num" style={css("margin-top:6px")}>{t(meta(l, c))}{shared ? null : <> <button className="ts" style={css("margin-left:8px")} onClick={detailsModal}>{t("Rename")}</button></>}</p></div>
      {shared ? null : <div style={css("display:flex;gap:10px;flex-wrap:wrap")}><button className="btn plain" onClick={moreMenu}>{t("More")}</button><button className="btn primary" onClick={share}>{t("Share with class")}</button></div>}</div>
    {keep}<Timeline d={d} dur={l.duration} pos={state.pos} />
    <div id="tabtop"></div>
    <div className="tabs" role="tablist">{tabs.map(([k, n]) => <button key={k} role="tab" aria-selected={state.tab === k} className={state.tab === k ? "on" : ""} onClick={() => setTab(k)}>{t(n)}</button>)}</div>
    <Body d={d} />{audio && ((state.tab !== "cards" && state.tab !== "quiz") || (pl.a && !pl.a.paused)) ? <Player /> : null}
  </>;
}

export function LecturePage({ id }: { id: string }) {
  const l = lecture(id); if (!l) return <Shell active="home"><Problem title="This lecture does not exist" text="It may have been deleted." /></Shell>;
  const c = course(l.course); store.set("lastLec", id);
  setCur({ l, c, d: S.detail[id], shared: false });
  return <Shell active={c ? c.id : ""}><div className="crumb"><a href="#/home">{t("Home")}</a>{c ? <>{t(" / ")}<a href={"#/course/" + encodeURIComponent(c.id)}>{c.code}</a></> : null}{l.week ? t(" / Week " + l.week) : null}</div><LectureBody /></Shell>;
}
