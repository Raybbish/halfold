/* Phase 3: what a student does with lectures that already exist (reference/INTEGRATION.md section 2, API-CHANGES.md
   sections 1 and 4). Rename and move a lecture; edit the notes; study progress; feedback on the notes; share a lecture
   and save a copy of someone's shared notes; edit and delete a course; review packs; search the notes. Slides sent after
   the notes are in routes.ts (POST /lectures/:id/slides) and pipeline.ts. Paths are under /api. */
import { Hono, type Context } from "hono";
import type { Lecture, Point, SearchReply, SharedReply, UrlReply } from "../../src/types";
import { randomId, type LectureRow } from "./db";
import { fail, jsonBody } from "./http/errors";
import { courseFields, newCourse, str, type AppEnv, type Deps } from "./routes";
import { courseView, lectureView } from "./views";
import { lectureKey, notedLectures } from "./packs";
import type { StoredPack } from "./notes/pack";

const NOT_SHARED = "This link is no longer shared.";
const NO_NOTE = "This note is no longer there. Open the lecture again to see the latest notes.";
const MAX_NOTE = 2000, MAX_FEEDBACK = 4000, MAX_RESULTS = 20;
/* A live recording that sent a piece of audio this recently is still going (pieces come every 15 seconds). */
const RECORDING_NOW_MS = 2 * 60_000;

/* The shared page is public: no token, and a link that does not work is a 404 (a 401 would send the reader to sign in). */
export function sharedRoutes(deps: Deps) {
  const { config, store } = deps;
  const r = new Hono<AppEnv>();
  r.get("/shared/:id", c => {
    const id = c.req.param("id"), l = store.lectureByShare(id), detail = l && store.detail(l.id);
    if (!l || !detail) fail(404, NOT_SHARED);
    const course = store.courseById(l!.course_id), owner = store.user(l!.user_id);
    /* No recording (INTEGRATION.md 4.3: the shared page plays none) and not the owner's progress: detail is the notes as
       stored. The lecture goes by the share id, so readers never learn its own id. */
    return c.json<SharedReply>({
      lecture: { ...lectureView(l!, config.timezone), id, status: "ready", shareUrl: null },
      ...(course ? { course: courseView(course) } : {}), detail: detail!, sharedBy: owner?.name.trim() || "A classmate"
    });
  });
  return r;
}

export function libraryRoutes(deps: Deps) {
  const { config, store, files, jobs, live, packs } = deps;
  const r = new Hono<AppEnv>();
  const mine = (c: Context<AppEnv>) => store.userLecture(c.get("user").id, c.req.param("id")!) ?? fail(404, "This lecture does not exist.");
  const myCourse = (c: Context<AppEnv>) => store.course(c.get("user").id, c.req.param("id")!) ?? fail(404, "This course does not exist.");
  const view = (l: LectureRow) => lectureView(l, config.timezone);

  /* ---------- a lecture: title and course ---------- */
  /* Renaming sends {title}; moving to another of the student's courses sends {course} (API-CHANGES.md section 1). The
     upcoming dates follow the lecture (GET /home reads the course code through it); both courses' review packs no
     longer match their lectures and report "none" (packs.ts). */
  r.patch("/lectures/:id", async c => {
    const l = mine(c), b = await jsonBody(c);
    if (!("title" in b) && !("course" in b)) fail(400, "Nothing to change.");
    const title = "title" in b ? str(b.title) : null;
    if (title !== null && !title) fail(400, "Enter a title.");
    if (title && title.length > 200) fail(400, "The title can be at most 200 characters.");
    const to = "course" in b ? store.course(c.get("user").id, str(b.course)) ?? fail(404, "That course does not exist.") : null;
    if (title !== null) store.renameLecture(l.id, title);
    if (to) store.moveLecture(l.id, to.id);
    return c.body(null, 204);
  });

  /* ---------- editing the notes ----------
     A point is found by its section and its place in that section (INTEGRATION.md section 2), so the order is kept:
     an added point goes last in its section, and a section whose points were all deleted stays (empty). */
  const editable = (l: LectureRow) => {
    if (l.status === "processing" && l.refile) fail(409, "Sid is putting the notes under the slides. Try again in a minute.");
    if (l.status !== "ready" || !store.detail(l.id)) fail(409, "This lecture has no notes yet.");
  };
  const place = (v: unknown) => typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : fail(400, "The note to change was not given.");
  const noteText = (v: unknown) => {
    const text = str(v);
    if (!text) fail(400, "Write the note first.");
    if (text.length > MAX_NOTE) fail(400, `A note can be at most ${MAX_NOTE} characters.`);
    return text;
  };

  /* {section, index, text}: the text changes; the time, slide, "off" and Chinese explanation stay. */
  r.patch("/lectures/:id/points", async c => {
    const l = mine(c), b = await jsonBody(c), si = place(b.section), pi = place(b.index), text = noteText(b.text);
    editable(l);
    store.editDetail(l.id, d => { (d.sections[si]?.points[pi] ?? fail(404, NO_NOTE)).text = text; });
    return c.body(null, 204);
  });
  /* {section, text} -> the new point, the student's own: no time, no slide (INTEGRATION.md section 2). */
  r.post("/lectures/:id/points", async c => {
    const l = mine(c), b = await jsonBody(c), si = place(b.section), text = noteText(b.text);
    editable(l);
    const point: Point = { t: null, text, mine: true, off: false, slide: null };
    store.editDetail(l.id, d => { (d.sections[si] ?? fail(404, NO_NOTE)).points.push(point); });
    return c.json<Point>(point);
  });
  r.delete("/lectures/:id/points", async c => {
    const l = mine(c), b = await jsonBody(c), si = place(b.section), pi = place(b.index);
    editable(l);
    store.editDetail(l.id, d => { const s = d.sections[si]; if (!s?.points[pi]) fail(404, NO_NOTE); s.points.splice(pi, 1); });
    return c.body(null, 204);
  });

  /* ---------- progress and feedback ---------- */
  /* {known: [flashcard index], quizScore}: detail.progress.known when the lecture is opened again. quizScore is null
     unless a quiz round was just finished; the last score is kept then. */
  r.put("/lectures/:id/progress", async c => {
    const l = mine(c), b = await jsonBody(c), known = b.known, score = b.quizScore;
    if (!Array.isArray(known) || known.length > 5000 || !known.every(n => typeof n === "number" && Number.isInteger(n) && n >= 0 && n < 100_000)) fail(400, "The progress could not be read.");
    if (score != null && !(typeof score === "number" && Number.isFinite(score) && score >= 0)) fail(400, "The quiz score could not be read.");
    store.saveProgress(l.id, [...new Set(known as number[])].sort((a, b) => a - b), (score as number | null | undefined) ?? null);
    return c.body(null, 204);
  });
  /* "What is wrong in these notes?" Kept with the lecture (deleted with it); `npm run feedback` lists it. */
  r.post("/lectures/:id/feedback", async c => {
    const l = mine(c), text = str((await jsonBody(c)).text);
    if (!text) fail(400, "Tell us what is wrong first.");
    if (text.length > MAX_FEEDBACK) fail(400, `Feedback can be at most ${MAX_FEEDBACK} characters.`);
    store.addFeedback(l.id, c.get("user").id, text);
    return c.body(null, 204);
  });

  /* ---------- sharing ---------- */
  /* -> {url}, the shared page #/s/:id with an id no one can guess. Shared already: the same link. */
  r.post("/lectures/:id/share", c => {
    const l = mine(c);
    if (l.share_url) return c.json<UrlReply>({ url: l.share_url });
    if (!store.detail(l.id)) fail(409, "Share the lecture once its notes are ready.");
    const shareId = randomId(16), url = `${shareBase(c, deps)}/#/s/${shareId}`;
    store.setShare(l.id, shareId, url);
    return c.json<UrlReply>({ url });
  });
  /* The old link stops working; sharing again makes a new one. */
  r.delete("/lectures/:id/share", c => { store.clearShare(mine(c).id); return c.body(null, 204); });

  /* A signed-in reader keeps a copy of shared notes: in their course with the same code (made if they have none), without
     the recording (INTEGRATION.md section 2). Saving the same notes again gives the copy made the first time; saving
     your own shared lecture gives the lecture itself. */
  r.post("/shared/:id/save", c => {
    const user = c.get("user"), src = store.lectureByShare(c.req.param("id")), detail = src && store.detail(src.id);
    if (!src || !detail) fail(404, NOT_SHARED);
    if (src!.user_id === user.id) return c.json<Lecture>(view(src!));
    const have = store.copyOf(user.id, src!.id);
    if (have) return c.json<Lecture>(view(have));
    const from = store.courseById(src!.course_id)!, key = (code: string) => code.toLowerCase().replace(/\s+/g, "");
    const course = store.courses(user.id).find(x => key(x.code) === key(from.code)) ?? newCourse(store, user.id, from.code, from.name);
    return c.json<Lecture>(view(store.copyLecture(src!, detail!, { id: "lec-" + randomId(12), userId: user.id, courseId: course.id })));
  });

  /* ---------- courses ---------- */
  /* {code, name}: the same limits as adding a course. Two courses may have the same code, as when adding them. */
  r.patch("/courses/:id", async c => {
    const course = myCourse(c), b = await jsonBody(c), { code, name } = courseFields(b);
    store.updateCourse(course.id, code, "name" in b ? name : course.name);
    return c.body(null, 204);
  });
  /* The course and every lecture in it, each as DELETE /lectures/:id does (files, notes, shared links, runs in
     progress), and its review pack. Refused while one of its lectures is being recorded. */
  r.delete("/courses/:id", async c => {
    const course = myCourse(c);
    if (store.recordingIn(course.id, new Date(Date.now() - RECORDING_NOW_MS).toISOString())) fail(409, "A lecture in this course is being recorded. End the recording, then delete the course.");
    const ids = store.courseLectures(course.id).map(l => l.id);
    store.deleteCourse(course.id);
    packs.cancel(course.id);
    for (const id of ids) { jobs.cancel(id); live.stop(id); await files.removeLecture(id); }
    return c.body(null, 204);
  });

  /* ---------- review packs (packs.ts) ---------- */
  /* -> {status: "none" | "processing"} or the pack. A pack made from other lectures than the course has now is "none".
     A pack that could not be made is reported once, as a 502 with a message (shown while the front end waits for it),
     and is "none" after that, so the student can make it again. */
  r.get("/courses/:id/review-pack", c => {
    const course = myCourse(c), p = store.pack(course.id);
    if (!p) return c.json({ status: "none" });
    if (p.status === "processing") return c.json({ status: "processing" });
    if (p.status === "failed") { store.dropPack(course.id); fail(502, "Sid could not make the review pack just now. Try again in a moment."); }
    const lectures = notedLectures(store, course.id);
    if (lectureKey(lectures.map(l => l.id)) !== lectureKey(p.lecture_ids.split(" ").filter(Boolean))) return c.json({ status: "none" });
    /* Lecture titles as they are now. */
    const title = new Map(lectures.map(l => [l.id, l.title])), pack = JSON.parse(p.pack_json || "{}") as StoredPack;
    return c.json({
      status: "ready",
      hints: pack.hints.map(h => ({ ...h, lecture: title.get(h.lectureId) || "" })),
      sheet: pack.sheet.map(s => ({ topic: s.topic, points: s.points.map(x => ({ ...x, lecture: title.get(x.lectureId) || "" })) })),
      exam: pack.exam
    });
  });
  /* Starts making the pack (again), unless it is being made. -> {status} */
  r.post("/courses/:id/review-pack", c => {
    const course = myCourse(c);
    packs.start(course.id);
    return c.json({ status: store.pack(course.id)?.status === "ready" ? "ready" : "processing" });
  });

  /* ---------- search (API-CHANGES.md section 4) ----------
     Every point in the notes of the student's lectures, as edited, the student's own included: case does not matter,
     every word of the query has to be in the point, in any order. At most 20, newest lecture first. */
  r.get("/search", c => {
    const words = (c.req.query("q") || "").slice(0, 200).toLowerCase().split(/\s+/).filter(Boolean);
    const results: SearchReply["results"] = [];
    if (words.length) for (const p of store.notePoints(c.get("user").id)) {
      if (!p.text || !words.every(w => p.text!.toLowerCase().includes(w))) continue;
      results.push({ lecture: p.lecture, text: p.text, t: typeof p.t === "number" ? p.t : null });
      if (results.length === MAX_RESULTS) break;
    }
    return c.json<SearchReply>({ results });
  });

  return r;
}

/* Where the front end is, for a shared link: WEB_URL; else the page that asked (the browser's Origin header); else
   PUBLIC_URL; else this server. A front end served under a path (https://x.com/app/) needs WEB_URL. */
function shareBase(c: Context, deps: Deps) {
  const origin = c.req.header("origin") || "";
  return deps.config.webUrl || (/^https?:\/\/[^/\s]+$/i.test(origin) ? origin : "") || deps.config.publicUrl || new URL(c.req.url).origin;
}
