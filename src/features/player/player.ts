/* ---------- recording playback ----------
   Recordings are kept, so a lecture whose detail has audio.url gets a player, and every timestamp seeks it.
   The audio object lives outside the page markup: switching tabs or redrawing never touches it, only a route
   change stops it (route() calls plStop()). Playback progress does not go through React either: plTick() moves
   #pCur, #pBar, the timeline head and the highlighted transcript line directly, several times a second. */
import { CONFIG } from "../../config";
import { api } from "../../api/api";
import { fmt } from "../../lib/helpers";
import { bump } from "../../lib/bus";
import { R, cur, state } from "../../state/app";
import { toast } from "../../state/overlay";
import { trs } from "../../i18n";
import type { Line } from "../../types";

/* The two player-button icons. Strings, because plPaint() swaps them in without a redraw. */
export const ICON_PLAY = `<svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4.5v15l12.5-7.5z" fill="currentColor"/></svg>`;
export const ICON_PAUSE = `<svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M6.5 4.5h4v15h-4zM13.5 4.5h4v15h-4z" fill="currentColor"/></svg>`;

type Handler = ((ev?: unknown) => unknown) | null;
/* Sample build only: a silent stand-in with the same controls as an audio element, so the player can be tried without a backend. */
export interface SilentClock {
  currentTime: number; duration: number; paused: boolean; playbackRate: number; readyState: number; timer: ReturnType<typeof setInterval> | null;
  play(): undefined; pause(): void;
  ontimeupdate?: Handler; onplay?: Handler; onpause?: Handler; onended?: Handler; onerror?: Handler; onloadedmetadata?: Handler;
}
type Media = HTMLAudioElement | SilentClock;

export const pl = { a: null as Media | null, id: null as string | null, url: null as string | null, rate: 1, drag: false, err: false, retried: false, pending: null as number | null, told: false };
export const RATES = [1, 1.25, 1.5, 2];
export const hasAudio = () => !!(cur && cur.d && cur.d.audio && !cur.d.audio.expired && (cur.d.audio.url || CONFIG.USE_MOCK) && (!cur.shared || CONFIG.SHARE_AUDIO));
export const plDur = () => (cur && cur.l.duration) || (pl.a && isFinite(pl.a.duration) && pl.a.duration) || 1;
export const segAt = (t: number) => { let r: Line | null = null; for (const s of cur!.d!.transcript) { if (s.t <= t) r = s; else break; } return r; };   // the line being spoken at t
const onScreen = (el: Element) => { const r = el.getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight; };
const $ = <T extends Element = HTMLElement>(s: string) => document.querySelector<T>(s);

export function silentClock(duration: number | undefined): SilentClock {
  const c: SilentClock = { currentTime: 0, duration: duration || 1, paused: true, playbackRate: 1, readyState: 4, timer: null,
    play() { if (!c.paused) return; c.paused = false; let last = performance.now();
      c.timer = setInterval(() => { const now = performance.now(); c.currentTime = Math.min(c.duration, c.currentTime + (now - last) / 1000 * c.playbackRate); last = now;
        if (c.currentTime >= c.duration) c.pause(); if (c.ontimeupdate) c.ontimeupdate(); }, 250);
      if (c.onplay) c.onplay(); },
    pause() { if (c.paused) return; c.paused = true; clearInterval(c.timer!); if (c.onpause) c.onpause(); } };
  return c;
}
export function plLoad() {
  const id = R.a + ":" + R.b, url = cur!.d!.audio!.url || null;
  if (pl.a && pl.id === id && pl.url === url) return;
  plStop();
  const a: Media = url ? new Audio() : silentClock(cur!.l.duration);
  Object.assign(pl, { a, id, url, err: false, retried: false, pending: null });
  a.ontimeupdate = plTick; a.onplay = a.onpause = a.onended = plPaint;
  a.onloadedmetadata = () => { if (pl.a === a && pl.pending != null) { a.currentTime = pl.pending; pl.pending = null; } };
  a.onerror = () => plFail(a);
  if (url) { (a as HTMLAudioElement).preload = "metadata"; (a as HTMLAudioElement).src = url; }
  a.playbackRate = pl.rate;
  if (state.pos) plSeek(state.pos);
}
export function plStop() {
  const a = pl.a; if (!a) return;
  try { a.pause(); } catch (e) {}
  a.ontimeupdate = a.onplay = a.onpause = a.onended = a.onerror = a.onloadedmetadata = null;
  if (pl.url) { (a as HTMLAudioElement).removeAttribute("src"); try { (a as HTMLAudioElement).load(); } catch (e) {} }
  Object.assign(pl, { a: null, id: null, url: null, pending: null, drag: false });
}
export function plSeek(t: number) {
  const a = pl.a; if (!a) return;
  t = Math.max(0, Math.min(t, plDur()));
  if (pl.url && a.readyState < 1) pl.pending = t; else { try { a.currentTime = t; } catch (e) { pl.pending = t; } }
  plTick(t);
}
export function plTick(at?: unknown) {   // moves the bar, the timeline head and the highlighted transcript line without redrawing the page
  const a = pl.a; if (!a || !cur || !cur.d) return;
  const t = typeof at === "number" ? at : pl.pending != null ? pl.pending : a.currentTime || 0, pct = Math.min(100, t / plDur() * 100);
  state.pos = t;
  const c = $("#pCur"), b = $<HTMLInputElement>("#pBar"), h = $(".tl .head");
  if (!pl.drag) { if (c) c.textContent = fmt(t); if (b) { b.value = String(t); b.style.setProperty("--p", pct + "%"); } }
  if (h) h.style.left = pct + "%";
  document.querySelectorAll(".tl .seg").forEach((el, i) => { const s = cur!.d!.sections[i]; el.classList.toggle("on", !!s && t >= s.start && t < s.end); });
  if (state.tab !== "transcript") return;
  const seg = segAt(t); if (!seg || seg.t === state.hit) return;
  const old = document.getElementById("seg-" + state.hit), el = document.getElementById("seg-" + seg.t), follow = !a.paused && (!old || onScreen(old));   // follow only while the reader is following
  if (old) old.classList.remove("hit");
  state.hit = seg.t;
  if (el) { el.classList.add("hit"); if (follow) el.scrollIntoView({ block: "center", behavior: "smooth" }); }
}
export function plPaint() {
  const p = $("#pPlay"), r = $("#pRate"), paused = !pl.a || pl.a.paused;
  if (p) { p.innerHTML = paused ? ICON_PLAY : ICON_PAUSE; const lab = paused ? "Play recording" : "Pause recording"; p.setAttribute("aria-label", trs(lab)); }
  if (r) r.textContent = pl.rate + "×";
}
export function plToggle() {
  const a = pl.a; if (!a || pl.err) return;
  if (!a.paused) return a.pause();
  const p = a.play(); if (p && p.catch) p.catch(() => {});
  if (!pl.url && !pl.told) { pl.told = true; toast("Sample build: playback is simulated, so there is no sound."); }
  plMedia();
}
export function plSkip(d: number) { if (pl.a) plSeek(state.pos + d); }
export function plRate() { pl.rate = RATES[(RATES.indexOf(pl.rate) + 1) % RATES.length]; if (pl.a) pl.a.playbackRate = pl.rate; plPaint(); }
export function plDrag(el: HTMLInputElement) { pl.drag = true; const v = +el.value, c = $("#pCur"); el.style.setProperty("--p", v / plDur() * 100 + "%"); if (c) c.textContent = fmt(v); }
export function plDrop(el: HTMLInputElement) { pl.drag = false; plSeek(+el.value); const line = state.tab === "transcript" && document.getElementById("seg-" + state.hit); if (line) line.scrollIntoView({ block: "center", behavior: "smooth" }); }
async function plFail(a: Media) {
  if (pl.a !== a || pl.err) return;
  const at = state.pos, was = !a.paused;
  if (!pl.retried) { pl.retried = true;   // a signed link may have expired: ask for a fresh one once
    try { const r = cur!.shared ? await api.getShared(R.b) : await api.getLecture(R.b), u = r && r.detail && r.detail.audio && r.detail.audio.url;
      if (pl.a !== a) return;
      if (u) { cur!.d!.audio = r.detail!.audio; pl.url = u; pl.pending = at; (a as HTMLAudioElement).src = u; if (was) { const p = a.play(); if (p && p.catch) p.catch(() => {}); } return; }
    } catch (e) { if (pl.a !== a) return; } }
  pl.err = true; bump(); toast("The recording could not be played.");
}
export function plRetry() { const at = state.pos; plStop(); pl.err = false; state.pos = at; bump(); }
function plMedia() {   // lock screen and headphone controls on phones
  try { const ms = navigator.mediaSession; if (!ms || !pl.url) return;
    ms.metadata = new MediaMetadata({ title: cur!.l.title, artist: (cur!.c && cur!.c.code) || "Sidenote", album: "Sidenote" });
    ms.setActionHandler("play", () => { if (pl.a && pl.a.paused) plToggle(); });
    ms.setActionHandler("pause", () => { if (pl.a && !pl.a.paused) plToggle(); });
    ms.setActionHandler("seekbackward", () => plSkip(-15)); ms.setActionHandler("seekforward", () => plSkip(15)); } catch (e) {}
}
