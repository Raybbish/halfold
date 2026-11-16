/* ---------- recording screen ----------
   The clock (.clk) and the level meter (#lvl) are written by the recorder's timers directly, without a redraw.
   New transcript lines and alerts arrive through applyChunk(), which redraws in place and scrolls #stream to the end. */
import { CONFIG } from "../config";
import { fmt } from "../lib/helpers";
import { bump } from "../lib/bus";
import { closeModal } from "../state/overlay";
import { t } from "../i18n";
import { live, togglePause } from "../features/recording/recorder";
import { doDiscard, endLive, recap } from "../features/recording/finish";
import { Hal } from "../ui/icons";
import { Shell } from "../ui/Shell";
import { openModal } from "../ui/Overlay";
import { css } from "../ui/css";

const Stream = () => live.segs.length ? <>{live.segs.map((s, i) => <div key={i} className="seg-line"><span className="ts">{fmt(s.t)}</span><div data-notr="">{s.text}</div></div>)}</> : <p className="muted" style={css("padding:14px")}>{t("Text appears about half a minute after the lecturer starts speaking.")}</p>;
const LiveAlert = () => live.alert ? <div className="alert" style={css("margin-top:16px")} role="alert"><span className="tag amber">{t(live.alert.kind)}</span><span data-notr="">{live.alert.text}</span><button className="ts" onClick={() => { live.alert = null; bump(); }}>{t("Dismiss")}</button></div> : null;

function discardModal() { openModal(() => <><h3>{t("Discard this recording?")}</h3><p className="muted">{t("Nothing recorded so far will be kept.")}</p><div style={css("display:flex;gap:10px;justify-content:flex-end;margin-top:16px")}><button className="btn plain" onClick={closeModal}>{t("Keep recording")}</button><button className="btn dark" onClick={doDiscard}>{t("Discard recording")}</button></div></>); }

export function Live() {
  return <Shell active="new">
    <div className="crumb"><a href="#/home">{t("Home")}</a>{t(" / Recording")}</div>
    <div className={`live-top ${live.paused ? "paused" : ""}`}><span className="dot" aria-hidden="true"></span><span className="clock clk num" aria-label={t("Recording time")}>{fmt(live.sec)}</span>
      <div><div className="muted">{t((live.paused ? "Paused" : "Recording") + " " + live.courseCode)}</div>{live.mic === "on" ? <div className="lvl" title={t("Microphone level")}><b id="lvl"></b></div> : null}</div><button className="ts discard-m" onClick={discardModal}>{t("Discard")}</button><span style={css("flex:1")}></span>
      <div className="live-actions"><button className="btn plain discard" onClick={discardModal}>{t("Discard")}</button><button className="btn plain" onClick={togglePause}>{t(live.paused ? "Resume" : "Pause")}</button>
        <button className="btn dark" onClick={endLive}>{t("End and make notes")}</button></div></div>
    {live.micNote ? <div className="alert" style={css("margin-top:14px")}><span className="tag amber">{t("Microphone")}</span><span>{t(live.micNote + (live.mic === "none" && CONFIG.USE_MOCK ? " The sample transcript below still plays so you can see the screen." : ""))}</span></div> : null}
    {live.netNote ? <div className="alert" style={css("margin-top:14px")}><span className="tag amber">{t("Connection")}</span><span>{t(live.netNote)}</span></div> : null}
    <div id="liveAlert"><LiveAlert /></div>
    <div className="live-grid">
      <div><h2 style={css("font-size:17px;margin-bottom:8px")}>{t("Live transcript")}</h2>
        <div className="card stream" id="stream"><Stream /></div>
        {CONFIG.USE_MOCK ? <p className="note-demo">{t("Sample build: this transcript is sample text. The microphone is " + (live.mic === "on" ? "really recording, and audio is handed to the upload function every " + CONFIG.CHUNK_SECONDS + " seconds" : "not recording") + ".")}</p> : null}</div>
      <div className="catch"><div style={css("display:flex;gap:12px;align-items:center")}><Hal size={40} mood="wow" /><h2 style={css("font-size:19px")}>{t("Lost the thread?")}</h2></div><p className="small" style={css("margin:8px 0 16px")}>{t("Hal sums up the last five minutes so you can rejoin the class.")}</p>
        <button className="btn blue" onClick={recap} disabled={live.recapBusy}>{t(live.recapBusy ? "Reading back" : "Catch me up")}</button>
        {live.recap ? <div className="recap" style={css("margin-top:16px;padding-top:14px;border-top:2px solid var(--ink)")}><b style={css("color:var(--ink)")}>{t("The last five minutes")}</b><ul style={css("padding-left:18px;margin:8px 0 0")}>{live.recap.map((r, i) => <li key={i} style={css("margin-bottom:6px")} data-notr="">{r}</li>)}</ul></div> : null}</div>
    </div>
  </Shell>;
}
