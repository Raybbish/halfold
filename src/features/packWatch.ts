/* ---------- review packs being made, checked in the background ----------
   Making a pack takes a few minutes for a full course. Nobody waits on a locked dialog: the pack page says it is being
   made and this module asks GET /courses/:id/review-pack until the answer is no longer "processing", one loop per course,
   every POLL_MS (at most 300 times). Network errors are not reported and do not stop it: the wait doubles, up to 20 times
   POLL_MS. A 502 is the server saying the pack could not be made (it answers that once, then "none"): the loop stops and
   says so. At the end the pack page, if it is open, updates by itself; any other page gets a notice that links to it.
   A pack found "processing" when the page is opened (after a reload, say) is picked up by the router. */
import { CONFIG } from "../config";
import { api } from "../api/api";
import type { HttpError } from "../api/http";
import { wait } from "../lib/helpers";
import { bump } from "../lib/bus";
import { R, S } from "../state/app";
import { toast } from "../state/overlay";
import type { ReviewPack } from "../types";

const packing = new Set<string>();
export const isPacking = (courseId: string) => packing.has(courseId);

export async function watchPack(courseId: string) {
  if (packing.has(courseId)) return; packing.add(courseId);
  const token = S.token, here = () => R.a === "pack" && R.b === courseId, href = "#/pack/" + encodeURIComponent(courseId);
  let p: ReviewPack = { status: "processing" }, gap = CONFIG.POLL_MS, failed = "";
  for (let i = 0; i < 300 && p.status === "processing"; i++) {
    await wait(i ? gap : 500); if (S.token !== token) { packing.delete(courseId); return; }   // signed out meanwhile
    try { p = (await api.getReviewPack(courseId)) || p; gap = CONFIG.POLL_MS; }
    catch (e) { const s = (e as HttpError).status;
      if (s === 404 || s === 401) { packing.delete(courseId); return; }
      if (s === 502) { failed = (e as Error).message; p = { status: "none" }; break; }
      gap = Math.min(gap * 2, CONFIG.POLL_MS * 20); }
  }
  packing.delete(courseId);
  if (p.status === "processing") { if (here()) bump(); return; }   // given up: the page offers "Check again"
  S.pack[courseId] = p;
  if (failed) toast(failed, { error: true, ...(here() ? {} : { href }) });
  else if (p.status === "ready" && !here()) toast("Your review pack is ready.", { href });
  if (here()) bump();
}
