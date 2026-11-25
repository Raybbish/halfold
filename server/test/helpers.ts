/* A whole server on a temp folder, with the speech-to-text service, the notes model, Catch me up and (unless asked)
   ffmpeg replaced by stubs. Stub audio is text: a file starting with FAKEAUDIO is audio; "FAKEAUDIO:15" lines give its
   length (a live chunk), otherwise it is StubMedia.duration seconds long. A cut of live audio is a small JSON file
   {"window": [from, to]}, and StubStt answers it with the words of its script that fall in that window. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadConfig, type Config } from "../src/config";
import { Store } from "../src/db";
import { LocalFileStore } from "../src/files";
import type { CutOptions, Media, MediaInfo, SpeechOptions } from "../src/media";
import { Pipeline } from "../src/pipeline";
import { createApp } from "../src/app";
import { LiveTranscriber } from "../src/live/transcriber";
import type { CatchUpCall, CatchUpInput, CatchUpWriter } from "../src/notes/catchup";
import type { Transcriber, Transcript, Word } from "../src/stt/types";
import type { NotesCall, NotesInput, NotesWriter, Repair, TokenUsage } from "../src/notes/types";
import type { SlidesInput } from "../src/notes/slides";
import type { PackInput } from "../src/notes/pack";
import { ReviewPacks } from "../src/packs";
import { Billing } from "../src/billing";
import type { Mail, Mailer } from "../src/mail";
import { verifySignature, type CheckoutInfo, type CheckoutRequest, type PaymentEvent, type Payments, type SubscriptionInfo } from "../src/pay/stripe";
import { LinkError, type LinkDownloader, type LinkFailure } from "../src/links/ytdlp";
import { createHmac } from "node:crypto";

export const FAKE_AUDIO = "FAKEAUDIO";   // files starting with this are "audio" to the stub media
/* One piece of a stub live recording, `seconds` long. */
export const fakeChunk = (seconds = 15) => `${FAKE_AUDIO}:${seconds}\n`;

const fakeLength = (text: string) => { let n = 0, any = false; for (const m of text.matchAll(/FAKEAUDIO:(\d+(?:\.\d+)?)/g)) { n += Number(m[1]); any = true; } return any ? n : null; };

export class StubMedia implements Media {
  duration = 600;
  cuts: { from: number; to: number }[] = [];
  speech: { input: string; o?: SpeechOptions }[] = [];
  async probe(file: string): Promise<MediaInfo | null> {
    const text = fs.readFileSync(file).toString();
    if (!text.startsWith(FAKE_AUDIO)) return null;
    return { duration: fakeLength(text) ?? this.duration, hasAudio: true };
  }
  async toSpeechAudio(input: string, output: string, o?: SpeechOptions) { this.speech.push({ input, o }); fs.copyFileSync(input, output); }
  async cutSpeech(dir: string, parts: string[], output: string, o: CutOptions) {
    const text = parts.map(p => fs.readFileSync(path.join(dir, p)).toString()).join("");
    if (!text.startsWith(FAKE_AUDIO)) throw new Error("stub: the first piece is not audio");
    const total = fakeLength(text) ?? 0, to = Math.min(o.to ?? total, total), len = Math.max(0, to - o.from);
    this.cuts.push({ from: o.from, to: o.from + len });
    fs.writeFileSync(output, JSON.stringify({ window: [o.from, o.from + len] }));
    return len;
  }
}

export const WORDS: Word[] = [
  { text: "Good", start: 1, end: 1.3 }, { text: "morning.", start: 1.3, end: 4.2 },
  { text: "The", start: 18, end: 18.2 }, { text: "midterm", start: 18.2, end: 18.8 }, { text: "is", start: 18.8, end: 19 }, { text: "on", start: 19, end: 19.2 },
  { text: "November", start: 19.2, end: 19.8 }, { text: "26.", start: 19.8, end: 21.5 },
  { text: "機會", start: 250, end: 250.5 }, { text: "成本", start: 250.5, end: 251 }, { text: "opportunity", start: 251.2, end: 252 }, { text: "cost.", start: 252, end: 254 }
];

/* A class read out over a minute: what the live transcript hears, window by window. */
export const LIVE_WORDS: Word[] = [
  { text: "Good", start: 1, end: 1.4 }, { text: "afternoon.", start: 1.4, end: 4 },
  { text: "Today", start: 6, end: 6.5 }, { text: "we", start: 6.5, end: 6.7 }, { text: "cover", start: 6.7, end: 7.2 }, { text: "elasticity.", start: 7.2, end: 9 },
  { text: "The", start: 13, end: 13.3 }, { text: "midterm", start: 13.3, end: 14.2 }, { text: "is", start: 14.2, end: 14.6 },   // runs across the 15-second mark
  { text: "on", start: 14.6, end: 15.4 }, { text: "November", start: 15.4, end: 16 }, { text: "26.", start: 16, end: 18 },
  { text: "Elasticity", start: 22, end: 23 }, { text: "measures", start: 23, end: 23.6 }, { text: "how", start: 23.6, end: 23.9 }, { text: "much", start: 23.9, end: 24.3 },
  { text: "demand", start: 24.3, end: 25 }, { text: "responds", start: 25, end: 26 }, { text: "to", start: 26, end: 26.2 }, { text: "price.", start: 26.2, end: 28 },
  { text: "Problem", start: 33, end: 33.6 }, { text: "set", start: 33.6, end: 33.9 }, { text: "two", start: 33.9, end: 34.3 }, { text: "is", start: 34.3, end: 34.5 },
  { text: "due", start: 34.5, end: 34.9 }, { text: "next", start: 34.9, end: 35.3 }, { text: "Friday.", start: 35.3, end: 37 },
  { text: "That", start: 50, end: 50.4 }, { text: "is", start: 50.4, end: 50.6 }, { text: "all.", start: 50.6, end: 52 }
];

export class StubStt implements Transcriber {
  readonly provider = "stub-stt"; readonly model = "stub-1";
  calls = 0; gate: Promise<void> | null = null; error: Error | null = null;
  words: Word[] = WORDS;                       // the whole recording, in recording time
  windows: [number, number][] = [];            // live windows transcribed
  async transcribe(file: string): Promise<Transcript> {
    this.calls++;
    if (this.gate) await this.gate;
    if (this.error) throw this.error;
    let w: { window?: [number, number] } = {};
    try { w = JSON.parse(fs.readFileSync(file, "utf8")); } catch { /* a whole recording */ }
    if (w.window) {
      const [from, to] = w.window;
      this.windows.push([from, to]);
      /* What a real service does at the edge: a word cut off by the end of the window is heard only in part. */
      const words = this.words.filter(x => x.start >= from && x.start < to).map(x => ({ ...x, start: x.start - from, end: Math.min(x.end, to) - from, ...(x.end > to ? { text: x.text.slice(0, 2) } : {}) }));
      return { words, durationSec: to - from, detectedLanguage: "en", raw: { window: w.window } };
    }
    return { words: this.words, durationSec: 600, detectedLanguage: "en", raw: { stub: true } };
  }
  usd(seconds: number) { return seconds / 3600 * 0.2; }
}

export class StubCatchUp implements CatchUpWriter {
  readonly provider = "stub-catchup"; readonly model = "stub-flash";
  calls: CatchUpInput[] = [];
  replies: (string[] | Error)[] = [];
  usage: TokenUsage = { inputTokens: 1200, cachedInputTokens: 0, outputTokens: 80, reasoningTokens: 0 };
  async sumUp(input: CatchUpInput): Promise<CatchUpCall> {
    this.calls.push(input);
    const next = this.replies.length ? this.replies.shift()! : ["Elasticity measures how much demand responds to price.", "Problem set two is due next Friday."];
    if (next instanceof Error) throw Object.assign(next, { usage: this.usage, startedAt: new Date() });
    return { points: next, usage: this.usage, startedAt: new Date() };
  }
  usd(u: TokenUsage) { return { usd: (u.inputTokens * 0.3 + u.outputTokens * 1.2) / 1e6, meta: { peak: true } }; }
}

/* A reply as the notes model would write it, for a 600-second lecture. */
export function goodNotes(withSlides = false) {
  return {
    sections: [
      { title: "Admin", start: 0, end: 200, points: [{ t: 18, text: "The midterm is on 26 November.", zhHans: "期中考试在十一月二十六日。", zhHant: "期中考試在十一月二十六日。", slide: withSlides ? 1 : null, off: true }] },
      { title: "Opportunity cost", start: 200, end: 600, points: [{ t: 252, text: "Opportunity cost is the next best thing you give up.", zhHans: "机会成本是你放弃的次佳选择。", zhHant: "機會成本是你放棄的次佳選擇。", slide: withSlides ? 2 : null, off: false }] }
    ],
    slides: withSlides ? [{ n: 1, title: "Course admin" }, { n: 2, title: "Opportunity cost" }] : [],
    alerts: [{ t: 18, kind: "midterm", text: "Midterm on 26 November, chapters 1 to 5.", date: "2099-11-26" }],
    flashcards: [{ q: "What is opportunity cost?", a: "The next best alternative given up." }],
    quiz: [{ q: "Opportunity cost is...", opts: ["the price", "the next best alternative", "a sunk cost", "a tax"], a: 1, why: "It is what you give up.", t: 252 }]
  };
}

/* The model placing the points of notes under slides sent later: point n goes on slide n (or the last one); even
   points are "off". */
export function goodFiling(input: SlidesInput) {
  const last = input.slides[input.slides.length - 1]?.n ?? 1;
  return {
    slides: input.slides.map(p => ({ n: p.n, title: "Page " + p.n })),
    points: input.sections.flatMap(s => s.points).map(p => ({ id: p.id, slide: Math.min(p.id, last), off: p.id % 2 === 0 }))
  };
}
/* A review pack as the model would write it: one topic per lecture with all its points, and one exam question. */
export function goodPack(input: PackInput) {
  return {
    sheet: input.lectures.map(l => ({ topic: "Topic of " + l.title, points: l.sections.flatMap(s => s.points.map(p => p.id)) })),
    exam: [{ q: "Which is the opportunity cost?", opts: ["The price", "The next best alternative", "A sunk cost", "A tax"], a: 1, why: "It is what you give up.", lecture: 1, t: 252 }]
  };
}

export class StubNotes implements NotesWriter {
  readonly provider = "stub-notes"; readonly model = "stub-notes-1";
  calls: { input: NotesInput; repair?: Repair }[] = [];
  replies: (string | Error)[] = [];
  /* Phase 3: slides sent after the notes, and review packs. A gate holds the call until it is opened. */
  slideCalls: { input: SlidesInput; repair?: Repair }[] = [];
  slideReplies: (string | Error)[] = [];
  packCalls: { input: PackInput; repair?: Repair }[] = [];
  packReplies: (string | Error)[] = [];
  gate: Promise<void> | null = null;
  usage: TokenUsage = { inputTokens: 30000, cachedInputTokens: 0, outputTokens: 12000, reasoningTokens: 4000 };
  async write(input: NotesInput, _signal?: AbortSignal, repair?: Repair): Promise<NotesCall> {
    this.calls.push({ input, repair });
    return this.answer(this.replies, () => goodNotes(input.slides.length > 0));
  }
  async fileSlides(input: SlidesInput, _signal?: AbortSignal, repair?: Repair): Promise<NotesCall> {
    this.slideCalls.push({ input, repair });
    return this.answer(this.slideReplies, () => goodFiling(input));
  }
  async reviewPack(input: PackInput, _signal?: AbortSignal, repair?: Repair): Promise<NotesCall> {
    this.packCalls.push({ input, repair });
    return this.answer(this.packReplies, () => goodPack(input));
  }
  private async answer(queue: (string | Error)[], good: () => unknown): Promise<NotesCall> {
    if (this.gate) await this.gate;
    const next = queue.length ? queue.shift()! : JSON.stringify(good());
    if (next instanceof Error) throw Object.assign(next, { usage: this.usage, startedAt: new Date() });
    return { text: next, usage: this.usage, startedAt: new Date() };
  }
  usd(u: TokenUsage) { return { usd: (u.inputTokens * 1.32 + u.outputTokens * 3.96) / 1e6, meta: { peak: true } }; }
}

/* Video links: yt-dlp replaced. Each download writes stub audio into the folder, unless `next` says to fail with a
   reason, to write something else, or to hold until released (or aborted, when the lecture is deleted). */
export class StubLinks implements LinkDownloader {
  calls: { url: string; maxBytes: number }[] = [];
  next: { fail?: LinkFailure; content?: string; hold?: boolean } = {};
  private releaseHeld: (() => void) | null = null;
  async download(url: string, dir: string, o: { maxBytes: number; signal?: AbortSignal }) {
    this.calls.push({ url, maxBytes: o.maxBytes });
    const n = this.next;
    if (n.hold) await new Promise<void>((ok, bad) => { this.releaseHeld = ok; o.signal?.addEventListener("abort", () => bad(o.signal!.reason), { once: true }); });
    if (n.fail) throw new LinkError(n.fail, "stub download failed");
    const file = path.join(dir, "media.mp4");
    fs.writeFileSync(file, n.content ?? FAKE_AUDIO + "-from-a-link");
    return file;
  }
  release() { this.releaseHeld?.(); }
}

/* The emails the server sent (the sign-in codes). */
export class StubMailer implements Mailer {
  readonly provider = "stub-mail";
  sent: Mail[] = []; error: Error | null = null;
  async send(m: Mail) { if (this.error) throw this.error; this.sent.push(m); }
  /* The code in the last email to an address. */
  code(to: string) { const m = [...this.sent].reverse().find(x => x.to === to); return m ? /\b(\d{6})\b/.exec(m.subject)![1] : null; }
}

/* Stripe without Stripe: Checkouts and subscriptions kept in memory, changed by the test (pay, setSubscription), and
   webhook events signed with the same scheme as Stripe's (signed). */
export class StubPayments implements Payments {
  readonly webhookSecret = "whsec_stub";
  requests: CheckoutRequest[] = []; portals: { customer: string; returnUrl: string }[] = []; fetched: string[] = [];
  checkouts = new Map<string, CheckoutInfo>(); subs = new Map<string, SubscriptionInfo>();
  error: Error | null = null;
  private n = { checkout: 0, sub: 0, event: 0 };
  async createCheckout(r: CheckoutRequest) {
    if (this.error) throw this.error;
    this.requests.push(r);
    const id = `cs_test_${++this.n.checkout}`;
    this.checkouts.set(id, { id, status: "open", paymentStatus: "unpaid", mode: r.mode, subscription: null, customer: r.customer ?? null, metadata: { ...r.metadata } });
    return { id, url: `https://checkout.stripe.test/${id}` };
  }
  async checkout(id: string) {
    this.fetched.push(id);
    if (this.error) throw this.error;
    const c = this.checkouts.get(id); if (!c) throw new Error("no such checkout: " + id);
    return { ...c };
  }
  expired: string[] = [];
  async expireCheckout(id: string) {
    if (this.error) throw this.error;
    const c = this.checkouts.get(id); if (!c) throw new Error("no such checkout: " + id);
    if (c.status !== "open") throw new Error(`Only Checkout Sessions with a status in ["open"] can be expired.`);
    c.status = "expired"; this.expired.push(id);
  }
  async subscription(id: string) {
    if (this.error) throw this.error;
    const s = this.subs.get(id); if (!s) throw new Error("no such subscription: " + id);
    return { ...s };
  }
  async billingPortal(customer: string, returnUrl: string) { if (this.error) throw this.error; this.portals.push({ customer, returnUrl }); return `https://billing.stripe.test/${customer}`; }
  event(payload: string, signature: string | undefined, at = new Date()): PaymentEvent {
    verifySignature(payload, signature, this.webhookSecret, at);
    const e = JSON.parse(payload); return { id: e.id, type: e.type, object: e.data.object };
  }
  /* The student pays for a Checkout: a pass is paid; a monthly plan makes a subscription, active for 30 days. */
  pay(id: string, o: { paymentStatus?: string; periodEnd?: Date } = {}) {
    const c = this.checkouts.get(id)!;
    c.status = "complete"; c.paymentStatus = o.paymentStatus ?? "paid";
    if (c.mode === "subscription") {
      const n = ++this.n.sub, sub = `sub_${n}`, customer = c.customer ?? `cus_${n}`;
      this.subs.set(sub, { id: sub, customer, status: "active", periodEnd: (o.periodEnd ?? new Date(Date.now() + 30 * 86400_000)).toISOString(), cancelAtEnd: false, endedAt: null, metadata: { ...c.metadata } });
      c.subscription = sub; c.customer = customer;
    }
    return c;
  }
  setSubscription(id: string, change: Partial<SubscriptionInfo>) { Object.assign(this.subs.get(id)!, change); }
  /* A webhook request body and its Stripe-Signature header. */
  signed(type: string, object: unknown, at = new Date(), secret = this.webhookSecret) {
    const payload = JSON.stringify({ id: `evt_${++this.n.event}`, type, data: { object } }), t = Math.floor(at.getTime() / 1000);
    return { payload, signature: `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${payload}`).digest("hex")}` };
  }
}

export interface TestServer {
  dir: string; config: Config; store: Store; files: LocalFileStore; media: StubMedia | Media; stt: StubStt; notes: StubNotes; pipeline: Pipeline;
  live: LiveTranscriber; catchUp: StubCatchUp; packs: ReviewPacks; billing: Billing; mailer: StubMailer; payments: StubPayments;
  links: StubLinks;
  app: ReturnType<typeof createApp>;
  call(method: string, p: string, o?: { token?: string; json?: unknown; body?: FormData | string | Uint8Array; headers?: Record<string, string> }): Promise<{ status: number; body: any; text: string }>;
  /* A sign-in token for an invite code's account, made directly (the sign-in endpoints have their own tests: login.test.ts). */
  signIn(code?: string, name?: string): Promise<string>;
  close(): void;
}

/* The free plan as phases 1 to 3 behaved: 240 live minutes a day, no other limit, recordings kept for good. The tests of
   those phases run on it; the tests of plans (billing.test.ts) use plans.json as committed (realPlans). */
export function openPlans(p: Config["plans"]) { Object.assign(p.plans[0], { dailyLiveMinutes: 240, lecturesPerMonth: null, packsPerMonth: null, audioDays: null }); }

/* plans: changes to the plans for this test. payments: false = no Stripe key. links: false = no yt-dlp on the machine. */
export function setup(o: { env?: Record<string, string>; media?: Media; slides?: (f: string) => Promise<{ n: number; text: string }[]>;
  realPlans?: boolean; plans?: (p: Config["plans"]) => void; payments?: boolean; links?: boolean } = {}): TestServer {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sidenote-test-"));
  const config = loadConfig({ DATA_DIR: dir, WEB_DIR: "", ...o.env });
  if (!o.realPlans) openPlans(config.plans);
  if (o.plans) o.plans(config.plans);
  const store = new Store(path.join(dir, "test.db"));
  store.addInviteCode("CODE-A", "Ann"); store.addInviteCode("CODE-B", "Ben");
  const files = new LocalFileStore(dir), media = o.media || new StubMedia(), stt = new StubStt(), notes = new StubNotes();
  const slides = o.slides || (async () => [{ n: 1, text: "Course admin\nMidterm" }, { n: 2, text: "Opportunity cost\nThe value of the next best alternative" }]);
  const links = new StubLinks(), linksOn = o.links !== false;
  const pipeline = new Pipeline({ config, store, files, media, stt, notes, slides, links: linksOn ? links : null });
  const live = new LiveTranscriber({ config, store, files, media, stt }), catchUp = new StubCatchUp(), packs = new ReviewPacks({ config, store, notes });
  const payments = new StubPayments(), mailer = new StubMailer();
  const billing = new Billing({ config, store, payments: o.payments === false ? null : payments });
  const app = createApp({ config, store, files, media, jobs: pipeline, live, catchUp, packs, billing, mailer, links: linksOn ? links : null });
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
    dir, config, store, files, media, stt, notes, pipeline, live, catchUp, packs, billing, mailer, payments, links, app, call,
    async signIn(code = "CODE-A", name = "") {
      const u = store.userByCode(code); if (!u) throw new Error("no invite code " + code);
      if (name) store.setUserName(u.id, name);
      return store.createSession(u.id);
    },
    close() { pipeline.stopAll(); live.stopAll(); packs.stopAll(); store.close(); fs.rmSync(dir, { recursive: true, force: true }); }
  };
}

export function fileForm(content: string | Uint8Array, filename: string, field = "file") {
  const f = new FormData(); f.append(field, new Blob([content]), filename); return f;
}

/* A fake recording that is a different file each time, as two students' recordings of a class are: the same file
   would reuse the transcript of the first (dedupe.ts). dedupe.test.ts passes the same bytes on purpose. */
let recordings = 0;
export const anotherRecording = () => `${FAKE_AUDIO}-bytes-${++recordings}`;

/* Creates a course and an upload lecture, uploads a fake recording (and slides), and returns the lecture id. */
export async function uploadedLecture(s: TestServer, token: string, o: { slides?: boolean; language?: string; title?: string; autoTitle?: boolean; bytes?: string } = {}) {
  const course = (await s.call("POST", "/courses", { token, json: { code: "ECON 1001", name: "Microeconomics" } })).body;
  const lec = (await s.call("POST", "/lectures", { token, json: { courseId: course.id, title: o.title ?? "Week 9", language: o.language || "en-yue", source: "upload", ...(o.autoTitle !== undefined ? { autoTitle: o.autoTitle } : {}) } })).body;
  const up = await s.call("POST", `/lectures/${lec.id}/recording`, { token, body: fileForm(o.bytes ?? anotherRecording(), "lecture.mp3") });
  if (up.status !== 204) throw new Error("upload failed: " + up.text);
  if (o.slides) { const sl = await s.call("POST", `/lectures/${lec.id}/slides`, { token, body: fileForm("%PDF-1.4 fake", "slides.pdf") }); if (sl.status !== 204) throw new Error("slides failed: " + sl.text); }
  return lec.id as string;
}

export const tempFiles = (s: TestServer) => fs.readdirSync(path.join(s.dir, "tmp"));

/* A piece of a live recording as the front end sends it (api.ts uploadChunk: form1("audio", blob, {seq})): the audio
   first, then seq. */
export function chunkForm(content: string | Uint8Array, seq: number | string, type = "audio/webm;codecs=opus") {
  const f = new FormData(); f.append("audio", new Blob([content], { type })); f.append("seq", String(seq)); return f;
}

/* Creates a course and a live lecture (record or tab), and returns its id. */
export async function liveLecture(s: TestServer, token: string, o: { source?: "record" | "tab"; language?: string } = {}) {
  const course = (await s.call("POST", "/courses", { token, json: { code: "ECON 1001", name: "Microeconomics" } })).body;
  const r = await s.call("POST", "/lectures", { token, json: { courseId: course.id, title: "Week 10", language: o.language || "en", source: o.source || "record" } });
  if (r.status !== 200) throw new Error("create failed: " + r.text);
  return r.body.id as string;
}

/* Creates a course and a link lecture, sends the link, and returns the lecture id. */
export async function linkLecture(s: TestServer, token: string, url = "https://www.youtube.com/watch?v=lecture9") {
  const course = (await s.call("POST", "/courses", { token, json: { code: "ECON 1001", name: "Microeconomics" } })).body;
  const r = await s.call("POST", "/lectures", { token, json: { courseId: course.id, title: "Week 9 replay", language: "en", source: "link" } });
  if (r.status !== 200) throw new Error("create failed: " + r.text);
  const sent = await s.call("POST", `/lectures/${r.body.id}/link`, { token, json: { url } });
  if (sent.status !== 204) throw new Error("link failed: " + sent.text);
  return r.body.id as string;
}

/* A lecture with notes (status ready): an upload in the given course, or in a new course ECON 1001. */
export async function readyLecture(s: TestServer, token: string, o: { courseId?: string; title?: string; slides?: boolean } = {}) {
  const courseId = o.courseId ?? (await s.call("POST", "/courses", { token, json: { code: "ECON 1001", name: "Microeconomics" } })).body.id;
  const lec = (await s.call("POST", "/lectures", { token, json: { courseId, title: o.title || "Week 9", language: "en-yue", source: "upload" } })).body;
  const up = await s.call("POST", `/lectures/${lec.id}/recording`, { token, body: fileForm(anotherRecording(), "lecture.mp3") });
  if (up.status !== 204) throw new Error("upload failed: " + up.text);
  if (o.slides) await s.call("POST", `/lectures/${lec.id}/slides`, { token, body: fileForm("%PDF-1.4 fake", "slides.pdf") });
  await s.call("POST", `/lectures/${lec.id}/finish`, { token, json: { duration: 600 } });
  await s.pipeline.idle();
  if (s.store.lecture(lec.id)!.status !== "ready") throw new Error("the notes were not written: " + s.store.lecture(lec.id)!.error);
  return lec.id as string;
}
