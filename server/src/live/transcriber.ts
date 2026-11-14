/* The live transcript of a recording in progress. Each chunk the browser sends starts a round (kick): cut the audio from
   where the last round stopped to the end of what has arrived in order, transcribe it, keep the words that are complete
   (live/windows.ts), and store them as lines with any exam alerts. A lecture has one round at a time; a chunk that
   arrives during a round is covered by the next one. Rounds of all lectures together are limited (LIVE_CONCURRENCY).
   Everything a round needs is in the database and the chunk files, so a restart loses nothing: the next chunk starts
   a round from where the last one stopped.
   The notes are not written from these lines: after the lecture the whole recording is transcribed in one go
   (pipeline.ts), which is more accurate than 15-second windows (see DESIGN.md). */
import type { Config } from "../config";
import type { Store } from "../db";
import type { FileStore } from "../files";
import type { Media } from "../media";
import type { Transcriber } from "../stt/types";
import { wordsToLines } from "../stt/lines";
import { cantoneseTraditional } from "../notes/zh";
import { cutWindow, dropRepeat, holdUnfinished, MAX_WINDOW, MIN_WINDOW, shift } from "./windows";
import type { Word } from "../stt/types";
import { findAlerts } from "./alerts";

export interface LiveJobs {
  /* Resolves (never rejects) once a round has covered the audio received so far. */
  kick(lectureId: string): Promise<void>;
  /* Stops a round in progress and forgets the waiting ones (the lecture was finished or deleted). */
  stop(lectureId: string): void;
}

export interface LiveDeps { config: Config; store: Store; files: FileStore; media: Media; stt: Transcriber }

interface State { busy: boolean; pending: (() => void)[]; ctl: AbortController }

/* The unfinished sentence held back at the end of the last round. */
export function heldWords(json: string | null): Word[] {
  if (!json) return [];
  try { const w = JSON.parse(json); return Array.isArray(w) ? w as Word[] : []; } catch { return []; }
}

/* After a long outage of the speech-to-text service, only this much of the latest audio is transcribed: the live
   transcript skips the gap rather than sending an hour of audio in one round. The notes still cover all of it. */
const CATCH_UP_WINDOW = 30;

export class LiveTranscriber implements LiveJobs {
  private state = new Map<string, State>();
  private lastWord = new Map<string, Word>();   // the last word kept, per lecture (lost on a restart: then nothing is dropped)
  private active = 0;
  private slots: (() => void)[] = [];
  private idlers: (() => void)[] = [];
  constructor(private readonly d: LiveDeps) {}

  kick(id: string) {
    let s = this.state.get(id);
    if (!s) { s = { busy: false, pending: [], ctl: new AbortController() }; this.state.set(id, s); }
    const done = new Promise<void>(r => s!.pending.push(r));
    if (!s.busy) void this.loop(id, s);
    return done;
  }

  stop(id: string) {
    this.lastWord.delete(id);
    const s = this.state.get(id); if (!s) return;
    s.ctl.abort(); s.pending.splice(0).forEach(r => r());
  }

  /* Resolves when no round is running or waiting (tests, shutdown). */
  idle() { return this.state.size ? new Promise<void>(r => this.idlers.push(r)) : Promise.resolve(); }
  stopAll() { for (const id of [...this.state.keys()]) this.stop(id); }

  private async loop(id: string, s: State) {
    s.busy = true;
    while (s.pending.length && !s.ctl.signal.aborted) {
      const mine = s.pending.splice(0);
      await this.slot(() => this.round(id, s.ctl.signal));
      mine.forEach(r => r());
    }
    s.pending.splice(0).forEach(r => r());
    this.state.delete(id);
    if (!this.state.size) this.idlers.splice(0).forEach(r => r());
  }

  private async slot(fn: () => Promise<void>) {
    if (this.active >= this.d.config.live.concurrency) await new Promise<void>(r => this.slots.push(r));
    this.active++;
    try { await fn(); } finally { this.active--; this.slots.shift()?.(); }
  }

  private async round(id: string, signal: AbortSignal) {
    const { store, files, media, stt, config } = this.d;
    const l = store.lecture(id);
    if (!l || l.status !== "recording") return;
    /* Only the pieces that arrived in order: a piece cannot be read without the ones before it. */
    const seqs = store.chunkSeqs(id), parts: string[] = [];
    while (parts.length < seqs.length && seqs[parts.length] === parts.length) parts.push(files.chunkName(parts.length));
    if (!parts.length) return;
    const dir = files.chunkDir(id), tmp = files.tempPath() + ".m4a";
    try {
      if (!config.live.transcript) {
        /* No live transcript: only measure how much audio there is, for the daily limit, reading just the end. */
        const len = await media.cutSpeech(dir, parts, tmp, { from: l.live_audio, signal });
        store.setLiveAudio(id, l.live_audio + len);
        return;
      }
      let from = l.live_from, len = await media.cutSpeech(dir, parts, tmp, { from, signal });
      const end = from + len;
      store.setLiveAudio(id, end);
      if (len < MIN_WINDOW || signal.aborted) return;
      if (len > MAX_WINDOW) { from = end - CATCH_UP_WINDOW; len = await media.cutSpeech(dir, parts, tmp, { from, signal }); }
      const t = await stt.transcribe(tmp, l.language, signal);
      /* Logged before checking for a deletion: the audio was sent and is paid for. */
      store.logCost({ lectureId: id, userId: l.user_id, stage: "live", provider: stt.provider, model: stt.model, audioSeconds: len, usd: stt.usd(len, l.language),
        meta: { from, to: from + len, words: t.words.length } });
      if (signal.aborted) return;
      const cut = cutWindow(shift(t.words, from), from, from + len, false), keep = dropRepeat(cut.keep, this.lastWord.get(id));
      const { send, held } = holdUnfinished([...heldWords(l.live_held), ...keep], from + len);
      let lines = wordsToLines(send);
      if (l.language === "en-yue" || (l.language === "auto" && t.detectedLanguage === "yue")) lines = lines.map(x => ({ ...x, text: cantoneseTraditional(x.text) }));
      if (store.saveLiveRound(id, { from: l.live_from, next: cut.next, audioEnd: end, lines, alerts: findAlerts(lines, store.liveAlerts(id)), held }) && keep.length)
        this.lastWord.set(id, keep[keep.length - 1]);
    } catch (e) {
      /* The next chunk tries again with the same audio and more. */
      if (!signal.aborted && store.lecture(id)) console.warn(`[live] ${id} round failed: ${(e as Error).message}`);
    } finally { await files.discard(tmp); }
  }
}
