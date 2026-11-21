/* ---------- Help and Privacy: public pages in one layout, and the footer the landing page shares ---------- */
import type { ReactNode } from "react";
import { S } from "../state/app";
import { t } from "../i18n";
import { Logo } from "../ui/icons";
import { LangBtn } from "../ui/Shell";
import { css } from "../ui/css";

export const Footer = () => <footer className="f"><div className="wrap" style={css("display:flex;gap:18px;flex-wrap:wrap;align-items:baseline")}>
  <span style={css("flex:1;min-width:260px")}>{t("Notes are written by AI from your recording and can contain mistakes. Check dates and requirements against your lecturer's announcements. Ask your lecturer before recording if your course requires it.")}</span>
  <a href="#/help">{t("Help")}</a><a href="#/privacy">{t("Privacy")}</a></div></footer>;

/* A line still to be decided before real students use Halfold: shown in a yellow mark so it cannot be missed. */
export const Todo = ({ s }: { s: string }) => <mark style={css("background:var(--yellow);padding:1px 6px;border-radius:6px;font-weight:600")}>{t(s)}</mark>;

/* A section is a heading and either one paragraph or a list. Every sentence goes to t() whole. */
export type Section = [string, string | ReactNode[]];

export function DocPage({ title, lead, sections }: { title: string; lead: string; sections: Section[] }) {
  return <div className="pub" style={css("min-height:100vh")}><div className="dots">
    <nav className="pub-nav"><Logo href="#/" /><span className="sp"></span><LangBtn /><a className="l" href="#/help">{t("Help")}</a><a className="l" href="#/privacy">{t("Privacy")}</a>
      <a className="btn primary sm" href={S.token ? "#/home" : "#/new"}>{t(S.token ? "My lectures" : "Record a lecture")}</a></nav>
    <div className="wrap" style={css("max-width:780px;padding-top:28px;padding-bottom:40px")}><h1 style={css("font-size:40px;font-weight:820")}>{t(title)}</h1><p className="muted" style={css("font-size:18px;margin-top:12px;max-width:34em")}>{t(lead)}</p></div></div>
    <div className="wrap doc" style={css("max-width:780px;padding-bottom:64px")}>{sections.map(([h, body]) => <div key={h}><h2>{t(h)}</h2>
      {typeof body === "string" ? <p>{t(body)}</p> : <ul>{body.map((x, i) => <li key={i}>{x}</li>)}</ul>}</div>)}</div>
    <Footer />
  </div>;
}
