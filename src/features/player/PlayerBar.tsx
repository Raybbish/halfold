/* The player bar (PlayerBar.tsx, not Player.tsx: on case-insensitive file systems that name clashes with player.ts). React draws it; while it plays, player.ts moves it directly (plTick, plPaint), so the play button's
   icon is an HTML string that plPaint can swap, and the position slider is uncontrolled. The slider's "change" event
   (fired when it is let go) is a native listener: React's onChange fires on every "input" instead. */
import { useLayoutEffect, useRef, type CSSProperties } from "react";
import { fmt } from "../../lib/helpers";
import { state } from "../../state/app";
import { t } from "../../i18n";
import { ICON_PAUSE, ICON_PLAY, pl, plDrag, plDrop, plDur, plRate, plRetry, plSkip, plToggle } from "./player";

export function Player() {
  const bar = useRef<HTMLInputElement>(null);
  useLayoutEffect(() => { const el = bar.current; if (!el) return; const on = () => plDrop(el); el.addEventListener("change", on); return () => el.removeEventListener("change", on); });
  if (pl.err) return <div className="player off" role="group" aria-label={t("Recording of this lecture")}>{t("The recording could not be played. ")}<button className="ts" onClick={plRetry}>{t("Try again")}</button></div>;
  const dur = plDur(), at = Math.min(state.pos, dur), paused = !pl.a || pl.a.paused;
  return <div className="player" role="group" aria-label={t("Recording of this lecture")}>
    <button className="pp" id="pPlay" onClick={() => plToggle()} aria-label={t(paused ? "Play recording" : "Pause recording")} dangerouslySetInnerHTML={{ __html: paused ? ICON_PLAY : ICON_PAUSE }} />
    <div className="ptime num"><b id="pCur">{fmt(at)}</b>{t(" / " + fmt(dur))}</div>
    <input className="pbar" id="pBar" type="range" min="0" max={Math.max(1, Math.floor(dur))} step="1" defaultValue={Math.floor(at)} style={{ "--p": at / dur * 100 + "%" } as CSSProperties} aria-label={t("Position in the recording")} onInput={e => plDrag(e.currentTarget)} ref={bar} />
    <button className="pb back num" onClick={() => plSkip(-15)} aria-label={t("Back 15 seconds")}>-15</button>
    <button className="pb fwd num" onClick={() => plSkip(15)} aria-label={t("Forward 15 seconds")}>+15</button>
    <button className="pb rate num" id="pRate" onClick={plRate} aria-label={t("Playback speed")}>{pl.rate + "×"}</button>
  </div>;
}
