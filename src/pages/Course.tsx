/* ---------- course ---------- */
import { mins, plural } from "../lib/helpers";
import { S, colorOf, course, nf } from "../state/app";
import { t } from "../i18n";
import { Sid } from "../ui/icons";
import { Shell, Problem } from "../ui/Shell";
import { css } from "../ui/css";
import { statusTag } from "./Home";

export function Course({ id }: { id: string }) {
  const c = course(id); if (!c) return <Shell active="home"><Problem title="This course does not exist" text="It may have been removed." /></Shell>;
  const ls = S.lectures.filter(l => l.course === id);
  return <Shell active={id}>
    <div className="crumb"><a href="#/home">{t("Home")}</a>{t(" / ") + c.code}</div>
    <div className="page-h"><div className="hello"><i className="cdot" style={css(`background:${colorOf(c)};width:44px;height:44px;border-radius:12px`)}></i><div><h1>{c.code}</h1><p className="muted" style={css("margin-top:4px")} data-notr="">{c.name}</p></div></div><a className="btn primary" href="#/new" onClick={() => { nf.courseId = c.id; }}>{t("New lecture")}</a></div>
    {ls.length ? <><div style={css("padding:18px 20px;margin-bottom:20px;display:flex;gap:16px;align-items:center;flex-wrap:wrap;background:var(--yellow-soft);border:2px solid var(--ink);border-radius:var(--r-lg)")}>
      <Sid size={44} mood="wow" /><div className="grow" style={css("min-width:220px")}><b style={css("color:var(--ink);font-size:18px")}>{t("Exam review pack")}</b><div className="small">{t("All " + plural(ls.length, "lecture") + " in one revision sheet and a mock exam, weighted towards what the lecturer flagged.")}</div></div>
      <a className="btn dark" href={"#/pack/" + encodeURIComponent(c.id)}>{t("Open review pack")}</a></div>
      <div className="card"><ul className="list">
        {ls.map(l => <li key={l.id}><span className="tag grey num">{t(l.week ? "Week " + l.week : l.date)}</span><div className="grow"><a className="t" data-notr="" href={"#/lecture/" + encodeURIComponent(l.id)}>{l.title}</a><div className="small muted">{t(l.date)}</div></div>{statusTag(l) || <span className="small muted num">{l.duration ? t(mins(l.duration)) : ""}</span>}</li>)}
      </ul></div></> : <div className="card" style={css("padding:28px;text-align:center")}><Sid size={52} /><h3 style={css("margin:12px 0 8px")}>{t("No lectures in " + c.code + " yet")}</h3><a className="btn primary" href="#/new" onClick={() => { nf.courseId = c.id; }}>{t("Add the first one")}</a></div>}
  </Shell>;
}
