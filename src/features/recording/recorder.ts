/* ---------- recording ----------
   live = what the recording screen shows; rec = the recorder's moving parts.
   The clock and the level meter write to the page directly (.clk, #lvl), several times a second, without a redraw. */
import type { Alert, Lecture, Line, Source } from "../../types";
import { CONFIG } from "../../config";
import { api } from "../../api/api";
import { DATA } from "../../api/mock";
import { fmt, mins, wait } from "../../lib/helpers";
import { idb } from "../../lib/idb";
import { bump } from "../../lib/bus";
import { R, S, course, lecture } from "../../state/app";
import { store } from "../../lib/store";
import { toast } from "../../state/overlay";
import { outbox, dropped, flush, applyChunk } from "./outbox";
import { mark } from "./orphan";
import { tabStream } from "./tabAudio";

export const live = { id: null as string | null, courseCode: "", title: "", courseId: "", savedTitle: "", savedCourse: "", sec: 0, acc: 0, paused: false, held: false, segs: [] as Line[], alert: null as Alert | null, recap: null as string[] | null, recapBusy: false, mic: "off" as "off" | "on" | "lost" | "none", micNote: "", netNote: "", active: false, offline: false };
export const rec = { full: null as MediaStream | null, stream: null as MediaStream | null, mr: null as MediaRecorder | null, seq: 0, wake: null as WakeLockSentinel | null, ctx: null as AudioContext | null, an: null as AnalyserNode | null, tick: null as ReturnType<typeof setInterval> | null, feed: null as ReturnType<typeof setInterval> | null, lvl: null as ReturnType<typeof setInterval> | null, last: 0, beat: 0, stopped: null as Promise<unknown> | null, hiddenAt: 0 };
export const IOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

export async function keepAwake() { try { rec.wake = await navigator.wakeLock.request("screen"); } catch (e) {} }
export function micLost() { if (!live.active || live.mic !== "on") return; live.mic = "lost"; live.micNote = "The microphone stopped. End the recording to keep what you have so far."; if (R.a === "live") bump(); else toast(live.micNote); }
export async function beginRecording(lec: Lecture, courseCode: string, source: Source) {
  Object.assign(live, { id: lec.id, courseCode, title: "", courseId: lec.course, savedTitle: "", savedCourse: lec.course, sec: 0, acc: 0, paused: false, held: false, segs: [], alert: null, recap: null, mic: "off", micNote: "", netNote: "", offline: false, active: true }); rec.seq = 0;
  try {
    if (!navigator.mediaDevices || !window.MediaRecorder) throw Object.assign(new Error(), { name: "NotSupportedError" });
    rec.stream = source === "tab" ? await tabStream() : await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: true } });
    const stream = rec.stream;
    try { rec.mr = new MediaRecorder(stream, { audioBitsPerSecond: CONFIG.AUDIO_KBPS * 1000 }); } catch (e) { rec.mr = new MediaRecorder(stream); }
    const mr = rec.mr;
    mr.ondataavailable = e => { if (e.data && e.data.size && !dropped.has(lec.id)) { const c = { key: lec.id + ":" + String(rec.seq).padStart(6, "0"), id: lec.id, seq: rec.seq++, blob: e.data, sec: live.sec, code: courseCode }; outbox.push(c); idb.put(c); flush(); } };
    rec.stopped = new Promise(done => { mr.onstop = done; });   // fires after the last piece of audio has been handed over
    mr.onerror = micLost; if (source !== "tab") stream.getAudioTracks().forEach(t => { t.onended = micLost; });   // a shared tab ends the recording itself, see tabStream()
    mr.start(CONFIG.CHUNK_SECONDS * 1000); live.mic = "on";
    try { const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext; const ctx = rec.ctx = new AC(), an = rec.an = ctx.createAnalyser(); an.fftSize = 512; ctx.createMediaStreamSource(stream).connect(an);
      const buf = new Uint8Array(an.fftSize); rec.lvl = setInterval(() => { an.getByteTimeDomainData(buf); let s = 0; for (const v of buf) s += (v - 128) * (v - 128); const el = document.getElementById("lvl"); if (el) el.style.width = Math.min(100, Math.sqrt(s / buf.length) * 6) + "%"; }, 120); } catch (e) {}
    await keepAwake();
  } catch (e) {
    const name = (e as Error).name;
    live.mic = "none";
    live.micNote = source === "tab" ? (name === "NoAudioError" ? "No sound was shared. Start again, choose a browser tab and turn on the option to share tab audio." : name === "NotSupportedError" ? "This browser cannot record a tab. Use Chrome or Edge on a computer." : "Nothing was shared, so there is no sound to record.") : name === "NotAllowedError" ? "Microphone access was blocked. Allow it in the browser's site settings, then start again." : name === "NotFoundError" ? "No microphone was found on this device." : "This browser cannot record here.";
    if (!CONFIG.USE_MOCK) { live.active = false; live.id = null; api.deleteLecture(lec.id).catch(() => {}); throw new Error(live.micNote); }
  }
  /* The clock adds up real elapsed time, so it stays right when the browser slows timers in a background tab.
     mark() runs every five seconds, paused or not: it is the heartbeat that tells other tabs this recording is alive. */
  mark(); rec.last = rec.beat = performance.now();
  rec.tick = setInterval(() => { const now = performance.now(), dt = (now - rec.last) / 1000; rec.last = now;
    if (now - rec.beat >= 5000) { rec.beat = now; mark(); }
    if (live.paused || live.held) return;
    live.acc += dt; const s = Math.floor(live.acc); if (s !== live.sec) { live.sec = s; document.querySelectorAll(".clk").forEach(el => el.textContent = fmt(s)); } }, 250);
  /* Sample build only: feed the sample transcript so the screen has content. */
  if (CONFIG.USE_MOCK) rec.feed = setInterval(() => { if (live.paused) return; const s = DATA.detail.transcript[DATA.feed]; if (!s) return; DATA.feed++; applyChunk({ segments: [s], alerts: DATA.detail.alerts.filter(a => a.t === s.t) }, lec.id); }, 3000);
}
/* Phones. The screen lock is released whenever the page is hidden, so it is asked for again on return. iOS also stops
   the microphone while Halfnote is in the background: the clock waits, and the student is told how much was missed.
   Registered once, in main.tsx. */
export function onVisibilityChange() {
  if (!live.active) return;
  if (document.hidden) { rec.hiddenAt = Date.now(); if (IOS) live.held = true; return; }
  keepAwake();
  if (!live.held) return;
  live.held = false; rec.last = performance.now();
  if (rec.stream && rec.stream.getAudioTracks().some(t => t.readyState === "ended")) return micLost();
  const gap = Math.round((Date.now() - rec.hiddenAt) / 1000);
  if (gap >= 3 && live.mic === "on") { live.micNote = "Recording stopped for about " + (gap < 90 ? gap + " seconds" : mins(gap)) + " while Halfnote was in the background. Keep this page open with the screen on."; if (R.a === "live") bump(); else toast(live.micNote); }
}
/* The title box and the course list on the recording page. Only what changed is sent; an empty title box sends nothing, so the dated default title stays. */
export function saveLiveMeta() {
  const id = live.id; if (!id) return;
  const p: { title?: string; course?: string } = {}, t0 = live.title.trim(), c = course(live.courseId);
  if (t0 && t0 !== live.savedTitle) p.title = t0;
  if (c && c.id !== live.savedCourse) { p.course = c.id; live.courseCode = c.code; store.set("lastCourse", c.id); bump(); }
  if (!Object.keys(p).length) return;
  if (p.title) live.savedTitle = p.title; if (p.course) live.savedCourse = p.course;
  api.updateLecture(id, p).then(() => { const l = lecture(id); if (l) Object.assign(l, p, p.title ? { autoTitle: false } : {}); S.homeLoaded = false; if (live.active && live.id === id) mark(); toast("Saved"); }).catch(e => toast((e as Error).message, { error: true }));   // the answer can come after End (endLive saves first): no mark for a recording that has ended
}
export function togglePause() { live.paused = !live.paused; try { if (rec.mr && rec.mr.state !== "inactive") live.paused ? rec.mr.pause() : rec.mr.resume(); } catch (e) {} bump(); }
export function stopRecording() {   // resolves once the recorder has handed over its last piece of audio
  const mr = rec.mr, running = mr && mr.state !== "inactive", done = running ? Promise.race([rec.stopped, wait(3000)]) : Promise.resolve();
  if (rec.stream) rec.stream.getAudioTracks().forEach(t => { t.onended = null; });
  try { if (running) mr!.stop(); } catch (e) {} if (rec.stream) rec.stream.getTracks().forEach(t => t.stop()); if (rec.full) rec.full.getTracks().forEach(t => t.stop());
  [rec.tick, rec.feed, rec.lvl].forEach(i => i && clearInterval(i)); try { rec.wake && rec.wake.release(); } catch (e) {} try { rec.ctx && rec.ctx.close(); } catch (e) {}
  Object.assign(rec, { full: null, stream: null, mr: null, wake: null, ctx: null, an: null, tick: null, feed: null, lvl: null });
  return done;
}
