/* ---------- notes being written, checked in the background ----------
   Nobody waits on a locked dialog while Hal writes the notes: the lecture page shows "Hal is writing your notes" and this
   module asks GET /lectures/:id/status until the answer is no longer "processing", one loop per lecture. The first check
   is after 300 ms, then one every POLL_MS, at most 600. Errors (no network, a 502 while the server restarts) are not
   reported and do not stop the loop: after each one the wait doubles, up to 20 times POLL_MS (a minute at the usual 3 s),
   and an answer brings it back to POLL_MS. A 404 (the lecture was deleted) or a 401 (signed out) stops it quietly.
   At the end the lecture's status is updated and its cached notes are dropped. The lecture page, if it is open, updates by
   itself; any other page gets a notice that links to the lecture (red when the notes failed). After the 600th try the
   lecture page offers "Check again" instead.
   Slides added to a lecture that has notes are checked by watchSlides below, which holds the loop above off that lecture
   meanwhile (holdWatch), so one lecture is never polled twice. */
import { CONFIG } from "../../config";
import { api } from "../../api/api";
import type { HttpError } from "../../api/http";
import { wait } from "../../lib/helpers";
import { bump, refresh } from "../../lib/bus";
import { R, S, lecture } from "../../state/app";
import { toast } from "../../state/overlay";
import { route } from "../../state/router";
import type { LectureStatus } from "../../types";

/* watching: the loop running for each lecture (a token, so a loop that was stopped notices). seen: lectures this page
   watched to an answer (ready or failed). held: lectures whose slides are being matched. */
const watching = new Map<string, object>(), seen = new Set<string>(), held = new Set<string>();
export const isWatching = (id: string) => watching.has(id);

/* Start checking a lecture: after it ends, or after Try again. Nothing happens if it is checked already or held. */
export function watch(id: string) { if (watching.has(id) || held.has(id)) return; const me = {}; watching.set(id, me); seen.delete(id); run(id, me); }
/* A lecture found "processing" in the home data or on its own page (after a reload, or "Check again") is picked up,
   unless this visit already watched it to an answer. A watch that stopped without one (after the 600th try, say) is
   picked up again. */
export function resumeWatch(id: string) { if (!seen.has(id)) watch(id); }
/* Signing out stops every loop. */
export function unwatchAll() { watching.clear(); seen.clear(); filing.clear(); held.clear(); }
/* Adding slides later: on stops any loop for the lecture and keeps new ones from starting until it is called with off. */
export function holdWatch(id: string, on: boolean) { if (on) { held.add(id); watching.delete(id); } else held.delete(id); }

/* ---------- slides added to a lecture that has notes ----------
   The server files the existing points under the slides: the lecture is "processing", then "ready" again, with slides or,
   when that failed, with the notes as they were (API-CHANGES.md section 3). That takes a minute or two, so it is checked
   here in the background: the notes stay on screen, the lecture page shows a notice (isFiling), and at the end the
   lecture is read again and a notice says how it went (with a link when another page is open). Same waits as above, at
   most 200 tries; a lecture still processing after that is left to the loop above on its next visit. */
const filing = new Set<string>();
export const isFiling = (id: string) => filing.has(id);
export function watchSlides(id: string) { if (filing.has(id)) return; filing.add(id); holdWatch(id, true); runSlides(id); }

async function runSlides(id: string) {
  const mine = () => filing.has(id), done = () => { filing.delete(id); held.delete(id); };
  let status: LectureStatus = "processing", gap = CONFIG.POLL_MS;
  for (let i = 0; i < 200 && status === "processing"; i++) {
    await wait(i ? gap : 1000); if (!mine()) return;
    try { const r = await api.getStatus(id); status = (r && r.status) || status; gap = CONFIG.POLL_MS; }
    catch (e) { const s = (e as HttpError).status; if (s === 404 || s === 401) { done(); return; } gap = Math.min(gap * 2, CONFIG.POLL_MS * 20); }
    if (!mine()) return;
  }
  const here = () => R.a === "lecture" && R.b === id, href = "#/lecture/" + encodeURIComponent(id);
  if (status === "processing") { done(); if (here()) bump(); toast("Still working. The notes will be under the slides when ready."); return; }
  let filed = false;
  try { const r = await api.getLecture(id); S.detail[id] = r.detail; const i = S.lectures.findIndex(x => x.id === id); if (i >= 0) S.lectures[i] = r.lecture; filed = !!(r.detail && r.detail.slides.length); }
  catch (e) { const l = lecture(id); if (l) l.status = status; }
  done(); S.homeLoaded = false; seen.add(id);
  const link = here() ? {} : { href };
  if (filed) toast("Your notes are now under the slides.", link);
  else toast("The slides could not be matched to the notes. The notes are as they were.", { error: true, ...link });
  if (here()) bump(); else if (R.a === "home" || R.a === "course") refresh();
}

async function run(id: string, me: object) {
  const mine = () => watching.get(id) === me; let status: LectureStatus = "processing", gap = CONFIG.POLL_MS;
  for (let i = 0; i < 600 && status === "processing"; i++) {
    await wait(i ? gap : 300); if (!mine()) return;
    try { const r = await api.getStatus(id); status = (r && r.status) || status; gap = CONFIG.POLL_MS; }
    catch (e) { const s = (e as HttpError).status;
      if (s === 404 || s === 401) { if (mine()) watching.delete(id); return; }   // after signing in again the home data picks it up
      gap = Math.min(gap * 2, CONFIG.POLL_MS * 20); }
    if (!mine()) return;
  }
  watching.delete(id); if (status !== "processing") seen.add(id);
  const l = lecture(id), here = R.a === "lecture" && R.b === id, had = !!S.detail[id];
  if (l) l.status = status; S.homeLoaded = false;
  if (status === "processing") { if (here && !had) bump(); return; }   // given up: the card shows "Check again"
  delete S.detail[id];   // the notes are new (or slides were filed in): read them again
  if (here) { route(); return; }
  const href = "#/lecture/" + encodeURIComponent(id);
  if (status === "ready") toast("Your notes are ready.", { href }); else if (status === "failed") toast("The notes for a lecture could not be written.", { error: true, href });
  if (R.a === "home" || R.a === "course") refresh();   // the lists show the new status; refresh() redraws in place, so a search box keeps its text and focus
}
