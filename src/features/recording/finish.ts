/* ---------- ending a recording and waiting for the notes ---------- */
import { CONFIG } from "../../config";
import { api } from "../../api/api";
import { wait } from "../../lib/helpers";
import { idb } from "../../lib/idb";
import { bump } from "../../lib/bus";
import { R, S, cur } from "../../state/app";
import { act, busy, closeModal, modal, toast } from "../../state/overlay";
import { route } from "../../state/router";
import type { LectureStatus } from "../../types";
import { live, stopRecording } from "./recorder";
import { outbox, dropped, flush } from "./outbox";
import { unmark } from "./orphan";

export function endLive() { const id = live.id!, dur = live.sec, stopped = stopRecording(); live.active = false; finishAfterUpload(id, dur, stopped); }
/* Waits for the recorder's last piece and for the queue to empty, and only then asks for the notes. If the end of the
   audio cannot be sent, a locked dialog ("Waiting for a connection") offers to try again (drawn by ui/Overlay.tsx). */
export function finishAfterUpload(id: string, dur: number, stopped?: Promise<unknown>) { act(async () => { busy("Sending the last of the audio", "Keep this page open."); await stopped;
  if (!(await flush())) { modal({ kind: "waiting", id, dur }, true); return; }
  await finalize(id, dur); }); }
export function doDiscard() { const id = live.id!; dropped.add(id); stopRecording(); outbox.forEach(c => { if (c.id === id && c.key) idb.del(c.key); }); unmark(); live.active = false; live.id = null; flush(); api.deleteLecture(id).catch(() => {}); closeModal(); toast("Recording discarded"); location.hash = "#/home"; }
export async function pollNotes(id: string) { let st: { status: LectureStatus } = { status: "processing" };
  for (let i = 0; i < 100 && st.status === "processing"; i++) { st = await api.getStatus(id); if (st.status === "processing") await wait(CONFIG.POLL_MS); }
  return st.status; }
export async function afterNotes(id: string, status: LectureStatus) {
  if (live.id === id) live.id = null; if (S.orphan && S.orphan.id === id) S.orphan = null; S.homeLoaded = false; delete S.detail[id]; closeModal();
  toast(status === "failed" ? "The notes could not be written. You can try again from the lecture." : status === "processing" ? "Still working. The notes will appear in the lecture when ready." : "Notes are ready");
  const h = "#/lecture/" + encodeURIComponent(id); if (location.hash === h) route(); else location.hash = h;
}
export async function finalize(id: string, duration: number) {
  busy("Sid is writing your notes", "Transcribing, sticking points to slides, and writing flashcards and a quiz. This usually takes a minute or two.");
  await api.finishLecture(id, duration); if (!live.active) unmark();
  await afterNotes(id, await pollNotes(id));
}
/* The recording is kept, so notes can be written again after a failure, or from a recording whose page was closed before it ended. */
export function retryNotes(unfinished: boolean) { const id = cur!.l.id; act(async () => { busy("Sid is writing your notes", "This usually takes a minute or two.");
  if (unfinished) await api.finishLecture(id, 0); else await api.retryLecture(id);
  await afterNotes(id, await pollNotes(id)); }); }
export async function recap() { live.recapBusy = true; bump(); try { const r = await api.catchUp(live.id!, live.segs.map(s => s.t)); live.recap = r.points; } catch (e) { toast((e as Error).message); } live.recapBusy = false; if (R.a === "live") bump(); }
