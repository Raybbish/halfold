/* Notes tab: exam alerts, then the points grouped by topic. */
import { useLayoutEffect } from "react";
import type { Detail } from "../../types";
import { PALETTE, fmt } from "../../lib/helpers";
import { cur, state } from "../../state/app";
import { t } from "../../i18n";
import { css } from "../../ui/css";
import { Point, Tools } from "./parts";
import { addPoint, feedbackModal, jump, pickSlides } from "./actions";

export function Notes({ d }: { d: Detail }) {
  /* Opened from a search result: bring the point it found into view, once. */
  useLayoutEffect(() => { if (!state.goFound) return; state.goFound = false; const el = document.querySelector(".pt.found"); if (el) el.scrollIntoView({ block: "center" }); });
  const shared = cur!.shared;
  const sections = d.sections.map((s, i) => { const pts = s.points.map((p, pi) => ({ p, pi })).filter(x => !state.onlyOff || x.p.off); if (!pts.length && !state.edit) return null;
    return <section key={i} className="card nsec" style={css(`border-left:6px solid ${PALETTE[(i + 3) % 5]}`)}><h3><span data-notr="">{s.title}</span>{s.slides ? <span className="tag grey">{s.slides}</span> : null}</h3>{pts.map(x => <Point key={x.pi} p={x.p} si={i} pi={x.pi} />)}{!shared && state.edit ? <div className="pt-acts" style={css("margin-top:12px")}><button className="btn plain sm" onClick={() => addPoint(i)}>{t("Add a note")}</button></div> : null}</section>; }).filter(Boolean);
  return <><Tools d={d} />{d.alerts.map((a, i) => <div key={i} className="alert"><span className="tag amber">{t(a.kind)}</span><span data-notr="">{a.text}</span><button className="ts" onClick={() => jump(+a.t)}>{fmt(a.t)}</button></div>)}<div style={css("height:10px")}></div>
    {sections.length ? sections : <p className="muted">{t("No sidenotes in this lecture.")}</p>}{shared || d.slides.length ? null : <p className="small muted noprint" style={css("margin-top:18px")}>{t("No slides for this lecture yet. ")}<button className="ts" style={css("font-size:inherit")} onClick={pickSlides}>{t("Add slides")}</button></p>}{shared ? null : <p className="small muted noprint" style={css("margin-top:18px")}>{t("Something wrong in these notes? ")}<button className="ts" style={css("font-size:inherit")} onClick={feedbackModal}>{t("Tell us")}</button></p>}</>;
}
