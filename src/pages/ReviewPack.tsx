/* ---------- review pack ---------- */
import { CONFIG } from "../config";
import { api } from "../api/api";
import { PALETTE, fmt, wait } from "../lib/helpers";
import { bump } from "../lib/bus";
import type { ReviewPack as Pack } from "../types";
import { R, S, course, setPendingPos } from "../state/app";
import { act, busy, closeModal } from "../state/overlay";
import { route } from "../state/router";
import { t } from "../i18n";
import { Hal } from "../ui/icons";
import { Shell, Problem } from "../ui/Shell";
import { css } from "../ui/css";
import { isLimit, limitModal } from "../ui/limit";
import { fx } from "../ui/Fx";

/* Where a hint or point came from: the lecture, and the second it was said. */
const Source = ({ x }: { x: { lectureId?: string; lecture?: string; t?: number | null } }) => x.lectureId ? <a className="small noprint" data-notr="" href={"#/lecture/" + encodeURIComponent(x.lectureId)} onClick={() => setPendingPos(+(x.t as number) || 0)}>{(x.lecture || "") + (x.t != null ? ", " + fmt(x.t) : "")}</a> : null;

export function ReviewPack({ id }: { id: string }) {
  const c = course(id); if (!c) return <Shell active="home"><Problem title="This course does not exist" text="It may have been removed." /></Shell>;
  const p: Pack = S.pack[id] || { status: "none" };
  const head = <><div className="crumb"><a href="#/home">{t("Home")}</a>{t(" / ")}<a href={"#/course/" + encodeURIComponent(id)}>{c.code}</a>{t(" / Review pack")}</div>
    <div className="page-h"><div className="hello"><Hal size={52} mood="wow" /><div><h1>{t("Review pack")}</h1><p className="muted" style={css("margin-top:4px")}>{c.code + (c.name ? ", " + c.name : "")}</p></div></div>{p.status === "ready" && p.sheet.length ? <button className="btn" onClick={() => window.print()}>{t("Print or save as PDF")}</button> : null}</div></>;
  if (p.status === "processing") return <Shell active={id}>{head}<div className="card" style={css("padding:28px")}><h3>{t("Hal is still building this pack")}</h3><p className="muted" style={css("margin:8px 0 16px")}>{t("It takes a few minutes for a full course.")}</p><button className="btn primary" onClick={refreshPack}>{t("Check again")}</button></div></Shell>;
  if (p.status !== "ready") return <Shell active={id}>{head}<div className="card" style={css("padding:28px")}><h3>{t("One sheet for the whole course")}</h3><p className="muted" style={css("margin:8px 0 16px;max-width:36em")}>{t("Hal reads every lecture in this course and writes one revision sheet grouped by topic, a list of everything the lecturer flagged for the exam, and a mock exam.")}</p><button className="btn primary" onClick={makePack}>{t("Make review pack")}</button></div></Shell>;
  if (!p.sheet.length) return <Shell active={id}>{head}<div className="card" style={css("padding:28px")}><h3>{t("Nothing to revise yet")}</h3><p className="muted" style={css("margin:8px 0 16px")}>{t("This course has no finished lecture notes. Add a lecture, then make the pack again.")}</p><a className="btn primary" href="#/new">{t("New lecture")}</a></div></Shell>;
  return <Shell active={id}>{head}<div className="pk">
    {p.hints.length ? <><h2>{t("What the lecturer flagged")}</h2>{p.hints.map((a, i) => <div key={i} className="alert"><span className="tag amber">{t(a.kind)}</span><span data-notr="">{a.text}</span><span style={css("margin-left:auto;white-space:nowrap")}><Source x={a} /></span></div>)}</> : null}
    <h2>{t("Revision sheet")}</h2>
    {p.sheet.map((s, i) => <section key={i} className="card nsec" style={css(`border-left:6px solid ${PALETTE[(i + 3) % 5]}`)}><h3 data-notr="">{s.topic}</h3>{s.points.map((x, k) => <div key={k} className={`pt ${x.off ? "off" : ""}`} style={css("grid-template-columns:1fr")}><div className="body">{x.off ? <><span className="tag sn">{t("Not on slides")}</span>{" "}</> : null}<span data-notr="">{fx(x.text)}</span>{" "}<Source x={x} /></div></div>)}</section>)}
    {p.exam.length ? <><h2>{t("Mock exam")}</h2><p className="muted noprint" style={css("margin:-6px 0 12px")}>{t("Open a question to see the options and the answer.")}</p><div className="card" style={css("padding:6px 22px")}>{p.exam.map((q, i) => <details key={i}><summary data-notr="">{(i + 1) + ". "}{fx(q.q)}</summary><ol type="A" data-notr="">{q.opts.map((o, k) => <li key={k}>{fx(o)}</li>)}</ol><p style={css("margin-top:8px")}><b>{t("Answer")}</b>{" "}<b data-notr="">{String.fromCharCode(65 + q.a) + "."}</b>{" "}<span data-notr="">{fx(q.why)}</span></p></details>)}</div></> : null}
  </div></Shell>;
}
function makePack() { const id = R.b; act(async () => { busy("Hal is building your review pack", "Reading every lecture in this course.");
  try { await api.makeReviewPack(id); } catch (e) { if (isLimit(e)) return limitModal((e as Error).message); throw e; }
  let p: Pack = { status: "processing" };
  for (let i = 0; i < 40 && p.status === "processing"; i++) { p = await api.getReviewPack(id); if (p.status === "processing") await wait(CONFIG.POLL_MS); }
  S.pack[id] = p; closeModal(); bump(); }); }
function refreshPack() { delete S.pack[R.b]; route(); }
