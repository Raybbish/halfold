/* Ask tab: a question about this lecture, answered from its transcript (POST /lectures/:id/ask). Under the answer, the
   lines it rests on ("Where it was said"); a time opens the transcript there and plays the recording from it.
   Only on the student's own lectures. */
import type { Detail } from "../../types";
import { CONFIG } from "../../config";
import { fmt } from "../../lib/helpers";
import { state } from "../../state/app";
import { serverText, t } from "../../i18n";
import { SERVER } from "../../i18n/zh";
import { css } from "../../ui/css";
import { fx } from "../../ui/Fx";
import { askLecture, jump } from "./actions";

/* One of our server's sentences says it all; anything else (a dropped connection) gets a sentence of ours before it. */
const AskError = ({ msg }: { msg: string }) => <p className="err" role="alert" style={css("margin:12px 0 0")}>{Object.prototype.hasOwnProperty.call(SERVER, msg) ? <span data-notr="">{serverText(msg)}</span>
  : <>{t("That question could not be answered right now.")}{msg ? <> <span data-notr="">{msg}</span></> : null}</>}</p>;

export function Ask(_: { d: Detail }) {
  const a = state.ask || { q: "" }, res = a.res;
  return <>
    <form className="askbox" onSubmit={e => { e.preventDefault(); askLecture((e.currentTarget.elements.namedItem("q") as HTMLInputElement).value); }}>
      <input name="q" className="search" style={css("flex:1;min-width:220px")} maxLength={300} placeholder={t("What did the lecturer say about the midterm?")} defaultValue={a.q} aria-label={t("Ask about this lecture")} />
      <button className="btn primary" disabled={!!a.busy}>{t(a.busy ? "Looking" : "Ask")}</button></form>
    {CONFIG.USE_MOCK ? <p className="note-demo">{t("Sample build: this finds the moments in this lecture that mention your words. A written answer comes from the Halfold service.")}</p> : null}
    {a.err !== undefined ? <AskError msg={a.err} /> : null}
    {res ? <div className="card answer" style={css("padding:18px 22px;margin-top:14px")}>
      {res.answer ? <p data-notr="" style={css("white-space:pre-wrap")}>{fx(res.answer)}</p> : null}
      {res.refs.length ? <><h3 style={css(`font-size:16px;margin:${res.answer ? "14px" : "0"} 0 6px`)}>{t("Where it was said")}</h3>{res.refs.map((r, i) => <div key={i} className="pt"><button className="ts" onClick={() => jump(+r.t)} aria-label={t("Open transcript at " + fmt(r.t))}>{fmt(r.t)}</button><div className="body" data-notr="">{r.text}</div></div>)}</>
        : res.answer ? null : <p className="muted">{t("Nothing in this lecture matches that. Try other words.")}</p>}</div>
      : a.busy ? null : <p className="muted" style={css("margin-top:14px")}>{t("Ask anything about this lecture. Every answer points to the moment it was said, so you can check it.")}</p>}
  </>;
}
