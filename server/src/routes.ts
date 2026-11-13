/* The phase 1 endpoints (reference/INTEGRATION.md section 2, API-CHANGES.md section 2). Paths are under /api. */
import fsp from "node:fs/promises";
import { Hono } from "hono";
import type { Config } from "./config";
import { CLASS_LANGUAGES, type ClassLanguage } from "./config";
import type { Store, UserRow } from "./db";
import { randomId } from "./db";
import type { FileStore } from "./files";
import type { Media } from "./media";
import { fail, jsonBody } from "./http/errors";
import { receiveFile } from "./http/upload";
import { courseView, homeView, lectureView, liveMinutesToday } from "./views";
import type { Source, StatusReply } from "../../src/types";

export interface Jobs { enqueue(lectureId: string): void; cancel(lectureId: string): void }
export interface Deps { config: Config; store: Store; files: FileStore; jobs: Jobs; media: Media }
export type AppEnv = { Variables: { user: UserRow } };

const SOURCES: Source[] = ["record", "tab", "upload", "link"];
const COLORS = ["#FF6B57", "#4C7DFF", "#2BB673", "#FFB020", "#9B5DE5", "#00B8D9", "#F15BB5", "#8D6E63"];
const str = (v: unknown) => typeof v === "string" ? v.trim() : "";

/* Signing in is public. A wrong code is an ordinary error the sign-in page shows as it is (http.ts: anon requests). */
export function publicRoutes({ store }: Deps) {
  const r = new Hono<AppEnv>();
  r.post("/session", async c => {
    const b = await jsonBody(c), code = str(b.inviteCode), name = str(b.name).slice(0, 60);
    if (!code) fail(400, "Enter your invite code.");
    const user = store.userByCode(code) ?? fail(401, "That invite code is not valid.");
    if (name && name !== user.name) store.setUserName(user.id, name);
    return c.json({ token: store.createSession(user.id), user: { name: name || user.name } });
  });
  /* Sharing is not built yet. The shared page asks without a token, so this must not be a 401 ("sign in again"). */
  r.get("/shared/:id", c => c.json({ message: "This link is not shared." }, 404));
  return r;
}

export function privateRoutes(deps: Deps) {
  const { config, store, files, jobs, media } = deps;
  const r = new Hono<AppEnv>();
  const mine = (userId: string, id: string) => store.userLecture(userId, id) ?? fail(404, "This lecture does not exist.");

  r.get("/home", c => c.json(homeView(store, config, c.get("user"))));

  r.post("/courses", async c => {
    const user = c.get("user"), b = await jsonBody(c), code = str(b.code), name = str(b.name);
    if (!code) fail(400, "Enter the course code.");
    if (code.length > 20) fail(400, "The course code can be at most 20 characters.");
    if (name.length > 80) fail(400, "The course name can be at most 80 characters.");
    const slug = code.toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 20) || "course";
    let id = slug + "-" + randomId(4);
    while (store.courseExists(id)) id = slug + "-" + randomId(4);
    const color = COLORS[store.courses(user.id).length % COLORS.length];
    return c.json(courseView(store.createCourse(user.id, id, code, name, color)));
  });

  r.post("/lectures", async c => {
    const user = c.get("user"), b = await jsonBody(c);
    const courseId = str(b.courseId), language = str(b.language) as ClassLanguage, source = str(b.source) as Source;
    if (!store.course(user.id, courseId)) fail(404, "This course does not exist.");
    if (!CLASS_LANGUAGES.includes(language)) fail(400, "Choose the language of the class.");
    if (!SOURCES.includes(source)) fail(400, "Choose how to add the lecture.");
    if (source === "record" || source === "tab") {
      /* The daily limit is on live recording only (uploads are not counted), checked here and not only in the browser. */
      if (liveMinutesToday(store, user.id, config.timezone) >= config.dailyLiveMinutes) fail(429, "You have used today's recording minutes. Upload a recording instead, or come back tomorrow.");
      /* Phase 1 has no chunk endpoint: refuse before the browser starts a recording that could not be saved. */
      if (!config.liveRecording) fail(501, "Recording in Sidenote is not available yet. Record the lecture with another app and upload the file.");
    }
    if (source === "link") fail(501, "Adding a link is not available yet. Download the recording and upload the file.");
    const title = str(b.title).slice(0, 200) || "Untitled lecture";
    const l = store.createLecture({ id: "lec-" + randomId(12), user_id: user.id, course_id: courseId, title, language, source });
    return c.json(lectureView(l, config.timezone));
  });

  r.post("/lectures/:id/recording", async c => {
    const user = c.get("user"), id = c.req.param("id");
    if (mine(user.id, id).status !== "recording") fail(409, "This lecture already has a recording.");
    const got = await receiveFile(c.req.raw, files, "file", config.maxUploadBytes);
    try {
      const l = store.userLecture(user.id, id);
      if (!l) fail(404, "This lecture was deleted while the file was uploading.");
      if (l!.status !== "recording") fail(409, "This lecture already has a recording.");
      const info = await media.probe(got.tempPath);
      if (!info || !info.hasAudio) fail(415, "Sidenote could not find any audio in this file. Try an MP3, M4A, WAV or MP4 file.");
      /* Stored under a fixed name with no extension: ffmpeg then reads it by its content, as ffprobe just did, and a
         file name such as x.m3u8 cannot make ffmpeg treat it as a playlist of other files. */
      await files.commit(got.tempPath, id, "recording");
      store.setRecording(id, "recording");
    } finally { await files.discard(got.tempPath); }
    /* Deleted between the check above and the move: the move recreated its folder. */
    if (!store.lecture(id)) await files.removeLecture(id);
    return c.body(null, 204);
  });

  r.post("/lectures/:id/slides", async c => {
    const user = c.get("user"), id = c.req.param("id");
    const check = (status: string) => {
      if (status === "processing") fail(409, "Sidenote is writing the notes for this lecture. Add the slides when the notes are ready.");
      if (status === "ready") fail(409, "Adding slides to a lecture that already has notes is not available yet.");
    };
    mine(user.id, id);
    /* The status is checked after the file has arrived: a reply sent while the browser is still sending can reach it as a network error. */
    const got = await receiveFile(c.req.raw, files, "file", config.maxUploadBytes);
    try {
      const l = store.userLecture(user.id, id) ?? fail(404, "This lecture was deleted while the file was uploading.");
      check(l.status);
      const fh = await fsp.open(got.tempPath, "r");
      const head = Buffer.alloc(5); await fh.read(head, 0, 5, 0); await fh.close();
      if (head.toString("latin1") !== "%PDF-") fail(415, "The slides have to be a PDF file.");
      await files.commit(got.tempPath, id, "slides.pdf");
      store.setHasSlides(id);
    } finally { await files.discard(got.tempPath); }
    if (!store.lecture(id)) await files.removeLecture(id);
    return c.body(null, 204);
  });

  /* Idempotent: a lecture already processing or ready keeps its status and is not queued again. */
  r.post("/lectures/:id/finish", async c => {
    const user = c.get("user"), id = c.req.param("id"), l = mine(user.id, id);
    let duration: number | null = null;
    try { const b = await c.req.json(); if (typeof b?.duration === "number" && Number.isFinite(b.duration) && b.duration > 0) duration = b.duration; } catch { /* no body */ }
    if (l.status === "processing" || l.status === "ready") return c.json<StatusReply>({ status: l.status });
    if (!l.recording_file) fail(409, "Sidenote did not receive a recording for this lecture. Delete it and upload the file again.");
    if (store.startProcessing(id, ["recording", "failed"], duration)) jobs.enqueue(id);
    return c.json<StatusReply>({ status: store.lecture(id)?.status ?? "processing" });
  });

  r.get("/lectures/:id/status", c => c.json<StatusReply>({ status: mine(c.get("user").id, c.req.param("id")).status }));

  /* Writes the notes again from the kept recording. Only a failed lecture is queued; any other status is returned as it is. */
  r.post("/lectures/:id/retry", c => {
    const id = c.req.param("id"), l = mine(c.get("user").id, id);
    if (l.status === "failed" && l.recording_file && store.startProcessing(id, ["failed"])) jobs.enqueue(id);
    return c.json<StatusReply>({ status: store.lecture(id)?.status ?? l.status });
  });

  r.get("/lectures/:id", c => {
    const l = mine(c.get("user").id, c.req.param("id"));
    return c.json({ lecture: lectureView(l, config.timezone), detail: l.status === "ready" ? store.detail(l.id) : null });
  });

  /* Also what "Cancel upload" calls. Removes the notes and every file; a running pipeline is stopped. */
  r.delete("/lectures/:id", async c => {
    const id = c.req.param("id");
    mine(c.get("user").id, id);
    store.deleteLecture(id);
    jobs.cancel(id);
    await files.removeLecture(id);
    return c.body(null, 204);
  });

  return r;
}
