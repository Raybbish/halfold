/* Notes tab: the lecture in short (detail.summary, when the notes have one), the topics, exam alerts, then the points
   grouped by topic. */
import { useLayoutEffect } from "react";
import type { Detail } from "../../types";
import { PALETTE, fmt, plural } from "../../lib/helpers";
import { cur, state } from "../../state/app";
import { lineAt, marksOf } from "../../features/marks";
import { t } from "../../i18n";
import { css } from "../../ui/css";
import { fx } from "../../ui/Fx";
import { isFiling } from "../../features/notes/watch";
import { Point, Tools } from "./parts";
import { bump } from "../../lib/bus";
import { addPoint, feedbackModal, jump, pickSlides } from "./actions";

const toggleSec = (i: number) => { if (state.closed.has(i)) state.closed.delete(i); else state.closed.add(i); bump(); };
const collapseAll = (d: Detail) => { state.closed = state.closed.size ? new Set() : new Set(d.sections.map((_, i) => i)); bump(); };
/* "Your marks from class": what the student marked while recording, with the words said at that moment. A time plays
   the recording from 15 seconds before the mark. Not on the shared page: marks are the owner's own. */
function Marks({ d }: { d: Detail }) {
  if (cur!.shared) return null;
  const ms = marksOf(d, cur!.l.id); if (!ms.length) return null;
  return <div className="card marks"><h3>{t("Your marks from class")}</h3>{ms.map((m, i) => { const s = lineAt(d.transcript, m.t);
    return <div key={i} className="pt"><button className="ts" onClick={() => jump(Math.max(0, m.t - 15))} aria-label={t("Play from just before this mark")}>{fmt(m.t)}</button><div className="body"><span className={"tag " + (m.kind === "lost" ? "grey" : "amber")}>{t(m.kind === "lost" ? "Lost me" : "Important")}</span>{s ? <>{" "}<span data-notr="">{s.text}</span></> : null}</div></div>; })}
    <p className="small muted noprint" style={css("margin-top:8px")}>{t("Tap a time to hear it again from 15 seconds before your mark.")}</p></div>;
}
const openSec = (i: number) => { state.closed.delete(i); bump(); const el = document.getElementById("sec-" + i); if (el) el.scrollIntoView({ block: "start", behavior: "smooth" }); };

export function Notes({ d }: { d: Detail }) {
  /* Opened from a search result: bring the point it found into view, once. */
  useLayoutEffect(() => { if (!state.goFound) return; state.goFound = false; const el = document.querySelector(".pt.found"); if (el) el.scrollIntoView({ block: "center" }); });
  const shared = cur!.shared;
  const many = d.sections.length > 1;
  const sections = d.sections.map((s, i) => { const pts = s.points.map((p, pi) => ({ p, pi })).filter(x => !state.onlyOff || x.p.off); if (!pts.length && !state.edit) return null;
    const shut = state.closed.has(i) && !state.edit;
    return <section key={i} id={"sec-" + i} className={"card nsec" + (shut ? " closed" : "")} style={css(`border-left:6px solid ${PALETTE[(i + 3) % 5]}`)}><h3><button className="sec-t" aria-expanded={!shut} onClick={() => toggleSec(i)}><span data-notr="">{s.title}</span></button>{s.slides ? <span className="tag grey" data-notr="">{s.slides}</span> : null}{shut ? <span className="small muted num cnt">{t(plural(pts.length, "note"))}</span> : null}</h3>{shut ? null : pts.map(x => <Point key={x.pi} p={x.p} si={i} pi={x.pi} />)}{!shared && state.edit && !shut ? <div className="pt-acts" style={css("margin-top:12px")}><button className="btn plain sm" onClick={() => addPoint(i)}>{t("Add a note")}</button></div> : null}</section>; }).filter(Boolean);
  const toc = many ? <div className="card sum"><h3>{t("Topics")}</h3><div className="chips">{d.sections.map((s, i) => <button key={i} className="chip" data-notr="" onClick={() => openSec(i)}><i style={css(`background:${PALETTE[(i + 3) % 5]}`)}></i>{s.title} <span className="num">{fmt(s.start || 0)}</span></button>)}</div></div> : null;
  /* Printed too, unlike the topic chips: it is part of the notes. */
  const brief = d.summary && d.summary.length ? <div className="card sum brief"><h3>{t("In short")}</h3><ul data-notr="">{d.summary.map((x, i) => <li key={i}>{fx(x)}</li>)}</ul></div> : null;
  return <>{brief}{toc}<Marks d={d} /><Tools d={d} />{many ? <div className="tools" style={css("margin-top:-6px")}><button className="ts" data-act="collapse" onClick={() => collapseAll(d)}>{t(state.closed.size ? "Expand all topics" : "Collapse all topics")}</button></div> : null}{d.alerts.map((a, i) => <div key={i} className="alert"><span className="tag amber">{t(a.kind)}</span><span data-notr="">{a.text}</span><button className="ts" onClick={() => jump(+a.t)}>{fmt(a.t)}</button></div>)}<div style={css("height:10px")}></div>
    {sections.length ? sections : <p className="muted">{t("No notes in this lecture.")}</p>}{shared || d.slides.length || isFiling(cur!.l.id) ? null : <p className="small muted noprint" style={css("margin-top:18px")}>{t("No slides for this lecture yet. ")}<button className="ts" style={css("font-size:inherit")} onClick={pickSlides}>{t("Add slides")}</button></p>}{shared ? null : <p className="small muted noprint" style={css("margin-top:18px")}>{t("Something wrong in these notes? ")}<button className="ts" style={css("font-size:inherit")} onClick={feedbackModal}>{t("Tell us")}</button></p>}</>;
}
