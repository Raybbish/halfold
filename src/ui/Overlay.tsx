/* Draws the dialog held in state/overlay.ts into #overlay. Keeps the behaviour of modal() in sidenote.html:
   - the first input or textarea is focused each time a dialog opens
   - a click on the dark backdrop closes it, unless it is locked
   - Escape closes it unless it is locked (listener in main.tsx); route() closes it on every navigation */
import { useLayoutEffect, type FC, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { overlay, overlayChannel, closeModal, modal } from "../state/overlay";
import { finishAfterUpload } from "../features/recording/finish";
import { t } from "../i18n";
import { useStore } from "./useStore";
import { Hal } from "./icons";
import { css } from "./css";
import { mb } from "../lib/helpers";

/* Open a dialog whose content is drawn by `view`. Each call shows a fresh dialog, as modal(html) did. */
export const openModal = (view: FC, locked?: boolean) => modal({ kind: "view", view }, locked);

function Busy({ title, text }: { title: string; text: string }) {
  return <div style={css("text-align:center")}><Hal size={64} mood="wow" /><h3 style={css("margin-top:12px")}>{t(title)}</h3><p className="muted">{t(text)}</p></div>;
}
function Waiting({ id, dur }: { id: string; dur: number }) {
  return <div style={css("text-align:center")}><Hal size={56} mood="sad" /><h3 style={css("margin-top:12px")}>{t("Waiting for a connection")}</h3><p className="muted">{t("The end of your recording has not been sent yet. Keep this page open and try again in a moment.")}</p><button className="btn primary" style={css("margin-top:16px")} onClick={() => finishAfterUpload(id, +dur)}>{t("Try again")}</button></div>;
}

function Upload({ loaded, total, cancel }: { loaded: number; total: number; cancel: () => void }) {
  const pct = total ? Math.min(100, loaded / total * 100) : 0;
  return <div style={css("text-align:center")}><Hal size={64} mood="wow" /><h3 style={css("margin-top:12px")}>{t("Uploading")}</h3><p className="muted">{t("Keep this page open until the upload finishes.")}</p>
    <div className="ubar" style={css("margin-top:18px")} role="progressbar" aria-label={t("Upload progress")} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)}><b style={{ width: pct + "%" }}></b></div>
    <p className="small muted num" style={css("margin-top:8px")}>{t(mb(loaded) + " of " + mb(total) + " uploaded")}</p>
    <button className="btn plain" style={css("margin-top:16px")} onClick={cancel}>{t("Cancel upload")}</button></div>;
}

export function Overlay() {
  useStore(overlayChannel);
  const seq = overlay.seq;
  /* sidenote.html wrote a field's value as markup, so the focused field started with the caret at the beginning (a long
     title shows its start). React sets the value as a property, which puts the caret at the end; move it back first. */
  useLayoutEffect(() => { const f = document.querySelector<HTMLInputElement | HTMLTextAreaElement>("#overlay input, #overlay textarea"); if (f) { try { f.setSelectionRange(0, 0); } catch (e) {} f.focus(); } }, [seq]);
  const m = overlay.modal;
  if (!m) return null;
  const b = m.body;
  let content: ReactNode;
  if (b.kind === "busy") content = <Busy title={b.title} text={b.text} />;
  else if (b.kind === "waiting") content = <Waiting id={b.id} dur={b.dur} />;
  else if (b.kind === "upload") content = <Upload loaded={b.loaded} total={b.total} cancel={b.cancel} />;
  else { const View = b.view as FC; content = <View />; }
  return createPortal(
    <div key={seq} className="modal" onClick={m.locked ? undefined : e => { if (e.target === e.currentTarget) closeModal(); }}><div className="box" role="dialog" aria-modal="true">{content}</div></div>,
    document.getElementById("overlay")!);
}
