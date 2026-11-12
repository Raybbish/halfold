/* ---------- lecture ----------
   The lecture page and the body it shares with the shared page (pages/Shared.tsx): notes that are not written yet,
   the retention notice, timeline, tabs and player. */
import { useLayoutEffect, type ReactNode } from "react";
import { CONFIG } from "../config";
import { plural } from "../lib/helpers";
import { S, course, cur, daysLeft, dayMon, lecture, meta, setCur, state, type Tab } from "../state/app";
import { t } from "../i18n";
import { live } from "../features/recording/recorder";
import { recoverOrphan } from "../features/recording/orphan";
import { retryNotes } from "../features/recording/finish";
import { hasAudio, pl, plLoad, plStop } from "../features/player/player";
import { Player } from "../features/player/PlayerBar";
import { Sid, type Mood } from "../ui/icons";
import { Shell, Problem } from "../ui/Shell";
import { css } from "../ui/css";
import { Timeline } from "./lecture/parts";
import { Notes } from "./lecture/Notes";
import { Slides } from "./lecture/Slides";
import { Transcript } from "./lecture/Transcript";
import { Cards } from "./lecture/Cards";
import { Quiz } from "./lecture/Quiz";
import { moreMenu, refreshLecture, setTab, share } from "./lecture/actions";

const Box = ({ mood, h, p, btn }: { mood: Mood; h: ReactNode; p: string; btn: ReactNode }) =>
  <div className="card" style={css("padding:28px;display:flex;gap:18px;align-items:center;flex-wrap:wrap")}><Sid size={52} mood={mood} /><div className="grow"><h3>{h}</h3><p className="muted" style={css("margin:8px 0 16px")}>{t(p)}</p>{btn}</div></div>;

export function LectureBody() {
  /* The audio object lives in player.ts. After each draw it is loaded for this lecture, or stopped when there is none. */
  useLayoutEffect(() => { if (!cur || !cur.d) return; if (hasAudio()) plLoad(); else plStop(); });
  const { l, c, d, shared } = cur!;
  if (!d) {
    if (l.status === "failed") return <Box mood="sad" h={t("These notes could not be written")} p="Your recording is safe. Sid can try again from it." btn={<button className="btn primary" onClick={() => retryNotes(false)}>{t("Try again")}</button>} />;
    if (l.status === "recording") return live.active && live.id === l.id
      ? <Box mood="wow" h={t("This lecture is being recorded")} p="The notes are written when you end the recording." btn={<a className="btn primary" href="#/live">{t("Return to the recording")}</a>} />
      : <Box mood="plain" h={t("This recording was not finished")} p="The page was closed before the recording ended. Sid can still write notes from the part that was saved." btn={<button className="btn primary" onClick={() => S.orphan && S.orphan.id === l.id ? recoverOrphan() : retryNotes(true)}>{t("Make notes from what was saved")}</button>} />;
    if (CONFIG.USE_MOCK && l.status !== "processing") return <Box mood="plain" h={<span data-notr="">{l.title}</span>} p="The sample data has full notes for one lecture, ECON 1001 week 9. Every lecture uses this same page." btn={<a className="btn primary" href="#/lecture/econ-w9">{t("Open ECON 1001 week 9")}</a>} />;
    return <Box mood="wow" h={t("Sid is still writing these notes")} p="This usually takes a minute or two after the lecture ends." btn={<button className="btn primary" onClick={refreshLecture}>{t("Check again")}</button>} />;
  }
  const audio = hasAudio();
  /* How long a recording is kept depends on the student's plan. The backend may send audio.keptUntil (a date) or
     audio.expired. Both notices link to the plans in Settings once the backend reports a plan-based limit (usage.audioDays). */
  const au = !shared && d.audio, left = au && au.keptUntil && !au.expired ? daysLeft(au.keptUntil) : null;
  const plans = S.usage && S.usage.audioDays ? <a className="ts" href="#/settings">{t("See plans")}</a> : null;
  const keep = au && au.expired ? <div className="alert noprint"><span className="tag grey">{t("Recording")}</span><span>{t("The recording of this lecture is no longer kept. The notes, transcript, flashcards and quiz are still here.")}</span>{plans}</div>
    : au && left != null && left >= 0 && left <= 7 ? <div className="alert noprint"><span className="tag amber">{t("Recording")}</span><span>{t("The recording of this lecture is kept until " + dayMon(au.keptUntil!) + (left ? ", " + plural(left, "more day") : ", which is today") + ". The notes stay after that.")}</span>{plans}</div> : null;
  const hasSlides = d.slides && d.slides.length;
  const tabs: [Tab, string][] = [["notes", "Notes"], ...(hasSlides ? [["slides", "Slides"] as [Tab, string]] : []), ["transcript", "Transcript"], ["cards", `Flashcards (${d.flashcards.length})`], ["quiz", `Quiz (${d.quiz.length})`]];
  const Body = state.tab === "notes" ? Notes : state.tab === "slides" ? Slides : state.tab === "transcript" ? Transcript : state.tab === "cards" ? Cards : Quiz;
  return <>
    <div className="page-h" style={css("margin-bottom:10px")}><div><h1 data-notr="">{l.title}</h1><p className="muted num" style={css("margin-top:6px")}>{t(meta(l, c))}</p></div>
      {shared ? null : <div style={css("display:flex;gap:10px;flex-wrap:wrap")}><button className="btn plain" onClick={moreMenu}>{t("More")}</button><button className="btn primary" onClick={share}>{t("Share with class")}</button></div>}</div>
    {keep}<Timeline d={d} dur={l.duration} pos={state.pos} />
    <div id="tabtop"></div>
    <div className="tabs" role="tablist">{tabs.map(([k, n]) => <button key={k} role="tab" aria-selected={state.tab === k} className={state.tab === k ? "on" : ""} onClick={() => setTab(k)}>{t(n)}</button>)}</div>
    <Body d={d} />{audio && ((state.tab !== "cards" && state.tab !== "quiz") || (pl.a && !pl.a.paused)) ? <Player /> : null}
  </>;
}

export function LecturePage({ id }: { id: string }) {
  const l = lecture(id); if (!l) return <Shell active="home"><Problem title="This lecture does not exist" text="It may have been deleted." /></Shell>;
  const c = course(l.course);
  setCur({ l, c, d: S.detail[id], shared: false });
  return <Shell active={c ? c.id : ""}><div className="crumb"><a href="#/home">{t("Home")}</a>{c ? <>{t(" / ")}<a href={"#/course/" + encodeURIComponent(c.id)}>{c.code}</a></> : null}{l.week ? t(" / Week " + l.week) : null}</div><LectureBody /></Shell>;
}
