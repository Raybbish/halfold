/* ---------- marks made in class ----------
   "Important" and "Lost me" on the recording page. Each mark is sent to the server (POST /lectures/:id/marks), which
   gives it back in detail.marks with the notes, and is kept in this browser too (sidenote.marks.<lecture id>), so a mark
   the server never got still shows on the lecture page. */
import type { Detail, Line, Mark, MarkKind } from "../types";
import { api } from "../api/api";
import { store } from "../lib/store";
import { refresh } from "../lib/bus";
import { toast } from "../state/overlay";
import { live } from "./recording/recorder";

const key = (id: string) => "marks." + id;
const kept = (id: string): Mark[] => { try { const m = JSON.parse(store.get(key(id)) || "[]"); return Array.isArray(m) ? m : []; } catch (e) { return []; } };

/* The page is updated in place (refresh), so the title box keeps what is being typed and the live transcript its place. */
export function addMark(kind: MarkKind) {
  if (!live.active || !live.id) return;
  const m: Mark = { t: live.sec, kind }; live.marks.push(m); store.set(key(live.id), JSON.stringify(live.marks));
  api.addMark(live.id, m).catch(() => {});
  try { if (navigator.vibrate) navigator.vibrate(40); } catch (e) {}
  toast(kind === "lost" ? "Marked. The notes will point back to this moment." : "Marked as important.");
  refresh();
}
/* The marks of one of the student's lectures, by time: the server's and any kept here that it does not have. Once the
   server has every one kept here, the copy here is no longer needed. */
export function marksOf(d: Detail, id: string): Mark[] {
  const server = d.marks || [], here = kept(id), same = (a: Mark, b: Mark) => Math.abs(a.t - b.t) < 0.05 && a.kind === b.kind;
  const extra = here.filter(m => !server.some(s => same(s, m)));
  if (here.length && !extra.length) store.del(key(id));
  return [...server, ...extra].sort((a, b) => a.t - b.t);
}
export const forgetMarks = (id: string) => store.del(key(id));
/* The line of the transcript being said at a mark (a mark comes a moment after the words that prompted it). */
export function lineAt(lines: Line[], t: number): Line | null { let best: Line | null = null; for (const s of lines) { if (s.t <= t + 2) best = s; else break; } return best; }
