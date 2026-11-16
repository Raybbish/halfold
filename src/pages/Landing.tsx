/* ---------- landing ---------- */
import type { ReactNode } from "react";
import { S, exHref } from "../state/app";
import { t } from "../i18n";
import { Logo, Hal } from "../ui/icons";
import { LangBtn } from "../ui/Shell";
import { Footer } from "./Doc";
import { css } from "../ui/css";

const StickyNote = ({ c, rot, d, pos, ts, children }: { c: string; rot: number; d: number; pos: string; ts: string; children: ReactNode }) =>
  <div className="sticky-w" style={css(`--c:${c};--rot:${rot}deg;--d:${d}s;${pos}`)}><div className="sticky"><b className="num">{ts}</b>{children}</div></div>;

/* A sentence with an emphasised part, translated as a whole. "*" marks the emphasis in both languages. */
const Emph = ({ s }: { s: string }) => <>{t(s).split("*").map((p, i) => i % 2 ? <i key={i}>{p}</i> : p)}</>;

export function Landing() {
  return <div className="pub">
    <div className="dots">
      <nav className="pub-nav"><Logo href="#/" /><span className="sp"></span>
        <LangBtn />{exHref() ? <a className="l" href={exHref()}>{t("Example notes")}</a> : null}<a className="l" href="#/help">{t("Help")}</a><a className="l" href={S.token ? "#/home" : "#/signin"}>{t(S.token ? "My lectures" : "Sign in")}</a>
        <a className="btn primary sm" href="#/new">{t("Record a lecture")}</a></nav>
      <div className="wrap"><section className="hero">
        <div>
          <h1>{t("The slides are half the lecture. Halfnote catches the other half.")}</h1>
          <p className="lead">{t("Record your class and get notes that sit next to each slide: what the lecturer explained, the examples that were never written down, and every exam date they mentioned.")}</p>
          <div className="cta"><a className="btn primary" href="#/new">{t("Record a lecture")}</a>{exHref() ? <a className="btn" href={exHref()}>{t("Open example notes")}</a> : null}</div>
          <div className="niche"><Hal size={22} mood="smile" /><span>{t("Works in the browser on a laptop or a phone. Nothing to install.")}</span></div>
        </div>
        <div className="stage" aria-label={t("A lecture slide with notes attached")}>
          <div className="rec"><i></i><span className="num">{t("Recording 12:48")}</span></div>
          <div className="slide"><h4>{t("Opportunity cost")}</h4><ul><li>{t("Definition")}</li><li>{t("Explicit and implicit costs")}</li><li>{t("Sunk costs")}</li></ul><span className="pg">{t("Slide 4 of 27")}</span></div>
          <StickyNote c="#FFD93B" rot={4} d={.25} pos="right:0;top:36px" ts="6:48"><Emph s="A year here costs the tuition *plus* the salary you did not earn." /></StickyNote>
          <StickyNote c="#FFB5A8" rot={-5} d={.5} pos="left:0;top:250px" ts="0:18">{t("Midterm Thu 26 Nov. Chapters 1 to 4. One A4 page allowed.")}</StickyNote>
          <StickyNote c="#A6EBD1" rot={3} d={.75} pos="right:4%;top:290px" ts="14:20">{t("Concert ticket example: the $400 is gone either way.")}</StickyNote>
        </div>
      </section></div></div>
    <section className="said"><div className="wrap">
      <h2>{t("Lecturers say the important things out loud.")}</h2>
      <p>{t("None of this is written on the slides. Halfnote listens for it and pins it to your notes.")}</p>
      <div className="cloud">
        <span className="bub flag">{t("“This will be on the midterm.”")}</span><span className="bub">{t("“You can read this slide yourselves.”")}</span>
        <span className="bub flag">{t("“The deadline has moved to Monday.”")}</span><span className="bub">{t("“As I said last week…”")}</span>
        <span className="bub flag">{t("“This is where people lose marks.”")}</span><span className="bub">{t("“Any questions? No? Okay.”")}</span>
        <span className="bub flag">{t("“Let me give you an example that is not in the notes.”")}</span><span className="bub">{t("“We are running out of time, so…”")}</span>
      </div>
    </div></section>
    <section className="sect"><div className="wrap">
      <h2>{t("Everything you need between the lecture and the exam.")}</h2>
      <div className="bento">
        <div className="bx b1"><h3>{t("Notes that stick to the slides")}</h3><p>{t("Add the slide deck and every point is filed under the slide it explains. Anything said but not written is marked, so the other half is easy to find.")}</p>
          <div className="art" style={css("display:flex;gap:10px;flex-wrap:wrap")}><span className="mini">{t("Slide 4. Opportunity cost is the best alternative you gave up.")}</span><span className="mini" style={css("background:var(--yellow)")}>{t("Not on the slide. Includes the salary you did not earn.")}</span></div></div>
        <div className="bx b2"><h3>{t("Every point has a source")}</h3><p>{t("Tap a timestamp to read the lecturer's exact words, or play the recording from that moment.")}</p><div className="art"><span className="mini num" style={css("color:var(--blue);font-weight:700")}>{t("27:32 in the transcript")}</span></div></div>
        <div className="bx b3"><h3>{t("Exam radar")}</h3><p>{t("Midterms, deadlines and exam hints are flagged in class and counted down on your home page.")}</p><div className="art"><span className="mini"><b>{t("15 days")}</b>{t(" to the ECON 1001 midterm")}</span></div></div>
        <div className="bx b4"><h3>{t("Catch me up")}</h3><p>{t("Zoned out? One tap summarises the last five minutes while class is still going.")}</p><div className="art"><Hal size={44} mood="wow" color="#A6EBD1" /></div></div>
        <div className="bx b5"><h3>{t("Flashcards and a quiz")}</h3><p>{t("Written from your lecture, not a generic textbook. Wrong answers link back to the moment it was taught.")}</p><div className="art"><span className="mini">{t("Card 3 of 6")}</span></div></div>
        <div className="bx b6"><div className="grow"><h3>{t("One link for the whole class")}</h3><p style={css("margin-top:8px")}>{t("Drop the notes in the course group chat. Classmates read them without an account, and the next person records the next lecture.")}</p></div>
          <div className="chat"><div className="m">{t("did anyone get what she said about the midterm")}</div><div className="m me">{t("halfnote link to ECON 1001 week 9")}</div><div className="m">{t("you are a legend")}</div></div></div>
      </div>
    </div></section>
    <section className="sect" style={css("padding-top:0")}><div className="wrap">
      <h2>{t("Three ways to get a lecture in")}</h2>
      <div className="ways">
        <div className="card"><svg width="40" height="40" viewBox="0 0 40 40" aria-hidden="true"><rect x="7" y="8" width="26" height="18" rx="3" fill="#E9EEFF" stroke="#16233B" strokeWidth="2" /><path d="M3 31h34" stroke="#16233B" strokeWidth="2.5" strokeLinecap="round" /></svg><h3 style={css("font-size:19px")}>{t("Record on your laptop")}</h3><p className="muted" style={css("margin-top:6px")}>{t("Open Halfnote in a tab and keep working. Recording continues in the background.")}</p></div>
        <div className="card"><svg width="40" height="40" viewBox="0 0 40 40" aria-hidden="true"><rect x="12" y="4" width="16" height="32" rx="4" fill="#FFE6E1" stroke="#16233B" strokeWidth="2" /><circle cx="20" cy="30" r="1.6" fill="#16233B" /></svg><h3 style={css("font-size:19px")}>{t("Record on your phone")}</h3><p className="muted" style={css("margin-top:6px")}>{t("Face up on the desk, with this page open and the screen on.")}</p></div>
        <div className="card"><svg width="40" height="40" viewBox="0 0 40 40" aria-hidden="true"><path d="M8 26v6h24v-6" fill="none" stroke="#16233B" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" /><path d="M20 26V8m-7 7 7-7 7 7" fill="none" stroke="#16233B" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" /></svg><h3 style={css("font-size:19px")}>{t("Upload a recording")}</h3><p className="muted" style={css("margin-top:6px")}>{t("Already have the audio or the lecture video? Upload it and get the same notes.")}</p></div>
      </div>
    </div></section>
    <section className="end"><div className="wrap"><Hal size={64} mood="smile" color="#fff" /><h2>{t("Your next lecture is the best one to start with.")}</h2><a className="btn dark" href="#/new">{t("Record a lecture")}</a></div></section>
    <Footer />
  </div>;
}
