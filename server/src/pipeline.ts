/* Recording -> notes, for lectures in status "processing". Runs in this process with a small queue. Each step keeps
   its result (audio.m4a, the transcript), so a retry after a failure only redoes what failed: a second transcription
   would be paid for twice. Deleting a lecture aborts its run, and a run never writes notes for a lecture that is gone. */
import fs from "node:fs";
import path from "node:path";
import fsp from "node:fs/promises";
import { pipeline as pump } from "node:stream/promises";
import type { Config } from "./config";
import { liveGaps, type Store, type LectureRow } from "./db";
import type { FileStore } from "./files";
import type { Media } from "./media";
import type { Jobs } from "./routes";
import type { Transcriber, Word } from "./stt/types";
import { wordsToLines } from "./stt/lines";
import { heldWords } from "./live/transcriber";
import { cutWindow, dropRepeat, shift } from "./live/windows";
import type { Detail, Line } from "../../src/types";
import type { NotesCall, NotesInput, NotesWriter, Repair, TokenUsage } from "./notes/types";
import { buildDetail, parseModelNotes } from "./notes/normalize";
import { fileUnder, readFiling, slidesInput } from "./notes/slides";
import { cantoneseTraditional } from "./notes/zh";
import { DetailSchema } from "./shapes";
import { readSlides } from "./slides";
import { promptDate } from "./time";
import { LinkError, STUDENT_MESSAGE, type LinkDownloader } from "./links/ytdlp";

export interface PipelineDeps {
  config: Config; store: Store; files: FileStore; media: Media; stt: Transcriber; notes: NotesWriter;
  slides?: (file: string) => Promise<{ n: number; text: string }[]>;
  links?: LinkDownloader | null;
}

const AUDIO = "audio.m4a";
export const isLive = (l: Pick<LectureRow, "source">) => l.source === "record" || l.source === "tab";
const NOTES_ATTEMPTS = 2;
const MAX_LINK_SECONDS = 5 * 3600;
const MIN_SPAN = 0.5;   // a stretch of a live recording shorter than this is not sent to be transcribed
class Gone extends Error {}

/* A Cantonese class reads in Traditional characters, as students in Hong Kong write. */
const traditionalForCantonese = (l: LectureRow, lines: Line[], detected?: string) =>
  l.language === "en-yue" || (l.language === "auto" && detected === "yue") ? lines.map(x => ({ ...x, text: cantoneseTraditional(x.text) })) : lines;

/* Two lanes. A link lecture whose file is not here yet is downloaded first, at most LINK_CONCURRENCY at a time, and
   queued again for the rest once the file is in: a slow download (up to LINK_DOWNLOAD_MINUTES) never holds up the notes
   of other lectures, which have PIPELINE_CONCURRENCY runs of their own. */
export class Pipeline implements Jobs {
  private queue: string[] = [];
  private running = new Map<string, AbortController>();    // both lanes
  private downloading = new Set<string>();                  // the ones in `running` that are downloading their link
  private waiters: (() => void)[] = [];
  constructor(private readonly d: PipelineDeps) {}

  enqueue(id: string) { if (!this.running.has(id) && !this.queue.includes(id)) { this.queue.push(id); this.pump(); } }
  cancel(id: string) { this.queue = this.queue.filter(x => x !== id); this.running.get(id)?.abort(); }
  /* After a restart: lectures left in "processing" are queued again. */
  resume() { for (const l of this.d.store.lecturesWithStatus("processing")) this.enqueue(l.id); }
  /* Resolves when nothing is queued or running (tests, shutdown). */
  idle() { return this.running.size || this.queue.length ? new Promise<void>(r => this.waiters.push(r)) : Promise.resolve(); }
  stopAll() { this.queue = []; for (const c of this.running.values()) c.abort(); }

  private needsDownload(id: string) {
    const l = this.d.store.lecture(id);
    return !!l && l.status === "processing" && !l.refile && l.source === "link" && !l.recording_file;
  }

  private pump() {
    for (let i = 0; i < this.queue.length;) {
      const id = this.queue[i], download = this.needsDownload(id);
      const full = download ? this.downloading.size >= this.d.config.links.concurrency
        : this.running.size - this.downloading.size >= this.d.config.pipelineConcurrency;
      if (full) { i++; continue; }
      this.queue.splice(i, 1);
      const ctl = new AbortController();
      this.running.set(id, ctl);
      if (download) this.downloading.add(id);
      (download ? this.download(id, ctl.signal) : this.run(id, ctl.signal).then(() => false)).then(next => {
        this.running.delete(id); this.downloading.delete(id);
        if (next) this.queue.push(id);
        this.pump();
        if (!this.running.size && !this.queue.length) this.waiters.splice(0).forEach(w => w());
      });
    }
  }

  /* The download lane: true when the file is in and the lecture goes on to the other lane. */
  private async download(id: string, signal: AbortSignal) {
    try {
      const l = this.d.store.lecture(id);
      if (!l || l.status !== "processing") return false;
      await this.fetchLink(l, signal);
      return true;
    } catch (e) {
      if (!signal.aborted && !(e instanceof Gone) && this.d.store.lecture(id)) this.failed(id, e);
      return false;
    }
  }

  private failed(id: string, e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[pipeline] ${id} failed: ${msg}`);
    /* A link that could not be used: the student is told why (lecture.error), since trying again may not help. */
    this.d.store.setFailed(id, msg, e instanceof LinkError ? STUDENT_MESSAGE[e.kind] : null);
  }

  private async run(id: string, signal: AbortSignal) {
    const { store } = this.d;
    let refile = false;
    try {
      const l = store.lecture(id);
      if (!l || l.status !== "processing") return;
      refile = !!l.refile;
      if (refile) await this.refile(l, signal); else await this.process(l, signal);
    } catch (e) {
      if (signal.aborted || e instanceof Gone || !store.lecture(id)) return;
      const msg = e instanceof Error ? e.message : String(e);
      if (refile) {
        /* API-CHANGES.md section 3: not "failed", which would hide the notes. Ready again, notes as they were, no slides. */
        console.error(`[pipeline] ${id} slides could not be added: ${msg}`);
        store.refileFailed(id, msg);
        await this.d.files.remove(id, "slides.pdf");
        return;
      }
      this.failed(id, e);
    }
  }

  private check(id: string, signal: AbortSignal) { if (signal.aborted || !this.d.store.lecture(id)) throw new Gone(); }

  private async process(l: LectureRow, signal: AbortSignal) {
    const { store, files, media, stt, config } = this.d, id = l.id;
    /* 0. A live recording: the pieces the browser sent, joined in order into one file. */
    if (!l.recording_file && isLive(l)) { await this.assemble(l, signal); l = store.lecture(id) ?? (() => { throw new Gone(); })(); }
    /* 0. A video link: the file behind it. Kept once downloaded, so a retry after a later step failed does not download again. */
    if (!l.recording_file && l.source === "link") { await this.fetchLink(l, signal); l = store.lecture(id) ?? (() => { throw new Gone(); })(); }
    if (!l.recording_file) throw new Error("no recording");

    /* 1. One seekable speech file from whatever was uploaded. Written to a temp path first: a half-made file never counts. */
    if (!files.exists(id, AUDIO)) {
      const tmp = files.tempPath() + ".m4a";
      try { await media.toSpeechAudio(files.path(id, l.recording_file), tmp, { signal, fillGaps: isLive(l) }); this.check(id, signal); await files.commit(tmp, id, AUDIO); }
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
      lines = isLive(l) ? await this.transcribeLive(l, audio, info.duration, signal) : await this.transcribeWhole(l, audio, info.duration, signal);
      if (!lines.length) throw new Error("no speech was recognised in the recording");
      store.saveTranscript(id, stt.provider, stt.model, lines);
    }

    /* 3. Slide text. */
    let slidePages: { n: number; text: string }[] = [];
    if (l.has_slides && files.exists(id, "slides.pdf")) {
      /* Slides that cannot be read (password, damaged file) are left out rather than failing the lecture. */
      try { slidePages = await (this.d.slides || readSlides)(files.path(id, "slides.pdf")); }
      catch (e) { console.warn(`[pipeline] ${id} slides could not be read, writing the notes without them: ${(e as Error).message}`); }
    }
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

  /* An upload or a video link: the whole recording in one request. */
  private async transcribeWhole(l: LectureRow, audio: string, duration: number, signal: AbortSignal): Promise<Line[]> {
    const { store, stt } = this.d, id = l.id;
    const bytes = (await fsp.stat(audio)).size;
    const t = await stt.transcribe(audio, l.language, signal);
    const seconds = t.durationSec ?? duration;
    /* Logged before checking for a deletion: the transcription is paid for either way. */
    store.logCost({ lectureId: id, userId: l.user_id, stage: "stt", provider: stt.provider, model: stt.model, audioSeconds: seconds, usd: stt.usd(seconds, l.language),
      meta: { language: l.language, detectedLanguage: t.detectedLanguage, words: t.words.length, audioBytes: bytes, audioBytesPerHour: Math.round(bytes / seconds * 3600) } });
    this.check(id, signal);
    await fsp.writeFile(path.join(path.dirname(audio), `transcript.${stt.provider}.json`), JSON.stringify(t.raw));
    return traditionalForCantonese(l, wordsToLines(t.words), t.detectedLanguage);
  }

  /* A live recording is transcribed once (DESIGN.md, 现场录只转写一次): the notes are written from the lines the live
     rounds kept, and only what no round reached is transcribed now: the stretches skipped after an outage, then the
     audio from where the last round stopped to the end (all of it when there was no live transcript), joined to the
     sentence held back at the end of that round. */
  private async transcribeLive(l: LectureRow, audio: string, duration: number, signal: AbortSignal): Promise<Line[]> {
    const { store, files, media, stt } = this.d, id = l.id;
    const held = heldWords(l.live_held), tail: [number, number] = [l.live_from, duration];
    const spans = [...liveGaps(l.live_gaps), tail].filter(([from, to]) => to - from >= MIN_SPAN);
    const words: Word[] = [], raw: unknown[] = [];
    let detected: string | undefined;
    for (const span of spans) {
      const [from, to] = span, tmp = files.tempPath() + ".m4a";
      try {
        const len = await media.cutSpeech(path.dirname(audio), [AUDIO], tmp, { from, to, signal });
        if (len <= 0) continue;
        const t = await stt.transcribe(tmp, l.language, signal);
        /* Logged before checking for a deletion: the transcription is paid for either way. */
        store.logCost({ lectureId: id, userId: l.user_id, stage: "stt", provider: stt.provider, model: stt.model, audioSeconds: len, usd: stt.usd(len, l.language),
          meta: { language: l.language, detectedLanguage: t.detectedLanguage, words: t.words.length, from, to: from + len, recordingSeconds: duration, live: true } });
        this.check(id, signal);
        detected ??= t.detectedLanguage;
        raw.push({ from, to: from + len, reply: t.raw });
        const got = cutWindow(shift(t.words, from), from, from + len, true).keep;
        words.push(...(span === tail ? dropRepeat(got, held[held.length - 1]) : got));
      } finally { await files.discard(tmp); }
    }
    if (raw.length) await fsp.writeFile(path.join(path.dirname(audio), `transcript.${stt.provider}.json`), JSON.stringify(raw));
    const added = traditionalForCantonese(l, wordsToLines([...held, ...words]), detected);
    return [...store.liveLines(id), ...added].sort((a, b) => a.t - b.t);
  }

  /* Slides sent after the notes were written (API-CHANGES.md section 3): each point the lecturer said is placed under
     its slide and marked off or not. The notes are not written again: text, order, the student's edits and own points
     stay (notes/slides.ts). Edits wait (409) while this runs, so the notes read here are still the notes saved after. */
  private async refile(l: LectureRow, signal: AbortSignal) {
    const { store, files } = this.d, id = l.id;
    const detail = store.detail(id);
    if (!detail) throw new Error("the lecture has no notes");
    let pages: { n: number; text: string }[];
    try { pages = await (this.d.slides || readSlides)(files.path(id, "slides.pdf")); }
    catch (e) { throw new Error("the slides could not be read: " + (e as Error).message); }
    if (!pages.some(p => p.text)) throw new Error("the slides have no text to match (scanned pages, or an empty file)");
    this.check(id, signal);
    const course = store.course(l.user_id, l.course_id);
    const { input, where } = slidesInput(detail, { courseCode: course?.code || "", title: l.title }, pages);
    /* Only the student's own points: nothing to ask the model. */
    let out: Detail | null = where.size ? null : fileUnder(detail, pages, { slides: [], points: new Map() }, where);
    let repair: Repair | undefined, problem = "";
    for (let attempt = 1; attempt <= NOTES_ATTEMPTS && !out; attempt++) {
      const call = await this.callModel(l, "slides", { attempt, slidePages: pages.length, points: where.size }, () => this.d.notes.fileSlides(input, signal, repair));
      this.check(id, signal);
      try {
        const next = fileUnder(detail, pages, readFiling(call.text, where.size), where);
        const checked = DetailSchema.safeParse(next);
        if (!checked.success) throw new Error("the notes break these rules: " + checked.error.issues.slice(0, 8).map(i => `${i.path.join(".")}: ${i.message}`).join("; "));
        out = next;
      } catch (e) {
        problem = (e as Error).message;
        repair = { reply: call.text, problem };
        console.warn(`[pipeline] ${id} slides attempt ${attempt} unusable: ${problem}`);
      }
    }
    if (!out) throw new Error("the notes model did not place the points under the slides: " + problem);
    this.check(id, signal);
    store.saveRefiled(id, out);
  }

  /* Joins the chunks of a live recording in the order they were recorded (seq) into the file "recording", then drops the
     chunks. A chunk that never arrived leaves a gap that ffmpeg fills with silence (toSpeechAudio fillGaps), so the
     rest keeps its time. Without the first chunk (it carries the header) nothing can be read. */
  private async assemble(l: LectureRow, signal: AbortSignal) {
    const { store, files } = this.d, id = l.id, seqs = store.chunkSeqs(id);
    if (seqs[0] !== 0) throw new Error(seqs.length ? "the first piece of the live recording never arrived" : "no audio was received");
    const missing = seqs[seqs.length - 1] + 1 - seqs.length;
    if (missing) console.warn(`[pipeline] ${id}: ${missing} piece(s) of the live recording never arrived; they become silence`);
    const tmp = files.tempPath(), out = fs.createWriteStream(tmp);
    try {
      for (const seq of seqs) {
        this.check(id, signal);
        await pump(fs.createReadStream(path.join(files.chunkDir(id), files.chunkName(seq))), out, { end: false });
      }
      await new Promise<void>((ok, bad) => { out.once("error", bad); out.end(() => ok()); });
      this.check(id, signal);
      await files.commit(tmp, id, "recording");
      store.setRecording(id, "recording");
    } finally { out.destroy(); await files.discard(tmp); }
    await files.removeChunks(id);
  }

  /* Downloads the link into a folder of its own and stores the file as "recording", as if it had been uploaded. The
     length is checked again here: yt-dlp only knows it beforehand for some sites. */
  private async fetchLink(l: LectureRow, signal: AbortSignal) {
    const { store, files, media, config, links } = this.d, id = l.id;
    if (!links) throw new Error("yt-dlp is not available on this server");
    if (!l.link) throw new Error("the lecture has no link");
    const dir = files.tempPath();
    await fsp.mkdir(dir);
    try {
      const file = await links.download(l.link, dir, { maxBytes: config.maxUploadBytes, signal });
      this.check(id, signal);
      const info = await media.probe(file);
      if (!info || !info.hasAudio) throw new LinkError("no-media", "the downloaded file has no audio");
      if (info.duration > MAX_LINK_SECONDS) throw new LinkError("too-long", `the downloaded file is ${Math.round(info.duration)} seconds long`);
      await files.commit(file, id, "recording");
      /* Deleted between the check and the move: the move recreated the lecture's folder. */
      if (!store.lecture(id)) { await files.removeLecture(id); throw new Gone(); }
      store.setRecording(id, "recording");
    } finally { await fsp.rm(dir, { recursive: true, force: true }); }
  }

  private callNotes(l: LectureRow, input: NotesInput, attempt: number, slidePages: number, signal: AbortSignal, repair?: Repair) {
    return this.callModel(l, "notes", { attempt, audioSeconds: input.duration, slidePages, zh: input.zh, transcriptLines: input.lines.length },
      () => this.d.notes.write(input, signal, repair));
  }

  /* One model call, logged in the cost table whether or not its reply turns out usable. */
  private async callModel(l: LectureRow, stage: "notes" | "slides", meta: Record<string, unknown>, ask: () => Promise<NotesCall>) {
    const { notes, store } = this.d;
    const log = (usage: TokenUsage, at: Date, ok: boolean) => {
      const price = notes.usd(usage, at);
      store.logCost({ lectureId: l.id, userId: l.user_id, stage, provider: notes.provider, model: notes.model, inputTokens: usage.inputTokens,
        cachedInputTokens: usage.cachedInputTokens, outputTokens: usage.outputTokens, reasoningTokens: usage.reasoningTokens, usd: price.usd,
        meta: { ...price.meta, ...meta, completed: ok } });
    };
    try {
      const call = await ask();
      log(call.usage, call.startedAt, true);
      return call;
    } catch (e) {
      const u = (e as { usage?: TokenUsage; startedAt?: Date }).usage;
      if (u) log(u, (e as { startedAt?: Date }).startedAt || new Date(), false);
      throw e;
    }
  }
}
