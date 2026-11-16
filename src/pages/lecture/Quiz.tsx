/* Quiz tab, with the result screen and "retry the ones you missed". */
import type { Detail } from "../../types";
import { fmt } from "../../lib/helpers";
import { state } from "../../state/app";
import { t } from "../../i18n";
import { Hal } from "../../ui/icons";
import { css } from "../../ui/css";
import { jump, nextQ, pick, restartQuiz, retryMissed } from "./actions";

const Confetti = () => { const cs = ["#FFD93B", "#FF6B57", "#19B88A", "#7A5AF8", "#2B59FF"]; return <>{Array.from({ length: 26 }, (_, i) => <i key={i} className="conf" style={css(`left:${(i * 37) % 100}%;background:${cs[i % 5]};animation-delay:${(i % 7) * .08}s`)}></i>)}</>; };

export function Quiz({ d }: { d: Detail }) {
  const order = state.order || d.quiz.map((_, i) => i), total = order.length;
  if (!d.quiz.length) return <p className="muted">{t("No quiz for this lecture.")}</p>;
  if (state.done) { const all = state.score === total, good = state.score >= total * .6, miss = state.wrong.length;
    return <div className="qz"><div className="result" style={css(`background:${all ? "var(--yellow-soft)" : "#fff"}`)}>{good ? <Confetti /> : null}<Hal size={72} mood={good ? "smile" : "wow"} /><h3 className="num" style={css("font-size:30px;margin-top:12px")}>{t(`${state.score} of ${total} correct`)}</h3><p className="muted" style={css("margin:8px 0 20px")}>{t(all ? "Clean sheet. The midterm should be worried." : "Each wrong answer links back to the moment it was taught.")}</p><div style={css("display:flex;gap:12px;justify-content:center;flex-wrap:wrap")}>{miss ? <button className="btn primary" onClick={retryMissed}>{t(`Retry the ${miss} you missed`)}</button> : null}<button className={`btn ${miss ? "" : "primary"}`} onClick={restartQuiz}>{t("Take the whole quiz again")}</button></div></div></div>; }
  const q = d.quiz[order[state.qi]];
  return <div className="qz"><div className="pips" style={css("justify-content:flex-start")}>{order.map((_, i) => <i key={i} className={i === state.qi ? "c" : i < state.qi ? "k" : ""}></i>)}</div><h3 style={css("font-size:21px;line-height:1.35")} data-notr="">{q.q}</h3>
    {q.opts.map((o, i) => <button key={i} className={`opt ${state.picked !== null ? (i === q.a ? "ok" : i === state.picked ? "no" : "") : ""}`} disabled={state.picked !== null} onClick={() => pick(i)} data-notr="">{o}</button>)}
    {state.picked !== null ? <><div className="why"><Hal size={34} mood={state.picked === q.a ? "smile" : "wow"} /><div><b>{t(state.picked === q.a ? "Correct." : "Not quite.")}</b>{" "}<span data-notr="">{q.why || ""}</span>{" "}{q.t != null ? <button className="ts" onClick={() => jump(+q.t!)}>{t("Said at " + fmt(q.t))}</button> : null}</div></div>
      <div style={css("text-align:right;margin-top:16px")}><button className="btn primary" onClick={nextQ}>{t(state.qi + 1 < total ? "Next question" : "See result")}</button></div></> : <p className="keys">{t(`Keys 1 to ${q.opts.length} answer. Enter continues.`)}</p>}</div>;
}
