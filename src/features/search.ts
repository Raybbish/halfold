/* Searching the notes of every lecture (added after the migration).
   The home page's search box still filters the lecture list in the browser, as before: titles, course codes and
   names, and the notes of the lectures opened in this visit. The notes of every lecture are searched on the server,
   GET /search?q= (api.searchNotes), once typing pauses. A backend without that endpoint (404, 405 or 501) leaves the
   box as it was for the rest of the visit. A reply that arrives after the query changed is dropped. */
import { api } from "../api/api";
import type { HttpError } from "../api/http";
import { refresh } from "../lib/bus";
import type { NoteHit } from "../types";

export const MIN_QUERY = 2, PAUSE_MS = 300;
/* The query as it is compared and sent: trimmed, spaces collapsed, lower case. */
export const norm = (q: string) => q.trim().replace(/\s+/g, " ").toLowerCase();

/* hits and failed belong to q. busy: a search for the text now in the box is waiting or on its way. */
export const found = { q: "", hits: [] as NoteHit[], failed: false, busy: false, off: false };
let timer: number | undefined, seq = 0;

/* On every change of the search box, and when the home page is drawn with text already in the box (now = true). */
export function searchNotes(raw: string, now = false) {
  window.clearTimeout(timer); seq++;
  const q = norm(raw);
  if (found.off || q.length < MIN_QUERY) { Object.assign(found, { q: "", hits: [], failed: false, busy: false }); return; }
  found.busy = true;
  const my = seq;
  timer = window.setTimeout(() => run(q, my), now ? 0 : PAUSE_MS);
}

async function run(q: string, my: number) {
  try {
    const r = await api.searchNotes(q);
    if (my !== seq) return;
    Object.assign(found, { q, hits: (r && Array.isArray(r.results) ? r.results : []).slice(0, 20), failed: false, busy: false });
  } catch (e) {
    if (my !== seq) return;
    const s = (e as HttpError).status;
    if (s === 404 || s === 405 || s === 501) Object.assign(found, { off: true, busy: false });
    else Object.assign(found, { q, hits: [], failed: true, busy: false });
  }
  refresh();   // in place, so the search box keeps focus
}
