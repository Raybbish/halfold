/* The endpoints of phases 1 and 2 (reference/INTEGRATION.md section 2, API-CHANGES.md), and slides sent after the
   notes (phase 3). The rest of phase 3 is in library.ts; signing in in login.ts; settings, plans and payment (phase 4)
   in account.ts. Paths are under /api. */
import fsp from "node:fs/promises";
import { Hono } from "hono";
import type { Config } from "./config";
import { CLASS_LANGUAGES, type ClassLanguage } from "./config";
import type { CourseRow, LectureRow, Store, UserRow } from "./db";
import { randomId } from "./db";
import type { FileStore } from "./files";
import type { Media } from "./media";
import { fail, jsonBody } from "./http/errors";
import { receiveFile } from "./http/upload";
import { courseView, homeView, lectureView, liveMinutesToday, liveSecondsToday } from "./views";
import { AUDIO, audioView, linkIsValid, sendFile } from "./audio";
import { isLive } from "./pipeline";
import { heldWords, type LiveJobs } from "./live/transcriber";
import { joinTokens } from "./stt/lines";
import type { CatchUpWriter } from "./notes/catchup";
import type { ReviewPacks } from "./packs";
import type { Billing } from "./billing";
import type { Mailer } from "./mail";
import type { CatchUpReply, ChunkReply, Source, StatusReply } from "../../src/types";
import { linkProblem } from "./links/guard";
import type { LinkDownloader } from "./links/ytdlp";

export interface Jobs { enqueue(lectureId: string): void; cancel(lectureId: string): void }
/* links: yt-dlp, or null when it is not on this machine (link lectures are then refused). */
export interface Deps {
  config: Config; store: Store; files: FileStore; jobs: Jobs; media: Media; live: LiveJobs; catchUp: CatchUpWriter; packs: ReviewPacks;
  billing: Billing; mailer: Mailer; links: LinkDownloader | null;
}
export type AppEnv = { Variables: { user: UserRow } };

const SOURCES: Source[] = ["record", "tab", "upload", "link"];
const COLORS = ["#FF6B57", "#4C7DFF", "#2BB673", "#FFB020", "#9B5DE5", "#00B8D9", "#F15BB5", "#8D6E63"];
export const str = (v: unknown) => typeof v === "string" ? v.trim() : "";

/* A course's code and name, for adding and editing one (API-CHANGES.md section 1: the same limits). */
export function courseFields(b: Record<string, unknown>) {
  const code = str(b.code), name = str(b.name);
  if (!code) fail(400, "Enter the course code.");
  if (code.length > 20) fail(400, "The course code can be at most 20 characters.");
  if (name.length > 80) fail(400, "The course name can be at most 80 characters.");
  return { code, name };
}
export function newCourse(store: Store, userId: string, code: string, name: string): CourseRow {
  const slug = code.toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 20) || "course";
  let id = slug + "-" + randomId(4);
  while (store.courseExists(id)) id = slug + "-" + randomId(4);
  return store.createCourse(userId, id, code, name, COLORS[store.courses(userId).length % COLORS.length]);
}

/* The live limit (dailyLiveMinutes of the student's plan, plans.json). The front end only checks it before a recording starts, and has no way to show a
   message from a chunk reply's error: it would retry the chunk forever. So the student is told through the live alerts
   (shown on the recording screen), and once the minutes are used up the next chunks get 410, which makes the front end
   stop sending them; ending the recording then writes the notes from what was saved. */
const WARN_SECONDS = 5 * 60;
const LIMIT_REACHED = "Today's recording minutes are used up, so Halfold has stopped saving this recording. End it to get notes for what was saved.";
const limitSoon = (left: number) => `About ${Math.max(1, Math.round(left / 60))} recording minutes are left today. Halfold stops saving this recording when they run out; end it then to get notes for what was saved.`;
const NOTHING_YET = "Nothing has been said yet that Hal can sum up. Try again in a minute.";
const CATCH_UP_SECONDS = 5 * 60;

/* Waits for `p` at most `ms`, without keeping the process alive. */
async function waitAtMost(p: Promise<unknown>, ms: number) {
  let timer: NodeJS.Timeout | undefined;
  await Promise.race([p, new Promise<void>(r => { timer = setTimeout(r, ms); })]);
  clearTimeout(timer);
}

/* Public endpoints other than signing in (login.ts) and the shared page (library.ts). */
export function publicRoutes(deps: Deps) {
  const r = new Hono<AppEnv>();
  /* Playback. The <audio> element cannot send the token: the link carries a signature instead (audio.ts). */
  r.on(["GET", "HEAD"], "/lectures/:id/audio", async c => {
    const id = c.req.param("id");
    if (!linkIsValid(deps.store, id, c.req.query("exp"), c.req.query("sig"))) fail(403, "This link to the recording has expired. Open the lecture again.");
    const l = deps.store.lecture(id);
    if (!l || l.audio_expired || !deps.files.exists(id, AUDIO)) fail(404, "This recording is no longer kept.");
    const name = (l!.title.replace(/[\\/:*?"<>|\x00-\x1f]+/g, " ").trim() || "recording").slice(0, 80) + ".m4a";
    return sendFile(c.req.raw, deps.files.path(id, AUDIO), "audio/mp4", {
      "Cache-Control": "private, max-age=3600", "Content-Disposition": `inline; filename="recording.m4a"; filename*=UTF-8''${encodeURIComponent(name)}`
    });
  });

  return r;
}

export function privateRoutes(deps: Deps) {
  const { config, store, files, jobs, media, live, catchUp, billing } = deps;
  const r = new Hono<AppEnv>();
  const mine = (userId: string, id: string) => store.userLecture(userId, id) ?? fail(404, "This lecture does not exist.");

  r.get("/home", async c => {
    await billing.refresh(c.get("user").id);
    return c.json(homeView(deps, c.get("user")));
  });

  r.post("/courses", async c => {
    const { code, name } = courseFields(await jsonBody(c));
    return c.json(courseView(newCourse(store, c.get("user").id, code, name)));
  });

  r.post("/lectures", async c => {
    const user = c.get("user"), b = await jsonBody(c);
    const courseId = str(b.courseId), language = str(b.language) as ClassLanguage, source = str(b.source) as Source;
    if (!store.course(user.id, courseId)) fail(404, "This course does not exist.");
    if (!CLASS_LANGUAGES.includes(language)) fail(400, "Choose the language of the class.");
    if (!SOURCES.includes(source)) fail(400, "Choose how to add the lecture.");
    if (source === "link" && !deps.links) fail(501, "Adding a link is not available yet. Download the recording and upload the file.");
    /* The plan's lectures a month (plans.json), recorded or uploaded. */
    billing.checkLecture(user.id);
    if (source === "record" || source === "tab") {
      /* The daily limit is on live recording only (uploads are not counted), checked here and not only in the browser,
         and again on every chunk (a recording in progress counts too). */
      if (liveMinutesToday(store, user.id, config.timezone) >= billing.dailyLiveMinutes(user.id)) fail(429, "You have used today's recording minutes. Upload a recording instead, or come back tomorrow.");
      /* LIVE_RECORDING=off: refuse before the browser starts a recording that could not be saved. */
      if (!config.liveRecording) fail(501, "Recording in Halfold is not available right now. Record the lecture with another app and upload the file.");
    }
    const title = str(b.title).slice(0, 200) || "Untitled lecture";
    const l = store.createLecture({ id: "lec-" + randomId(12), user_id: user.id, course_id: courseId, title, language, source });
    return c.json(lectureView(l, config.timezone));
  });

  r.post("/lectures/:id/recording", async c => {
    const user = c.get("user"), id = c.req.param("id"), l0 = mine(user.id, id);
    if (l0.status !== "recording") fail(409, "This lecture already has a recording.");
    if (isLive(l0)) fail(409, "This lecture is being recorded in Halfold. End the recording to get the notes.");
    const got = await receiveFile(c.req.raw, files, "file", config.maxUploadBytes);
    try {
      const l = store.userLecture(user.id, id);
      if (!l) fail(404, "This lecture was deleted while the file was uploading.");
      if (l!.status !== "recording") fail(409, "This lecture already has a recording.");
      const info = await media.probe(got.tempPath);
      if (!info || !info.hasAudio) fail(415, "Halfold could not find any audio in this file. Try an MP3, M4A, WAV or MP4 file.");
      /* Stored under a fixed name with no extension: ffmpeg then reads it by its content, as ffprobe just did, and a
         file name such as x.m3u8 cannot make ffmpeg treat it as a playlist of other files. */
      await files.commit(got.tempPath, id, "recording");
      store.setRecording(id, "recording");
    } finally { await files.discard(got.tempPath); }
    /* Deleted between the check above and the move: the move recreated its folder. */
    if (!store.lecture(id)) await files.removeLecture(id);
    return c.body(null, 204);
  });

  /* Video links (DESIGN.md, 视频链接): only the link is kept here. It is downloaded after finish, in the pipeline (a
     download takes minutes, longer than a proxy waits for a reply). Sent again before finish, it replaces the link. */
  r.post("/lectures/:id/link", async c => {
    const user = c.get("user"), id = c.req.param("id"), l = mine(user.id, id), b = await jsonBody(c);
    if (l.source !== "link") fail(409, "This lecture is not made from a video link.");
    if (l.status !== "recording") fail(409, "The notes for this lecture have already been started from its link.");
    const url = typeof b.url === "string" ? b.url : "", problem = linkProblem(url);
    if (problem) fail(400, problem);
    store.setLink(id, url.trim());
    return c.body(null, 204);
  });

  /* Before the notes (status recording or failed): the slides go into the notes when they are written. After the notes
     (ready, phase 3, API-CHANGES.md section 3): the lecture is processing again before this reply, while the points are
     placed under the slides (pipeline.ts refile); then ready, with slides or, if that failed, with the notes as they were. */
  r.post("/lectures/:id/slides", async c => {
    const user = c.get("user"), id = c.req.param("id");
    const check = (l: LectureRow) => {
      if (l.status === "processing") fail(409, l.refile ? "Hal is already putting the notes under slides for this lecture." : "Halfold is writing the notes for this lecture. Add the slides when the notes are ready.");
      if (l.status === "ready" && store.detail(l.id)?.slides.length) fail(409, "This lecture already has slides.");
    };
    mine(user.id, id);
    /* The status is checked after the file has arrived: a reply sent while the browser is still sending can reach it as a network error. */
    const got = await receiveFile(c.req.raw, files, "file", config.maxUploadBytes);
    try {
      const l = store.userLecture(user.id, id) ?? fail(404, "This lecture was deleted while the file was uploading.");
      check(l);
      const fh = await fsp.open(got.tempPath, "r");
      const head = Buffer.alloc(5); await fh.read(head, 0, 5, 0); await fh.close();
      if (head.toString("latin1") !== "%PDF-") fail(415, "The slides have to be a PDF file.");
      await files.commit(got.tempPath, id, "slides.pdf");
      if (l.status !== "ready") store.setHasSlides(id);
      else if (store.startRefile(id)) jobs.enqueue(id);
    } finally { await files.discard(got.tempPath); }
    if (!store.lecture(id)) await files.removeLecture(id);
    return c.body(null, 204);
  });

  /* One piece of a live recording (multipart: audio, seq), every CHUNK_SECONDS. The reply carries the live transcript
     lines and alerts that are new since the last reply. Sent twice (the first reply was lost): stored once, and the
     reply repeats what the first one carried. 404 (the lecture was deleted) and 410 (no more audio taken) make the
     front end drop the rest of this lecture's chunks; any other error makes it send the chunk again later. */
  r.post("/lectures/:id/chunks", async c => {
    const user = c.get("user"), id = c.req.param("id");
    /* Everything is checked after the piece has arrived, even whether the lecture exists: a reply sent while the browser
       is still sending can reach it as a network error, and the front end would send the piece again instead of
       dropping the lecture's chunks on a 404. A piece is small (MAX_CHUNK_MB). */
    const got = await receiveFile(c.req.raw, files, "audio", config.live.maxChunkBytes);
    let seq: number;
    try {
      const l = mine(user.id, id);
      if (!isLive(l)) fail(409, "This lecture is not being recorded in Halfold.");
      const raw = got.fields.seq ?? "";
      if (!/^\d{1,6}$/.test(raw)) fail(400, "The piece of audio had no number (seq).");
      seq = Number(raw);
      const again = store.hasChunk(id, seq);
      if (l.status !== "recording") {
        if (again) return c.json<ChunkReply>({ segments: [], alerts: [] });
        fail(410, "This recording has ended, so this piece of audio was not added.");
      }
      if (!again) {
        if (l.live_limit >= 2) fail(410, LIMIT_REACHED);
        if (l.chunk_bytes + got.bytes > config.maxUploadBytes) { store.setLiveLimit(id, 2); fail(410, `This recording has reached ${Math.round(config.maxUploadBytes / 1048576)} MB, so Halfold has stopped saving it. End it to get notes for what was saved.`); }
        await files.commitChunk(got.tempPath, id, seq);
        store.addChunk(id, seq, got.bytes);
        /* Deleted while the piece was being stored: the move recreated the folder. */
        if (!store.lecture(id)) { await files.removeLecture(id); fail(404, "This lecture does not exist."); }
      }
    } finally { await files.discard(got.tempPath); }
    /* Transcribe what is new; the reply waits a little for it, or the lines come with the next reply. */
    await waitAtMost(live.kick(id), config.live.replyWaitMs);
    const l = store.lecture(id);
    if (!l) fail(404, "This lecture does not exist.");
    const used = liveSecondsToday(store, user.id, config.timezone), limit = billing.dailyLiveMinutes(user.id) * 60;
    if (l!.live_limit < 2 && used >= limit) { store.setLiveLimit(id, 2); store.addLiveAlert(id, { t: Math.floor(l!.live_audio), kind: "Recording", text: LIMIT_REACHED }); }
    else if (l!.live_limit < 1 && used >= limit - WARN_SECONDS) { store.setLiveLimit(id, 1); store.addLiveAlert(id, { t: Math.floor(l!.live_audio), kind: "Recording", text: limitSoon(limit - used) }); }
    return c.json<ChunkReply>(store.takeLive(id, seq!));
  });

  /* "Catch me up" on the recording screen: the last five minutes of the live transcript in a few sentences. */
  r.post("/lectures/:id/catch-up", async c => {
    const user = c.get("user"), id = c.req.param("id"), l0 = mine(user.id, id);
    if (!isLive(l0)) fail(409, "Catch me up works while a lecture is being recorded.");
    if (!config.live.transcript) fail(501, "Catch me up is not available right now. The notes will cover everything after the lecture.");
    if (l0.status === "recording") await waitAtMost(live.kick(id), config.live.replyWaitMs);
    const l = store.lecture(id) ?? fail(404, "This lecture does not exist.");
    /* The live transcript, and the sentence the lecturer is in the middle of (held back from the live view until it ends). */
    const all = store.liveLines(id), held = heldWords(l.live_held);
    if (held.length) all.push({ t: Math.floor(held[0].start), text: joinTokens(held.map(w => w.text)) });
    const end = Math.max(l.live_audio, all.length ? all[all.length - 1].t : 0);
    const lines = all.filter(x => x.t >= end - CATCH_UP_SECONDS);
    if (!lines.length) return c.json<CatchUpReply>({ points: [NOTHING_YET] });
    const course = store.course(user.id, l.course_id);
    const log = (u: { inputTokens: number; cachedInputTokens: number; outputTokens: number; reasoningTokens: number }, at: Date, ok: boolean) => {
      const price = catchUp.usd(u, at);
      store.logCost({ lectureId: id, userId: user.id, stage: "catchup", provider: catchUp.provider, model: catchUp.model, inputTokens: u.inputTokens,
        cachedInputTokens: u.cachedInputTokens, outputTokens: u.outputTokens, reasoningTokens: u.reasoningTokens, usd: price.usd,
        meta: { ...price.meta, completed: ok, lines: lines.length, from: lines[0].t, to: end } });
    };
    try {
      const call = await catchUp.sumUp({ courseCode: course?.code || "", title: l.title, language: l.language, lines }, c.req.raw.signal);
      log(call.usage, call.startedAt, true);
      return c.json<CatchUpReply>({ points: call.points });
    } catch (e) {
      const u = (e as { usage?: Parameters<typeof log>[0]; startedAt?: Date }).usage;
      if (u) log(u, (e as { startedAt?: Date }).startedAt || new Date(), false);
      console.warn(`[catch-up] ${id}: ${(e as Error).message}`);
      fail(502, "Hal could not sum up the last few minutes just now. Try again in a moment.");
    }
  });

  /* Idempotent: a lecture already processing or ready keeps its status and is not queued again. Also what "Make notes
     from what was saved" calls for a live recording that was never ended (status recording). */
  r.post("/lectures/:id/finish", async c => {
    const user = c.get("user"), id = c.req.param("id"), l = mine(user.id, id);
    let duration: number | null = null;
    try { const b = await c.req.json(); if (typeof b?.duration === "number" && Number.isFinite(b.duration) && b.duration > 0) duration = b.duration; } catch { /* no body */ }
    if (l.status === "processing" || l.status === "ready") return c.json<StatusReply>({ status: l.status });
    if (isLive(l)) {
      if (!l.recording_file && !store.hasChunk(id, 0)) fail(409, "Halfold did not receive any audio for this lecture. Delete it and record again.");
      /* The live rounds stop here; the pipeline transcribes whatever they had not reached (pipeline.ts transcribeLive). */
      live.stop(id);
    } else if (l.source === "link") {
      if (!l.recording_file && !l.link) fail(409, "Paste the link to the lecture video first.");
    } else if (!l.recording_file) fail(409, "Halfold did not receive a recording for this lecture. Delete it and upload the file again.");
    if (store.startProcessing(id, ["recording", "failed"], duration)) jobs.enqueue(id);
    return c.json<StatusReply>({ status: store.lecture(id)?.status ?? "processing" });
  });

  r.get("/lectures/:id/status", c => c.json<StatusReply>({ status: mine(c.get("user").id, c.req.param("id")).status }));

  /* Writes the notes again from the kept recording (a link lecture whose download failed downloads it again). Only a
     failed lecture is queued; any other status is returned as it is. */
  r.post("/lectures/:id/retry", c => {
    const id = c.req.param("id"), l = mine(c.get("user").id, id);
    const canRedo = l.recording_file || (isLive(l) && store.hasChunk(id, 0)) || (l.source === "link" && l.link);
    if (l.status === "failed" && canRedo && store.startProcessing(id, ["failed"])) jobs.enqueue(id);
    return c.json<StatusReply>({ status: store.lecture(id)?.status ?? l.status });
  });

  /* detail is there once the notes are written, also while slides sent later are being matched to them (processing). */
  r.get("/lectures/:id", c => {
    const l = mine(c.get("user").id, c.req.param("id"));
    const detail = store.detail(l.id);
    if (detail) {
      const audio = audioView(deps, l), progress = store.progress(l.id);
      if (audio) detail.audio = audio;
      if (progress) detail.progress = { known: progress.known };
    }
    return c.json({ lecture: lectureView(l, config.timezone), detail });
  });

  /* Also what "Cancel upload" calls. Removes the notes and every file; a running pipeline is stopped. */
  r.delete("/lectures/:id", async c => {
    const id = c.req.param("id");
    mine(c.get("user").id, id);
    store.deleteLecture(id);
    jobs.cancel(id); live.stop(id);
    await files.removeLecture(id);
    return c.body(null, 204);
  });

  return r;
}
