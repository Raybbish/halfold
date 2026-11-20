/* ---------- ending a recording, and starting the notes ---------- */
import { api } from "../../api/api";
import { idb } from "../../lib/idb";
import { bump } from "../../lib/bus";
import { R, S, cur, lecture } from "../../state/app";
import { act, busy, closeModal, modal, toast } from "../../state/overlay";
import { route } from "../../state/router";
import { live, saveLiveMeta, stopRecording } from "./recorder";
import { outbox, dropped, flush } from "./outbox";
import { unmark } from "./orphan";
import { watch } from "../notes/watch";

/* A title still being typed is sent first: on an iPhone, tapping End with the keyboard up does not leave the title box, so its blur never comes. */
export function endLive() { saveLiveMeta(); const id = live.id!, dur = live.sec, stopped = stopRecording(); live.active = false; finishAfterUpload(id, dur, stopped); }
/* Waits for the recorder's last piece and for the queue to empty, and only then asks for the notes. If the end of the
   audio cannot be sent, a locked dialog ("Waiting for a connection") offers to try again (drawn by ui/Overlay.tsx). */
export function finishAfterUpload(id: string, dur: number, stopped?: Promise<unknown>) { act(async () => { busy("Sending the last of the audio", "Keep this page open."); await stopped;
  if (!(await flush())) { modal({ kind: "waiting", id, dur }, true); return; }
  await finalize(id, dur); }); }
export function doDiscard() { const id = live.id!; dropped.add(id); stopRecording(); outbox.forEach(c => { if (c.id === id && c.key) idb.del(c.key); }); unmark(); live.active = false; live.id = null; flush(); api.deleteLecture(id).catch(() => {}); closeModal(); toast("Recording discarded"); location.hash = "#/home"; }
/* The notes are being written: the lecture shows the writing card and is checked in the background. */
function writing(id: string) {
  if (live.id === id) live.id = null; if (S.orphan && S.orphan.id === id) S.orphan = null;
  S.homeLoaded = false; const l = lecture(id); if (l) l.status = "processing"; S.detail[id] = null; watch(id);
}
/* Asks for the notes of a lecture whose audio is all on the server: a recording that ended, a link, an upload.
   Then straight to the lecture page, where the notes appear when they are ready. quiet (an upload that finished in the
   background): the page stays where it is and a notice links to the lecture. */
export async function finalize(id: string, duration: number, quiet?: boolean) {
  const href = "#/lecture/" + encodeURIComponent(id), here = () => R.a === "lecture" && R.b === id;
  try { await api.finishLecture(id, duration); }
  catch (e) { S.homeLoaded = false; delete S.detail[id]; toast("The lecture was saved, but its notes could not be started. Open it to try again.", { error: true, href });
    if (!quiet) { closeModal(); if (R.a === "live") location.hash = "#/home"; else route(); } else if (here()) route();   // quiet: whatever the student is doing elsewhere is left alone
    return; }
  if (!live.active) unmark(); writing(id);
  if (quiet) { if (here()) bump(); else toast("Upload finished. The notes are being written.", { href }); return; }
  closeModal(); if (location.hash === href) route(); else location.hash = href;
}
/* The recording is kept, so notes can be written again after a failure, or from a recording whose page was closed before it ended.
   The dialog covers only the request; then the lecture page shows the writing card. */
export function retryNotes(unfinished: boolean) { const id = cur!.l.id; act(async () => { busy("Starting again", "A few seconds.");
  if (unfinished) await api.finishLecture(id, 0); else await api.retryLecture(id);
  writing(id); closeModal(); bump(); }); }
export async function recap() { live.recapBusy = true; bump(); try { const r = await api.catchUp(live.id!, live.segs.map(s => s.t)); live.recap = r.points; } catch (e) { toast((e as Error).message); } live.recapBusy = false; if (R.a === "live") bump(); }
