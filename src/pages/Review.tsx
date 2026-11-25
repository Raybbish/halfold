/* ---------- review ----------
   #/review: every flashcard not marked as known, from all the student's lectures (GET /review), one at a time.
   "I know this" marks it known on its lecture (PUT /lectures/:id/cards/known); "Again later" leaves it for next time.
   Space flips the card, the right arrow is "I know this", the down arrow "Again later". */
import { api } from "../api/api";
import { bump } from "../lib/bus";
import { R, S, rv } from "../state/app";
import { overlay, toast } from "../state/overlay";
import { route } from "../state/router";
import { t } from "../i18n";
import { Hal } from "../ui/icons";
import { Shell } from "../ui/Shell";
import { css } from "../ui/css";
import { fx } from "../ui/Fx";
import { Confetti } from "./lecture/Quiz";
import type { ReviewCard } from "../types";

/* Known on its lecture too: the lecture page, if it was opened in this visit, shows it as known when it is opened again. */
async function setKnown(c: ReviewCard) {
  const d = S.detail[c.lectureId]; if (d) d.progress = { known: [...new Set([...((d.progress && d.progress.known) || []), c.index])].sort((a, b) => a - b) };
  try { await api.setCardKnown(c.lectureId, c.index, true); } catch (e) { toast((e as Error).message, { error: true }); }
}
export function rvNext(know: boolean) { const c = rv.cards[rv.i]; if (!c) return;
  if (know) { rv.known++; if (S.reviewCount) S.reviewCount--; S.homeLoaded = false; setKnown(c); }   // home reloads its "flashcards you know"
  rv.i++; rv.flip = false; bump(); }
function reviewAgain() { rv.fresh = true; route(); }
export function onReviewKey(e: KeyboardEvent) {
  const tag = (e.target as Element).tagName;
  if (R.a !== "review" || !rv.cards[rv.i] || overlay.modal || /INPUT|TEXTAREA|SELECT/.test(tag) || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key === " " && tag !== "BUTTON") { e.preventDefault(); rv.flip = !rv.flip; bump(); }
  else if (e.key === "ArrowRight") rvNext(true);
  else if (e.key === "ArrowDown") { e.preventDefault(); rvNext(false); }
}

export function Review() {
  const c = rv.cards[rv.i], top = <div className="crumb"><a href="#/home">{t("Home")}</a>{t(" / Review")}</div>;
  if (!rv.total) return <Shell active="review">{top}<div className="card" style={css("padding:32px;text-align:center")}><Hal size={60} mood="smile" /><h3 style={css("margin:14px 0 8px")}>{t("No cards to review")}</h3><p className="muted" style={css("margin-bottom:18px")}>{t("Flashcards from your lectures collect here until you mark them as known.")}</p><a className="btn primary" href="#/home">{t("Go to home")}</a></div></Shell>;
  if (!c) { const all = rv.known === rv.total;
    return <Shell active="review">{top}<div className="qz"><div className="result" style={css(`background:${all ? "var(--yellow-soft)" : "#fff"}`)}>{rv.known ? <Confetti /> : null}<Hal size={72} mood="smile" /><h3 className="num" style={css("font-size:28px;margin-top:12px")}>{t(`${rv.known} of ${rv.total} marked as known`)}</h3><p className="muted" style={css("margin:8px 0 20px")}>{t(all ? "Nothing left to review. Record another lecture to get more." : "The rest come back the next time you open Review.")}</p>
      <div style={css("display:flex;gap:12px;justify-content:center;flex-wrap:wrap")}>{all ? null : <button className="btn primary" onClick={reviewAgain}>{t("Go through the rest again")}</button>}<a className={"btn " + (all ? "primary" : "")} href="#/home">{t("Go to home")}</a></div></div></div></Shell>; }
  return <Shell active="review">{top}
    <div className="page-h" style={css("margin-bottom:8px")}><div><h1>{t("Review")}</h1><p className="muted" style={css("margin-top:4px")}>{t("Cards from all your lectures that you have not marked as known.")}</p></div><span className="tag grey num" data-notr="">{rv.i + 1 + " / " + rv.total}</span></div>
    <div className="fc"><button className={"flip" + (rv.flip ? " on" : "")} data-act="rvflip" onClick={e => { rv.flip = !rv.flip; e.currentTarget.classList.toggle("on"); }} aria-label={t("Flip card")}><span className="f" data-notr="">{fx(c.q)}</span><span className="f b" data-notr="">{fx(c.a)}</span></button>
      <p className="small muted" style={css("margin-top:14px")}>{t("From")} <a data-notr="" href={"#/lecture/" + encodeURIComponent(c.lectureId)}>{c.lecture}</a></p>
      <div className="ctl"><button className="btn plain" data-act="rvlater" onClick={() => rvNext(false)}>{t("Again later")}</button><button className="btn primary" data-act="rvknow" onClick={() => rvNext(true)}>{t("I know this")}</button></div>
      <p className="keys">{t("Space flips the card. Right arrow: I know this. Down arrow: again later.")}</p></div></Shell>;
}
