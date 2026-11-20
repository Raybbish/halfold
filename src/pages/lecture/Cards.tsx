/* Flashcards tab. Tapping the card flips it with a CSS class only, without a redraw, as before. */
import type { Detail } from "../../types";
import { state } from "../../state/app";
import { t } from "../../i18n";
import { css } from "../../ui/css";
import { fx } from "../../ui/Fx";
import { card, know } from "./actions";

export function Cards({ d }: { d: Detail }) {
  const f = d.flashcards[state.fc];
  return f ? <div className="fc"><div className="pips">{d.flashcards.map((_, i) => <i key={i} className={i === state.fc ? "c" : state.known.has(i) ? "k" : ""}></i>)}</div>
    <button className={`flip ${state.flip ? "on" : ""}`} onClick={e => { state.flip = !state.flip; e.currentTarget.classList.toggle("on"); }} aria-label={t("Flip card")}><span className="f" data-notr="">{fx(f.q)}</span><span className="f b" data-notr="">{fx(f.a)}</span></button>
    <p className="small muted" style={css("margin-top:16px")}>{t(`Tap the card to flip it. ${state.known.size} of ${d.flashcards.length} marked as known.`)}</p>
    <div className="ctl"><button className="btn plain" onClick={() => card(-1)}>{t("Previous")}</button><button className="btn" onClick={know}>{t("I know this")}</button><button className="btn primary" onClick={() => card(1)}>{t("Next")}</button></div><p className="keys">{t("Arrow keys move between cards. Space flips.")}</p></div>
    : <p className="muted">{t("No flashcards for this lecture.")}</p>;
}
