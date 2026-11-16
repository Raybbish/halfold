/* ---------- notes being written, checked in the background ----------
   Nobody waits on a locked dialog while Hal writes the notes: the lecture page shows "Hal is writing your notes" and this
   module asks GET /lectures/:id/status until the answer is no longer "processing", one loop per lecture. The first check
   is after 300 ms, then one every POLL_MS, at most 600. Network errors are not reported (the next try asks again; 20 in a
   row stop the loop); a 404 (the lecture was deleted) or a 401 (signed out) stops it quietly.
   At the end the lecture's status is updated and its cached notes are dropped. The lecture page, if it is open, updates by
   itself; any other page gets a notice that links to the lecture (red when the notes failed). After the 600th try the
   lecture page offers "Check again" instead.
   Adding slides to a lecture that has notes polls on its own (pages/lecture/actions.tsx) and holds this module off that
   lecture meanwhile (holdWatch), so one lecture is never polled twice. */
import { CONFIG } from "../../config";
import { api } from "../../api/api";
import type { HttpError } from "../../api/http";
import { wait } from "../../lib/helpers";
import { bump, refresh } from "../../lib/bus";
import { R, S, lecture } from "../../state/app";
import { toast } from "../../state/overlay";
import { route } from "../../state/router";
import type { LectureStatus } from "../../types";

/* watching: the loop running for each lecture (a token, so a loop that was stopped notices). seen: lectures watched since
   this page was loaded. held: lectures whose slides are being matched. */
const watching = new Map<string, object>(), seen = new Set<string>(), held = new Set<string>();
export const isWatching = (id: string) => watching.has(id);

/* Start checking a lecture: after it ends, or after Try again. Nothing happens if it is checked already or held. */
export function watch(id: string) { if (watching.has(id) || held.has(id)) return; const me = {}; watching.set(id, me); seen.add(id); run(id, me); }
/* A lecture found "processing" in the home data or on its own page (after a reload, say) is picked up, unless this
   visit already watched it to the end: then its page offers "Check again" rather than starting over. */
export function resumeWatch(id: string) { if (!seen.has(id)) watch(id); }
/* Signing out stops every loop. */
export function unwatchAll() { watching.clear(); seen.clear(); }
/* Adding slides later: on stops any loop for the lecture and keeps new ones from starting until it is called with off. */
export function holdWatch(id: string, on: boolean) { if (on) { held.add(id); watching.delete(id); } else held.delete(id); }

async function run(id: string, me: object) {
  const mine = () => watching.get(id) === me; let status: LectureStatus = "processing", fails = 0;
  for (let i = 0; i < 600 && status === "processing"; i++) {
    await wait(i ? CONFIG.POLL_MS : 300); if (!mine()) return;
    try { const r = await api.getStatus(id); status = (r && r.status) || status; fails = 0; }
    catch (e) { const s = (e as HttpError).status;
      if (s === 404 || s === 401) { if (mine()) { watching.delete(id); if (s === 401) seen.delete(id); } return; }   // after signing in again the home data picks it up
      if (++fails >= 20) break; }
    if (!mine()) return;
  }
  watching.delete(id);
  const l = lecture(id), here = R.a === "lecture" && R.b === id, had = !!S.detail[id];
  if (l) l.status = status; S.homeLoaded = false;
  if (status === "processing") { if (here && !had) bump(); return; }   // given up: the card shows "Check again"
  delete S.detail[id];   // the notes are new (or slides were filed in): read them again
  if (here) { route(); return; }
  const href = "#/lecture/" + encodeURIComponent(id);
  if (status === "ready") toast("Your notes are ready.", { href }); else if (status === "failed") toast("The notes for a lecture could not be written.", { error: true, href });
  if (R.a === "home" || R.a === "course") refresh();   // the lists show the new status; refresh() redraws in place, so a search box keeps its text and focus
}
