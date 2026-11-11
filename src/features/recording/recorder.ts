/* ---------- recording ----------
   live = what the recording screen shows; rec = the recorder's moving parts. */
import type { Alert, Line } from "../../types";

export const live = { id: null as string | null, courseCode: "", sec: 0, acc: 0, paused: false, held: false, segs: [] as Line[], alert: null as Alert | null, recap: null as string[] | null, recapBusy: false, mic: "off" as "off" | "on" | "lost" | "none", micNote: "", netNote: "", active: false, offline: false };
export const rec = { full: null as MediaStream | null, stream: null as MediaStream | null, mr: null as MediaRecorder | null, seq: 0, wake: null as WakeLockSentinel | null, ctx: null as AudioContext | null, an: null as AnalyserNode | null, tick: null as ReturnType<typeof setInterval> | null, feed: null as ReturnType<typeof setInterval> | null, lvl: null as ReturnType<typeof setInterval> | null, last: 0, beat: 0, stopped: null as Promise<unknown> | null, hiddenAt: 0 };
