/* A whole server on a temp folder, with the speech-to-text service, the notes model and (unless asked) ffmpeg replaced by stubs. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadConfig, type Config } from "../src/config";
import { Store } from "../src/db";
import { LocalFileStore } from "../src/files";
import type { Media, MediaInfo } from "../src/media";
import { Pipeline } from "../src/pipeline";
import { createApp } from "../src/app";
import type { Transcriber, Transcript, Word } from "../src/stt/types";
import type { NotesCall, NotesInput, NotesWriter, TokenUsage } from "../src/notes/types";

export const FAKE_AUDIO = "FAKEAUDIO";   // files starting with this are "audio" to the stub media

export class StubMedia implements Media {
  duration = 600;
  async probe(file: string): Promise<MediaInfo | null> {
    const head = fs.readFileSync(file).subarray(0, FAKE_AUDIO.length).toString();
    return head === FAKE_AUDIO ? { duration: this.duration, hasAudio: true } : null;
  }
  async toSpeechAudio(input: string, output: string) { fs.copyFileSync(input, output); }
}

export const WORDS: Word[] = [
  { text: "Good", start: 1, end: 1.3 }, { text: "morning.", start: 1.3, end: 4.2 },
  { text: "The", start: 18, end: 18.2 }, { text: "midterm", start: 18.2, end: 18.8 }, { text: "is", start: 18.8, end: 19 }, { text: "on", start: 19, end: 19.2 },
  { text: "November", start: 19.2, end: 19.8 }, { text: "26.", start: 19.8, end: 21.5 },
  { text: "機會", start: 250, end: 250.5 }, { text: "成本", start: 250.5, end: 251 }, { text: "opportunity", start: 251.2, end: 252 }, { text: "cost.", start: 252, end: 254 }
];

export class StubStt implements Transcriber {
  readonly provider = "stub-stt"; readonly model = "stub-1";
  calls = 0; gate: Promise<void> | null = null; error: Error | null = null;
  async transcribe(): Promise<Transcript> {
    this.calls++;
    if (this.gate) await this.gate;
    if (this.error) throw this.error;
    return { words: WORDS, durationSec: 600, detectedLanguage: "en", raw: { stub: true } };
  }
  usd(seconds: number) { return seconds / 3600 * 0.2; }
}

/* A reply as the notes model would write it, for a 600-second lecture. */
export function goodNotes(withSlides = false) {
  return {
    sections: [
      { title: "Admin", start: 0, end: 200, points: [{ t: 18, text: "The midterm is on 26 November.", zh: "期中考試在十一月二十六日。", slide: withSlides ? 1 : null, off: true }] },
      { title: "Opportunity cost", start: 200, end: 600, points: [{ t: 252, text: "Opportunity cost is the next best thing you give up.", zh: "機會成本是你放棄的次佳選擇。", slide: withSlides ? 2 : null, off: false }] }
    ],
    slides: withSlides ? [{ n: 1, title: "Course admin" }, { n: 2, title: "Opportunity cost" }] : [],
    alerts: [{ t: 18, kind: "midterm", text: "Midterm on 26 November, chapters 1 to 5.", date: "2099-11-26" }],
    flashcards: [{ q: "What is opportunity cost?", a: "The next best alternative given up." }],
    quiz: [{ q: "Opportunity cost is...", opts: ["the price", "the next best alternative", "a sunk cost", "a tax"], a: 1, why: "It is what you give up.", t: 252 }]
  };
}

export class StubNotes implements NotesWriter {
  readonly provider = "stub-notes"; readonly model = "stub-notes-1";
  calls: { input: NotesInput; repair?: { reply: string; problem: string } }[] = [];
  replies: (string | Error)[] = [];
  usage: TokenUsage = { inputTokens: 30000, cachedInputTokens: 0, outputTokens: 12000, reasoningTokens: 4000 };
  async write(input: NotesInput, _signal?: AbortSignal, repair?: { reply: string; problem: string }): Promise<NotesCall> {
    this.calls.push({ input, repair });
    const next = this.replies.length ? this.replies.shift()! : JSON.stringify(goodNotes(input.slides.length > 0));
    if (next instanceof Error) throw next;
    return { text: next, usage: this.usage, startedAt: new Date() };
  }
  usd(u: TokenUsage) { return { usd: (u.inputTokens * 1.32 + u.outputTokens * 3.96) / 1e6, meta: { peak: true } }; }
}

export interface TestServer {
  dir: string; config: Config; store: Store; files: LocalFileStore; media: StubMedia | Media; stt: StubStt; notes: StubNotes; pipeline: Pipeline;
  app: ReturnType<typeof createApp>;
  call(method: string, p: string, o?: { token?: string; json?: unknown; body?: FormData | string | Uint8Array; headers?: Record<string, string> }): Promise<{ status: number; body: any; text: string }>;
  signIn(code?: string, name?: string): Promise<string>;
  close(): void;
}

export function setup(o: { env?: Record<string, string>; media?: Media; slides?: (f: string) => Promise<{ n: number; text: string }[]> } = {}): TestServer {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sidenote-test-"));
  const config = loadConfig({ DATA_DIR: dir, WEB_DIR: "", ...o.env });
  const store = new Store(path.join(dir, "test.db"));
  store.addInviteCode("CODE-A", "Ann"); store.addInviteCode("CODE-B", "Ben");
  const files = new LocalFileStore(dir), media = o.media || new StubMedia(), stt = new StubStt(), notes = new StubNotes();
  const slides = o.slides || (async () => [{ n: 1, text: "Course admin\nMidterm" }, { n: 2, text: "Opportunity cost\nThe value of the next best alternative" }]);
  const pipeline = new Pipeline({ config, store, files, media, stt, notes, slides });
  const app = createApp({ config, store, files, media, jobs: pipeline });
  const call: TestServer["call"] = async (method, p, c = {}) => {
    const headers: Record<string, string> = { ...(c.headers || {}) };
    if (c.token) headers.Authorization = "Bearer " + c.token;
    let body = c.body;
    if (c.json !== undefined) { headers["Content-Type"] = "application/json"; body = JSON.stringify(c.json); }
    const r = await app.request("/api" + p, { method, headers, body });
    const text = await r.text();
    let parsed: any = null; try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
    return { status: r.status, body: parsed, text };
  };
  return {
    dir, config, store, files, media, stt, notes, pipeline, app, call,
    async signIn(code = "CODE-A", name = "") { const r = await call("POST", "/session", { json: { inviteCode: code, name } }); return r.body.token; },
    close() { pipeline.stopAll(); store.close(); fs.rmSync(dir, { recursive: true, force: true }); }
  };
}

export function fileForm(content: string | Uint8Array, filename: string, field = "file") {
  const f = new FormData(); f.append(field, new Blob([content]), filename); return f;
}

/* Creates a course and an upload lecture, uploads a fake recording (and slides), and returns the lecture id. */
export async function uploadedLecture(s: TestServer, token: string, o: { slides?: boolean; language?: string } = {}) {
  const course = (await s.call("POST", "/courses", { token, json: { code: "ECON 1001", name: "Microeconomics" } })).body;
  const lec = (await s.call("POST", "/lectures", { token, json: { courseId: course.id, title: "Week 9", language: o.language || "en-yue", source: "upload" } })).body;
  const up = await s.call("POST", `/lectures/${lec.id}/recording`, { token, body: fileForm(FAKE_AUDIO + "-bytes", "lecture.mp3") });
  if (up.status !== 204) throw new Error("upload failed: " + up.text);
  if (o.slides) { const sl = await s.call("POST", `/lectures/${lec.id}/slides`, { token, body: fileForm("%PDF-1.4 fake", "slides.pdf") }); if (sl.status !== 204) throw new Error("slides failed: " + sl.text); }
  return lec.id as string;
}

export const tempFiles = (s: TestServer) => fs.readdirSync(path.join(s.dir, "tmp"));
