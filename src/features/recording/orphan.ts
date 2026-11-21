/* ---------- unfinished recordings ----------
   localStorage sidenote.live marks a recording in progress (with a heartbeat), IndexedDB holds its unsent audio.
   On start-up findOrphan() looks for a recording that was cut off by a closed tab and offers to finish it. */
import { api } from "../../api/api";
import { store } from "../../lib/store";
import { idb, type StoredChunk } from "../../lib/idb";
import { bump } from "../../lib/bus";
import { S } from "../../state/app";
import { toast } from "../../state/overlay";
import { live } from "./recorder";
import { outbox } from "./outbox";
import { finishAfterUpload } from "./finish";

interface Mark { id: string; code: string; sec: number; at: number }
export function mark() { store.set("live", JSON.stringify({ id: live.id, code: live.courseCode, sec: live.sec, at: Date.now() })); }   // at = heartbeat while the recording runs
export function unmark() { store.del("live"); }
/* A freshly opened tab asks the others whether one of them is recording right now. Message events are not slowed
   down in background tabs the way timers are, so the answer arrives at once. One channel per page, opened when this module loads. */
const recChan = (() => { try { const c = new BroadcastChannel("sidenote-rec"); c.addEventListener("message", e => { if (e.data === "ping" && live.active) c.postMessage("alive:" + live.id); }); return c; } catch (e) { return null; } })();
function recordingElsewhere(m: Mark | null) { return new Promise<string | null>(res => {
  if (!recChan) return res(m && m.at && Date.now() - m.at < 90000 ? m.id : null);   // no channel in this browser: trust a recent heartbeat instead
  const done = (id: string | null) => { recChan.removeEventListener("message", on); res(id); }, on = (e: MessageEvent) => { if (String(e.data).indexOf("alive:") === 0) done(String(e.data).slice(6)); };
  recChan.addEventListener("message", on); recChan.postMessage("ping"); setTimeout(() => done(null), 400); }); }
export async function findOrphan() { let m: Mark | null = null; try { m = JSON.parse(store.get("live") || "null"); } catch (e) {}
  let all: StoredChunk[] = (await idb.all()) || []; if (!m && !all.length) return;
  const busyId = live.active ? live.id : await recordingElsewhere(m);   // a recording that is running right now, here or in another tab, is not an interrupted one
  if (busyId) { all = all.filter(c => c.id !== busyId); if (m && m.id === busyId) m = null; if (!m && !all.length) return; }
  const id = m ? m.id : all[0].id, chunks = all.filter(c => c.id === id).sort((a, b) => a.seq - b.seq);
  S.orphan = { id, code: m ? m.code : (chunks[0] && chunks[0].code) || "", sec: Math.max(m ? m.sec : 0, ...chunks.map(c => c.sec || 0)), chunks }; }
export function recoverOrphan() { const o = S.orphan!; S.orphan = null; o.chunks.forEach(c => outbox.push(c)); bump(); finishAfterUpload(o.id, o.sec); }
/* Forgets the interrupted recording on this device: the notice, the mark and its saved audio. Also used when its lecture
   is deleted from the lecture page (pages/lecture/actions.tsx). */
export async function forgetOrphan() { const o = S.orphan!; S.orphan = null; unmark(); for (const c of o.chunks) await idb.del(c.key); }
export async function dropOrphan() { const o = S.orphan!; await forgetOrphan(); api.deleteLecture(o.id).catch(() => {}); toast("Recording discarded"); bump(); }
