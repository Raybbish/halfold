/* Transcript tab. Typing in the search box redraws the list in place (refresh()), so the box keeps focus.
   The highlighted line (.hit) is moved by the player without a redraw (plTick), so lines are keyed by position
   in the full transcript. */
import type { Detail } from "../../types";
import { fmt } from "../../lib/helpers";
import { refresh } from "../../lib/bus";
import { state } from "../../state/app";
import { t } from "../../i18n";
import { css } from "../../ui/css";
import { jump } from "./actions";

function Lines({ d }: { d: Detail }) {
  const q = state.tq.trim().toLowerCase(), list = d.transcript.map((s, i) => ({ s, i })).filter(x => !q || x.s.text.toLowerCase().includes(q));
  return list.length ? <>{list.map(({ s, i }) => <div key={i} className={`seg-line ${state.hit === s.t ? "hit" : ""}`} id={"seg-" + (+s.t)}><button className="ts" onClick={() => jump(+s.t)}>{fmt(s.t)}</button><div data-notr="">{s.text}</div></div>)}</> : <p className="muted" style={css("padding:10px")}>{t("Nothing in the transcript matches that.")}</p>;
}

export function Transcript({ d }: { d: Detail }) {
  return <><input className="search" style={css("margin-bottom:12px;width:100%;max-width:340px")} type="search" aria-label={t("Search the transcript")} placeholder={t("Search the transcript")} defaultValue={state.tq} onChange={e => { state.tq = e.currentTarget.value; refresh(); }} /><div className="card" style={css("padding:10px")} id="trList"><Lines d={d} /></div></>;
}
