/* ---------- router ----------
   Hash routes, the same addresses as sidenote.html: #/, #/signin, #/home, #/courses, #/course/:id, #/lecture/:id,
   #/s/:id, #/new, #/live, #/pack/:id, #/review, #/settings, and the public #/help and #/privacy. route() keeps the original sign-in guard, data loading and
   race handling: routeSeq makes sure only the newest navigation draws its result. */
import { api } from "../api/api";
import { bump } from "../lib/bus";
import { plStop } from "../features/player/player";
import { live } from "../features/recording/recorder";
import { resumeWatch, watchSlides } from "../features/notes/watch";
import { watchPack } from "../features/packWatch";
import { closeModal } from "./overlay";
import { R, S, findPoint, lecture, rv, session, setPendingPoint, setPendingPos, pendingPoint, pendingPos, state, view } from "./app";

export const PUBLIC = ["", "s", "signin", "help", "privacy"];
let routeSeq = 0;

export async function route() {
  closeModal();
  const h = location.hash.replace(/^#\/?/, ""), parts = h.split("/"), a = parts[0] || "", b = parts[1] ? decodeURIComponent(parts[1]) : "";
  if (!PUBLIC.includes(a) && !S.token) { S.next = location.hash; location.hash = "#/signin"; return; }
  if (a === "signin" && S.token) { location.hash = "#/home"; return; }
  if (a === "live" && !live.active) { location.hash = "#/new"; return; }
  const changed = R.a !== a || R.b !== b; Object.assign(R, { a, b }); const seq = ++routeSeq; S.error = null;
  if (changed) { plStop(); window.scrollTo(0, 0); if (a === "lecture" || a === "s") Object.assign(state, { tab: "notes", hit: null, pos: pendingPos || 0, fc: 0, flip: false, known: new Set(), qi: 0, picked: null, score: 0, done: false, onlyOff: false, zh: !!S.settings.zhDefault, tq: "", edit: false, order: null, wrong: [], found: null, goFound: false, ask: null, closed: new Set() }); setPendingPos(0); }
  const hit = changed && a === "lecture" && pendingPoint && pendingPoint.lecture === b ? pendingPoint : null; setPendingPoint(null);
  const needHome = !PUBLIC.includes(a) && !S.homeLoaded, needLec = a === "lecture" && !(b in S.detail), needSh = a === "s" && !S.shared[b], needPack = a === "pack" && !S.pack[b], needPlans = a === "settings" && !S.plans, needRev = a === "review" && (changed || rv.fresh);
  /* While loading: the app's shell with a skeleton, or Hal in the middle of an empty page. */
  if (needHome || needLec || needSh || needPack || needPlans || needRev) { view.loader = S.homeLoaded && !PUBLIC.includes(a) ? "shell" : "center"; bump(); }
  try {
    /* reviewCount comes with it when the server counts the cards; a count made by the Review page stays when it does not. */
    if (needHome) { const r = await api.getHome(); Object.assign(S, r); S.settings = r.settings || S.settings; S.homeLoaded = true; session.save(); if (a === "lecture" || a === "s") state.zh = !!S.settings.zhDefault;
      S.lectures.forEach(l => { if (l.status === "processing") resumeWatch(l.id); }); }   // notes still being written (after a reload, say) are checked in the background
    if (needLec) { const r = await api.getLecture(b); S.detail[b] = r.detail; const i = S.lectures.findIndex(x => x.id === b); if (i < 0) S.lectures.unshift(r.lecture); else S.lectures[i] = r.lecture; }
    /* Processing with notes already there: slides added later are being matched to them (the notes stay readable). */
    if (a === "lecture") { const l = lecture(b); if (l && l.status === "processing") { if (S.detail[b]) watchSlides(b); else resumeWatch(b); } }
    if (needSh) S.shared[b] = await api.getShared(b);
    if (needPack) { S.pack[b] = await api.getReviewPack(b); if (S.pack[b]!.status === "processing") watchPack(b); }   // still being made (after a reload, say)
    /* Review: every card not known yet, from the server, on each visit (cards known on a lecture page meanwhile drop out). */
    if (needRev) { rv.fresh = true; const r = await api.getReview(); rv.fresh = false; Object.assign(rv, { cards: r.cards, i: 0, flip: false, known: 0, total: r.cards.length }); S.reviewCount = r.cards.length; }   // fresh until it loads: "Try again" after a failure asks again
    if (needPlans) S.plans = await api.getPlans().catch(() => ({ plans: [], current: null }));   // Settings still opens when the plans endpoint is not there yet
    if (changed && a === "lecture" && S.detail[b] && S.detail[b]!.progress) state.known = new Set(S.detail[b]!.progress!.known || []);
    if (hit && S.detail[b]) { state.found = findPoint(S.detail[b]!, hit); state.goFound = !!state.found; }
  } catch (e) { S.error = (e as Error).message || String(e); }
  if (seq === routeSeq) { view.loader = null; bump(); }
}
