/* Slides tab: each slide that something was said about, with its points next to it. */
import type { Detail, Point as P } from "../../types";
import { state } from "../../state/app";
import { t } from "../../i18n";
import { css } from "../../ui/css";
import { Point, Tools } from "./parts";

export function Slides({ d }: { d: Detail }) {
  const by: Record<number, { p: P; si: number; pi: number }[]> = {}; d.sections.forEach((s, si) => s.points.forEach((p, pi) => { if (p.slide != null && (!state.onlyOff || p.off)) (by[p.slide] = by[p.slide] || []).push({ p, si, pi }); }));
  const rows = d.slides.filter(sl => by[sl.n]);
  return <><Tools d={d} /><div className="card" style={css("padding:4px 22px 10px")}>{rows.length ? rows.map(sl => <div key={sl.n} className="srow"><div className={`thumb ${sl.image ? "" : "noimg"}`}>{sl.image ? <img src={sl.image} alt={"Slide " + sl.n} /> : <><span className="num">{t("Slide " + sl.n)}</span><b data-notr="">{sl.title}</b></>}</div><div>{by[sl.n].map(x => <Point key={x.si + ":" + x.pi} p={x.p} si={x.si} pi={x.pi} />)}</div></div>) : <p className="muted" style={css("padding:18px 0")}>{t("Nothing to show with this filter.")}</p>}</div>
    <p className="note-demo">{t("Slides without anything said about them are hidden.")}</p></>;
}
