/* Audio waiting to be sent. Chunks go in order; a failed send stays queued and is retried when the connection returns
   (the "online" listener and a 10-second timer, both registered in main.tsx).
   Each chunk is also kept in IndexedDB until the server has it, so a closed tab does not lose it (see orphan.ts). */
import type { ChunkReply } from "../../types";
import type { HttpError } from "../../api/http";
import { api } from "../../api/api";
import { idb, type StoredChunk } from "../../lib/idb";
import { bump, refresh } from "../../lib/bus";
import { R } from "../../state/app";
import { live } from "./recorder";

export const outbox: StoredChunk[] = [], dropped = new Set<string>(); let flushJob: Promise<boolean> | null = null;
export function flush() { if (!flushJob) flushJob = sendAll().finally(() => { flushJob = null; }); return flushJob; }   // resolves true once nothing is left to send; callers share one run
async function sendAll() {
  while (outbox.length) { const c = outbox[0];
    if (!dropped.has(c.id)) {
      try { applyChunk(await api.uploadChunk(c.id, c.blob, c.seq), c.id); setOffline(false); }
      catch (e) { const err = e as HttpError; if (err.status === 404 || err.status === 410) dropped.add(c.id);   // the lecture is gone on the server: stop sending its audio
        else { setOffline(true, err); return false; } } }
    const i = outbox.indexOf(c); if (i >= 0) outbox.splice(i, 1); if (c.key) idb.del(c.key); }
  return true;
}
export function setOffline(off: boolean, e?: HttpError) {
  if (off === live.offline) return; live.offline = off;
  live.netNote = !off ? "" : e && e.status ? "Halfold could not save the audio just now. Recording continues and it will keep trying. Keep this page open."
    : "Connection lost. Recording continues and the audio will be sent when you are back online. Keep this page open.";
  if (live.active && R.a === "live") bump();
}
/* New transcript lines and exam alerts from a chunk reply. sidenote.html rewrote #stream and #liveAlert here without a
   full render; the live page now draws them from `live`, and the transcript is still scrolled to the bottom. */
export function applyChunk(res: ChunkReply | null, id: string) { if (!res || !live.active || id !== live.id) return; if (res.segments) live.segs.push(...res.segments); if (res.alerts && res.alerts.length) { live.alert = res.alerts[res.alerts.length - 1]; try { navigator.vibrate && navigator.vibrate(200); } catch (e) {} }
  if (R.a !== "live") return; refresh(); const st = document.getElementById("stream"); if (st) st.scrollTop = st.scrollHeight; }
