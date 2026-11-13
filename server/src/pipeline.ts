/* Recording -> notes, for lectures in status "processing". Runs in this process with a small queue. Each step keeps
   its result (audio.m4a, the transcript), so a retry after a failure only redoes what failed: a second transcription
   would be paid for twice. Deleting a lecture aborts its run, and a run never writes notes for a lecture that is gone. */
import path from "node:path";
import fsp from "node:fs/promises";
import type { Config } from "./config";
import type { Store, LectureRow } from "./db";
import type { FileStore } from "./files";
import type { Media } from "./media";
import type { Jobs } from "./routes";
import type { Transcriber } from "./stt/types";
import { wordsToLines } from "./stt/lines";
import type { NotesInput, NotesWriter, TokenUsage } from "./notes/types";
import { buildDetail, parseModelNotes } from "./notes/normalize";
import { DetailSchema } from "./shapes";
import { readSlides } from "./slides";
import { promptDate } from "./time";

export interface PipelineDeps {
  config: Config; store: Store; files: FileStore; media: Media; stt: Transcriber; notes: NotesWriter;
  slides?: (file: string) => Promise<{ n: number; text: string }[]>;
}

const AUDIO = "audio.m4a";
const NOTES_ATTEMPTS = 2;
class Gone extends Error {}

export class Pipeline implements Jobs {
  private queue: string[] = [];
  private running = new Map<string, AbortController>();
  private waiters: (() => void)[] = [];
  constructor(private readonly d: PipelineDeps) {}

  enqueue(id: string) { if (!this.running.has(id) && !this.queue.includes(id)) { this.queue.push(id); this.pump(); } }
  cancel(id: string) { this.queue = this.queue.filter(x => x !== id); this.running.get(id)?.abort(); }
  /* After a restart: lectures left in "processing" are queued again. */
  resume() { for (const l of this.d.store.lecturesWithStatus("processing")) this.enqueue(l.id); }
  /* Resolves when nothing is queued or running (tests, shutdown). */
  idle() { return this.running.size || this.queue.length ? new Promise<void>(r => this.waiters.push(r)) : Promise.resolve(); }
  stopAll() { this.queue = []; for (const c of this.running.values()) c.abort(); }

  private pump() {
    while (this.running.size < this.d.config.pipelineConcurrency && this.queue.length) {
      const id = this.queue.shift()!, ctl = new AbortController();
      this.running.set(id, ctl);
      this.run(id, ctl.signal).finally(() => {
        this.running.delete(id); this.pump();
        if (!this.running.size && !this.queue.length) this.waiters.splice(0).forEach(w => w());
      });
    }
  }

  private async run(id: string, signal: AbortSignal) {
    const { store } = this.d;
    try {
      const l = store.lecture(id);
      if (!l || l.status !== "processing") return;
      await this.process(l, signal);
    } catch (e) {
      if (signal.aborted || e instanceof Gone || !store.lecture(id)) return;
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[pipeline] ${id} failed: ${msg}`);
      store.setFailed(id, msg);
    }
  }

  private check(id: string, signal: AbortSignal) { if (signal.aborted || !this.d.store.lecture(id)) throw new Gone(); }

  private async process(l: LectureRow, signal: AbortSignal) {
    const { store, files, media, stt, config } = this.d, id = l.id;
    if (!l.recording_file) throw new Error("no recording");

    /* 1. One seekable speech file from whatever was uploaded. Written to a temp path first: a half-made file never counts. */
    if (!files.exists(id, AUDIO)) {
      const tmp = files.tempPath() + ".m4a";
      try { await media.toSpeechAudio(files.path(id, l.recording_file), tmp, signal); this.check(id, signal); await files.commit(tmp, id, AUDIO); }
      finally { await files.discard(tmp); }
    }
    const audio = files.path(id, AUDIO);
    const info = await media.probe(audio);
    if (!info || !info.hasAudio || info.duration <= 0) throw new Error("the converted audio could not be read");
    store.setDuration(id, info.duration);
    this.check(id, signal);

    /* 2. Transcript, kept so that a retry does not pay for it again. */
    let lines = store.transcript(id);
    if (!lines) {
      const bytes = (await fsp.stat(audio)).size;
      const t = await stt.transcribe(audio, l.language, signal);
      const seconds = t.durationSec ?? info.duration;
      /* Logged before checking for a deletion: the transcription is paid for either way. */
      store.logCost({ lectureId: id, userId: l.user_id, stage: "stt", provider: stt.provider, model: stt.model, audioSeconds: seconds, usd: stt.usd(seconds, l.language),
        meta: { language: l.language, detectedLanguage: t.detectedLanguage, words: t.words.length, audioBytes: bytes, audioBytesPerHour: Math.round(bytes / seconds * 3600) } });
      this.check(id, signal);
      await fsp.writeFile(path.join(path.dirname(audio), `transcript.${stt.provider}.json`), JSON.stringify(t.raw));
      lines = wordsToLines(t.words);
      if (!lines.length) throw new Error("no speech was recognised in the recording");
      store.saveTranscript(id, stt.provider, stt.model, lines);
    }

    /* 3. Slide text. */
    const slidePages = l.has_slides && files.exists(id, "slides.pdf") ? await (this.d.slides || readSlides)(files.path(id, "slides.pdf")) : [];
    this.check(id, signal);

    /* 4. Notes. A reply that cannot be used is shown back to the model once to be corrected. */
    const course = store.course(l.user_id, l.course_id);
    const zh = config.zhExplanations ? (l.language === "en-zh" ? "hans" : "hant") : null;
    const input: NotesInput = {
      courseCode: course?.code || "", courseName: course?.name || "", title: l.title, date: promptDate(new Date(l.created_at), config.timezone),
      language: l.language, duration: info.duration, lines, slides: slidePages, zh
    };
    let detailOut: ReturnType<typeof buildDetail> | null = null, repair: { reply: string; problem: string } | undefined, problem = "";
    for (let attempt = 1; attempt <= NOTES_ATTEMPTS && !detailOut; attempt++) {
      const call = await this.callNotes(l, input, attempt, slidePages.length, signal, repair);
      this.check(id, signal);
      try {
        const out = buildDetail(parseModelNotes(call.text), { duration: info.duration, lines, slidePages, zh });
        const checked = DetailSchema.safeParse(out.detail);
        if (!checked.success) throw new Error("the notes break these rules: " + checked.error.issues.slice(0, 8).map(i => `${i.path.join(".")}: ${i.message}`).join("; "));
        detailOut = out;
      } catch (e) {
        problem = (e as Error).message;
        repair = { reply: call.text, problem };
        console.warn(`[pipeline] ${id} notes attempt ${attempt} unusable: ${problem}`);
      }
    }
    if (!detailOut) throw new Error("the notes model did not write usable notes: " + problem);

    /* 5. Save; does nothing if the lecture was deleted meanwhile. */
    this.check(id, signal);
    store.saveNotes(id, detailOut.detail, detailOut.dated);
  }

  /* One model call, logged in the cost table whether or not its reply turns out usable. */
  private async callNotes(l: LectureRow, input: NotesInput, attempt: number, slidePages: number, signal: AbortSignal, repair?: { reply: string; problem: string }) {
    const { notes, store } = this.d;
    const log = (usage: TokenUsage, at: Date, ok: boolean) => {
      const price = notes.usd(usage, at);
      store.logCost({ lectureId: l.id, userId: l.user_id, stage: "notes", provider: notes.provider, model: notes.model, inputTokens: usage.inputTokens,
        cachedInputTokens: usage.cachedInputTokens, outputTokens: usage.outputTokens, reasoningTokens: usage.reasoningTokens, usd: price.usd,
        meta: { ...price.meta, attempt, completed: ok, audioSeconds: input.duration, slidePages, zh: input.zh, transcriptLines: input.lines.length } });
    };
    try {
      const call = await notes.write(input, signal, repair);
      log(call.usage, call.startedAt, true);
      return call;
    } catch (e) {
      const u = (e as { usage?: TokenUsage; startedAt?: Date }).usage;
      if (u) log(u, (e as { startedAt?: Date }).startedAt || new Date(), false);
      throw e;
    }
  }
}
