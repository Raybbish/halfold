/* Every phase 1 reply against the shapes of src/types.ts (via the zod schemas in src/shapes.ts), and the shared rules:
   errors are {message}, 401 for a missing or wrong token, someone else's lecture does not exist. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { CourseSchema, ErrorReplySchema, HomeSchema, LectureReplySchema, LectureSchema, SessionReplySchema, StatusReplySchema } from "../src/shapes";
import { setup, uploadedLecture } from "./helpers";

const isError = (r: { body: unknown }) => ErrorReplySchema.parse(r.body);

test("SIGN_IN=invite: POST /session with a right code signs in, a wrong one is a 401 with a message", async t => {
  const s = setup({ env: { SIGN_IN: "invite" } }); t.after(() => s.close());
  const bad = await s.call("POST", "/session", { json: { inviteCode: "nope", name: "X" } });
  assert.equal(bad.status, 401); assert.equal(isError(bad).message, "That invite code is not valid.");
  assert.equal((await s.call("POST", "/session", { json: { inviteCode: "  ", name: "X" } })).status, 400);
  const ok = await s.call("POST", "/session", { json: { inviteCode: " code-a ", name: "Jasper" } });
  assert.equal(ok.status, 200);
  const reply = SessionReplySchema.parse(ok.body);
  assert.equal(reply.user.name, "Jasper");
  /* The same code is the same account; leaving the name empty keeps it. */
  const again = await s.call("POST", "/session", { json: { inviteCode: "CODE-A", name: "" } });
  assert.equal(again.body.user.name, "Jasper");
  const home = await s.call("GET", "/home", { token: again.body.token });
  assert.equal(home.body.user.name, "Jasper");
});

test("401 without a token or with a wrong one, as {message}", async t => {
  const s = setup(); t.after(() => s.close());
  for (const token of [undefined, "wrong-token"]) {
    const r = await s.call("GET", "/home", { token });
    assert.equal(r.status, 401); isError(r);
  }
  assert.equal((await s.call("POST", "/lectures/x/finish", { token: "nope" })).status, 401);
});

test("GET /home matches the Home shape, empty and with a lecture", async t => {
  const s = setup(); t.after(() => s.close());
  const token = await s.signIn();
  const empty = HomeSchema.parse((await s.call("GET", "/home", { token })).body);
  assert.deepEqual(empty.courses, []); assert.deepEqual(empty.lectures, []);
  assert.deepEqual(empty.usage, { minutesToday: 0, minutesLimit: 240 });
  assert.match(empty.today!, /^\d{4}-\d{2}-\d{2}$/);
  assert.deepEqual(empty.settings, { classLanguage: "en", zhDefault: true });   // 中文解釋 on by default

  const id = await uploadedLecture(s, token);
  await s.call("POST", `/lectures/${id}/finish`, { token, json: { duration: 590 } });
  await s.pipeline.idle();
  const home = HomeSchema.parse((await s.call("GET", "/home", { token })).body);
  assert.equal(home.lectures.length, 1);
  assert.deepEqual(home.lectures[0], { id, course: home.courses[0].id, title: "Week 9", date: "Today", duration: 600, status: "ready", shareUrl: null, source: "upload" });
  assert.deepEqual(home.upcoming, [{ date: "2099-11-26", kind: "Midterm", text: "Midterm on 26 November, chapters 1 to 5.", course: "ECON 1001", lecture: id, t: 18 }]);
});

test("POST /courses: returns a course; checks the code and name", async t => {
  const s = setup(); t.after(() => s.close());
  const token = await s.signIn();
  const r = await s.call("POST", "/courses", { token, json: { code: "COMP 1021", name: "Intro to CS" } });
  const c = CourseSchema.parse(r.body);
  assert.equal(c.code, "COMP 1021"); assert.match(c.id, /^comp1021-[A-Za-z0-9]{4}$/); assert.ok(c.color);
  assert.equal(CourseSchema.parse((await s.call("POST", "/courses", { token, json: { code: "X", name: "" } })).body).name, "");
  for (const json of [{ code: "", name: "a" }, { code: "x".repeat(21), name: "" }, { code: "OK", name: "n".repeat(81) }]) {
    const bad = await s.call("POST", "/courses", { token, json });
    assert.equal(bad.status, 400); isError(bad);
  }
  const broken = await s.call("POST", "/courses", { token, body: "{not json", headers: { "Content-Type": "application/json" } });
  assert.equal(broken.status, 400); isError(broken);
});

test("POST /lectures: an upload lecture, a live one; LIVE_RECORDING=off and links refused; bad input refused", async t => {
  const s = setup(); t.after(() => s.close());
  const token = await s.signIn(), other = await s.signIn("CODE-B");
  const course = (await s.call("POST", "/courses", { token, json: { code: "ECON 1001", name: "" } })).body;
  const r = await s.call("POST", "/lectures", { token, json: { courseId: course.id, title: "  ", language: "en-zh", source: "upload" } });
  const l = LectureSchema.parse(r.body);
  assert.equal(l.status, "recording"); assert.equal(l.title, "Untitled lecture"); assert.equal(l.course, course.id); assert.equal(l.date, "Today");

  const live = await s.call("POST", "/lectures", { token, json: { courseId: course.id, title: "Live", language: "en", source: "record" } });
  assert.equal(live.status, 200); assert.equal(LectureSchema.parse(live.body).status, "recording");
  const off = setup({ env: { LIVE_RECORDING: "off" }, links: false }); t.after(() => off.close());
  const offToken = await off.signIn(), offCourse = (await off.call("POST", "/courses", { token: offToken, json: { code: "X 1" } })).body;
  const refused = await off.call("POST", "/lectures", { token: offToken, json: { courseId: offCourse.id, title: "Live", language: "en", source: "tab" } });
  assert.equal(refused.status, 501); isError(refused);
  /* A link lecture: 501 only on a machine without yt-dlp (links.test.ts). */
  assert.equal(LectureSchema.parse((await s.call("POST", "/lectures", { token, json: { courseId: course.id, title: "L", language: "en", source: "link" } })).body).status, "recording");
  assert.equal((await off.call("POST", "/lectures", { token: offToken, json: { courseId: offCourse.id, title: "L", language: "en", source: "link" } })).status, 501);
  assert.equal((await s.call("POST", "/lectures", { token, json: { courseId: course.id, title: "L", language: "fr", source: "upload" } })).status, 400);
  assert.equal((await s.call("POST", "/lectures", { token, json: { courseId: course.id, title: "L", language: "en", source: "radio" } })).status, 400);
  /* Someone else's course does not exist for this student. */
  const theirs = await s.call("POST", "/lectures", { token: other, json: { courseId: course.id, title: "L", language: "en", source: "upload" } });
  assert.equal(theirs.status, 404); isError(theirs);
});

test("POST /lectures: the daily limit refuses live recording with a message, and does not apply to uploads", async t => {
  const s = setup({ plans: p => { p.plans[0].dailyLiveMinutes = 0; } }); t.after(() => s.close());
  const token = await s.signIn();
  const course = (await s.call("POST", "/courses", { token, json: { code: "ECON 1001", name: "" } })).body;
  const r = await s.call("POST", "/lectures", { token, json: { courseId: course.id, title: "Live", language: "en", source: "tab" } });
  assert.equal(r.status, 429);
  assert.equal(isError(r).message, "You have used today's recording minutes. Upload a recording instead, or come back tomorrow.");
  assert.equal((await s.call("POST", "/lectures", { token, json: { courseId: course.id, title: "Up", language: "en", source: "upload" } })).status, 200);
});

test("lecture endpoints: status, finish, retry, get and delete match their shapes", async t => {
  const s = setup(); t.after(() => s.close());
  const token = await s.signIn();
  const id = await uploadedLecture(s, token, { slides: true });

  const before = LectureReplySchema.parse((await s.call("GET", `/lectures/${id}`, { token })).body);
  assert.equal(before.detail, null); assert.equal(before.lecture.status, "recording");
  assert.deepEqual(StatusReplySchema.parse((await s.call("GET", `/lectures/${id}/status`, { token })).body), { status: "recording" });

  let release!: () => void; s.stt.gate = new Promise(r => { release = r; });   // hold the run in "processing"
  assert.deepEqual(StatusReplySchema.parse((await s.call("POST", `/lectures/${id}/finish`, { token, json: { duration: 600 } })).body), { status: "processing" });
  /* Idempotent: a second finish does not queue the lecture again. */
  assert.deepEqual((await s.call("POST", `/lectures/${id}/finish`, { token, json: { duration: 600 } })).body, { status: "processing" });
  /* Retry only acts on a failed lecture. */
  assert.deepEqual((await s.call("POST", `/lectures/${id}/retry`, { token })).body, { status: "processing" });
  /* No new files while the notes are being written. */
  assert.equal((await s.call("POST", `/lectures/${id}/slides`, { token, body: (await import("./helpers")).fileForm("%PDF-1.4", "s.pdf") })).status, 409);
  release();
  await s.pipeline.idle();
  assert.equal(s.stt.calls, 1); assert.equal(s.notes.calls.length, 1);
  assert.deepEqual((await s.call("POST", `/lectures/${id}/finish`, { token })).body, { status: "ready" });

  const after = LectureReplySchema.parse((await s.call("GET", `/lectures/${id}`, { token })).body);
  assert.equal(after.lecture.status, "ready");
  assert.ok(after.detail);
  assert.equal(after.detail.slides.length, 2);
  /* Playback: a signed link to the kept recording, relative to the page (PUBLIC_URL not set); no keep date by default. */
  assert.match(after.detail.audio!.url!, new RegExp(`^/api/lectures/${id}/audio\\?exp=\\d+&sig=[\\w-]{32}$`));
  assert.deepEqual(Object.keys(after.detail.audio!), ["url"]);

  /* Another student cannot see, finish or delete it. */
  const other = await s.signIn("CODE-B");
  for (const [m, p] of [["GET", `/lectures/${id}`], ["GET", `/lectures/${id}/status`], ["POST", `/lectures/${id}/finish`], ["POST", `/lectures/${id}/retry`], ["DELETE", `/lectures/${id}`]] as const) {
    const r = await s.call(m, p, { token: other });
    assert.equal(r.status, 404, `${m} ${p}`); isError(r);
  }

  const del = await s.call("DELETE", `/lectures/${id}`, { token });
  assert.equal(del.status, 204);
  assert.equal((await s.call("GET", `/lectures/${id}`, { token })).status, 404);
  assert.equal(s.files.exists(id, "audio.m4a"), false);
  /* The cost of the deleted lecture is still counted. */
  assert.equal(s.store.costs().filter(c => c.lecture_id === id).length, 2);
});

test("POST /finish without a recording is a 409 with a message; an endpoint that does not exist is a 404 with a message", async t => {
  const s = setup(); t.after(() => s.close());
  const token = await s.signIn();
  const course = (await s.call("POST", "/courses", { token, json: { code: "ECON 1001", name: "" } })).body;
  const lec = (await s.call("POST", "/lectures", { token, json: { courseId: course.id, title: "L", language: "en", source: "upload" } })).body;
  const r = await s.call("POST", `/lectures/${lec.id}/finish`, { token, json: { duration: 0 } });
  assert.equal(r.status, 409); isError(r);
  for (const [m, p] of [["GET", "/nothing-here"], ["POST", "/lectures/x/link-later"]] as const) {
    const n = await s.call(m, p, { token });
    assert.equal(n.status, 404, `${m} ${p}`); isError(n);
  }
});

test("public and size rules: a link that is not shared is a 404 (not a 401); a huge JSON body is a 413", async t => {
  const s = setup(); t.after(() => s.close());
  const shared = await s.call("GET", "/shared/abc");
  assert.equal(shared.status, 404); isError(shared);
  const big = await s.call("POST", "/session", { json: { inviteCode: "CODE-A", name: "x".repeat(200_000) } });
  assert.equal(big.status, 413); isError(big);
  const token = await s.signIn();
  assert.equal((await s.call("POST", "/courses", { token, json: { code: "C", name: "y".repeat(100_000) } })).status, 413);
});

test("lecture.source: GET /lectures/:id and /home say how each lecture was made; the shared page does not", async t => {
  const s = setup(); t.after(() => s.close());
  const token = await s.signIn();
  const course = (await s.call("POST", "/courses", { token, json: { code: "ECON 1001", name: "" } })).body;
  const made: Record<string, string> = {};
  for (const source of ["record", "tab", "upload", "link"]) {
    const r = await s.call("POST", "/lectures", { token, json: { courseId: course.id, title: source, language: "en", source } });
    assert.equal(r.status, 200, r.text); made[source] = r.body.id;
  }
  const home = HomeSchema.parse((await s.call("GET", "/home", { token })).body);
  for (const [source, id] of Object.entries(made)) {
    assert.equal(LectureReplySchema.parse((await s.call("GET", `/lectures/${id}`, { token })).body).lecture.source, source);
    assert.equal(home.lectures.find(l => l.id === id)?.source, source);
  }
  const up = await uploadedLecture(s, token);
  await s.call("POST", `/lectures/${up}/finish`, { token, json: { duration: 590 } }); await s.pipeline.idle();
  const url = (await s.call("POST", `/lectures/${up}/share`, { token })).body.url as string;
  const page = await s.call("GET", `/shared/${url.split("#/s/")[1]}`);
  assert.equal(page.status, 200, page.text);
  assert.equal("source" in page.body.lecture, false);
});
