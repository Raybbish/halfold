/* Pieces of the lecture page used by more than one tab: a note point, the timeline and the tool row. */
import type { Detail, Point as P } from "../../types";
import { PALETTE, fmt } from "../../lib/helpers";
import { bump } from "../../lib/bus";
import { cur, state } from "../../state/app";
import { t } from "../../i18n";
import { setZhScript, zhScript, zhText } from "../../i18n/zhScript";
import { css } from "../../ui/css";
import { jump, editPoint, delPoint } from "./actions";

/* One point of the notes. Backend text keeps data-notr; "Sidenote" marks a point said in class but not on the slides. */
export function Point({ p, si, pi }: { p: P; si: number; pi: number }) { const own = cur && !cur.shared && state.edit;
  return <div className={`pt ${p.off ? "off" : ""}`}>{p.t != null ? <button className="ts" onClick={() => jump(+p.t!)} aria-label={t("Open transcript at " + fmt(p.t))}>{fmt(p.t)}</button> : <span className="tag grey">{t("You")}</span>}<div className="body">{p.off ? <><span className="tag sn">{t("Sidenote")}</span>{" "}</> : null}<span data-notr="">{p.text}</span>{state.zh && zhText(p) ? <div className="zh" data-notr="" lang={zhScript() === "hans" ? "zh-Hans" : "zh-Hant"}>{zhText(p)}</div> : null}{own ? <div className="pt-acts"><button className="ts" onClick={() => editPoint(si, pi)}>{t("Edit")}</button><button className="ts" style={css("color:var(--red)")} onClick={() => delPoint(si, pi)}>{t("Delete")}</button></div> : null}</div></div>; }

/* The lecture as a coloured bar, one colour per topic, with ! where an exam or deadline was mentioned. The head is
   moved by the player without a redraw (plTick). */
export function Timeline({ d, dur, pos }: { d: Detail; dur: number | undefined; pos: number }) {
  const len = dur || 1, first = d.sections[0] ? d.sections[0].start : 0;
  return <><div className="tl"><div className="track"><span style={css(`width:${first / len * 100}%`)}></span>{d.sections.map((s, i) => <button key={i} className={`seg ${pos >= s.start && pos < s.end ? "on" : ""}`} style={css(`width:${(s.end - s.start) / len * 100}%;background:${PALETTE[(i + 3) % 5]}`)} title={s.title} aria-label={s.title} onClick={() => jump(Number(s.points[0] ? s.points[0].t : s.start))}></button>)}</div>{d.alerts.map((a, i) => <button key={i} className="mk" style={css(`left:${a.t / len * 100}%`)} title={t(a.kind + " at " + fmt(a.t))} aria-label={t(a.kind + " at " + fmt(a.t))} onClick={() => jump(+a.t)}></button>)}<div className="head" style={css(`left:${Math.min(100, pos / len * 100)}%`)}></div></div>
    <div className="tl-ends num"><span>0:00</span><span>{t("One colour per topic. Exam and deadline mentions are marked with !")}</span><span>{fmt(len)}</span></div></>;
}

/* 繁 / 简, only offered when this lecture really has both forms of the explanation. */
function ZhPick({ d }: { d: Detail }) { const hans = zhScript() === "hans";
  return state.zh && d.sections.some(s => s.points.some(p => p.zhHant && p.zhHans)) ? <span className="seg2" role="group" aria-label={t("Chinese characters")}><button className={hans ? "" : "on"} aria-pressed={!hans} onClick={() => setZhScript("hant")} data-notr="">繁</button><button className={hans ? "on" : ""} aria-pressed={hans} onClick={() => setZhScript("hans")} data-notr="">简</button></span> : null; }

export function Tools({ d }: { d: Detail }) {
  return <div className="tools"><label><input type="checkbox" defaultChecked={state.onlyOff} onChange={e => { state.onlyOff = e.currentTarget.checked; bump(); }} />{t(" Sidenotes only (said, but not on the slides)")}</label>
    <label><input type="checkbox" defaultChecked={state.zh} onChange={e => { state.zh = e.currentTarget.checked; bump(); }} />{t(" 中文解釋")}</label><ZhPick d={d} />{cur!.shared ? null : <label><input type="checkbox" defaultChecked={state.edit} onChange={e => { state.edit = e.currentTarget.checked; bump(); }} />{t(" Edit notes")}</label>}</div>;
}
