/* Video links (DESIGN.md, 视频链接) with yt-dlp stubbed: creating a link lecture, sending the link, the download as
   step 0 of the pipeline, the reason a student sees when it fails, retry, deleting part way, and the monthly count. */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { HomeSchema, LectureReplySchema, LectureSchema, SharedReplySchema } from "../src/shapes";
import { STUDENT_MESSAGE } from "../src/links/ytdlp";
import { linkLecture, setup, tempFiles, uploadedLecture } from "./helpers";

const URL1 = "https://www.youtube.com/watch?v=lecture9";
const finish = (s: ReturnType<typeof setup>, token: string, id: string) => s.call("POST", `/lectures/${id}/finish`, { token, json: { duration: 0 } });
const lectureOf = async (s: ReturnType<typeof setup>, token: string, id: string) => LectureReplySchema.parse((await s.call("GET", `/lectures/${id}`, { token })).body).lecture;

test("without yt-dlp on the machine a link lecture is refused, as before", async t => {
  const s = setup({ links: false }); t.after(() => s.close());
  const token = await s.signIn(), course = (await s.call("POST", "/courses", { token, json: { code: "ECON 1001" } })).body;
  const r = await s.call("POST", "/lectures", { token, json: { courseId: course.id, title: "Replay", language: "en", source: "link" } });
  assert.equal(r.status, 501);
  assert.equal(r.body.message, "Adding a link is not available yet. Download the recording and upload the file.");
});

test("a link lecture: the link is kept and shown, downloaded after finish, and the notes are written", async t => {
  const s = setup(); t.after(() => s.close());
  const token = await s.signIn(), id = await linkLecture(s, token);
  const before = await lectureOf(s, token, id);
  assert.equal(before.status, "recording"); assert.equal(before.link, URL1); assert.equal(before.error, undefined);
  assert.equal(s.links.calls.length, 0, "nothing is downloaded before finish");

  const f = await finish(s, token, id);
  assert.equal(f.status, 200); assert.equal(f.body.status, "processing");
  await s.pipeline.idle();
  assert.deepEqual(s.links.calls, [{ url: URL1, maxBytes: s.config.maxUploadBytes }]);
  const l = s.store.lecture(id)!;
  assert.equal(l.status, "ready", l.error ?? ""); assert.equal(l.recording_file, "recording");
  assert.equal(fs.existsSync(path.join(s.dir, "lectures", id, "recording")), false, "the download is deleted once the notes are written");
  assert.ok(fs.existsSync(path.join(s.dir, "lectures", id, "audio.m4a")));
  assert.ok(s.store.detail(id));
  const home = HomeSchema.parse((await s.call("GET", "/home", { token })).body);
  assert.equal(home.lectures[0].link, URL1);
  assert.deepEqual(tempFiles(s), [], "the download folder is gone");
});

test("sending the link: checked, kept only for a link lecture that has not started, and sent again replaces it", async t => {
  const s = setup(); t.after(() => s.close());
  const token = await s.signIn(), other = await s.signIn("CODE-B");
  const course = (await s.call("POST", "/courses", { token, json: { code: "ECON 1001" } })).body;
  const lec = LectureSchema.parse((await s.call("POST", "/lectures", { token, json: { courseId: course.id, title: "Replay", language: "en", source: "link" } })).body);
  const send = (json: unknown, tk = token, id = lec.id) => s.call("POST", `/lectures/${id}/link`, { token: tk, json });
  for (const bad of [{}, { url: "" }, { url: 42 }, { url: "ftp://example.com/a.mp4" }, { url: "youtube.com/watch?v=x" }, { url: "http://127.0.0.1/a.mp4" }, { url: "http://169.254.169.254/latest" }]) {
    const r = await send(bad);
    assert.equal(r.status, 400, JSON.stringify(bad)); assert.equal(typeof r.body.message, "string");
  }
  assert.equal((await send({ url: URL1 }, other)).status, 404);
  assert.equal((await send({ url: URL1 })).status, 204);
  assert.equal((await send({ url: "  https://vimeo.com/123  " })).status, 204);
  assert.equal((await lectureOf(s, token, lec.id)).link, "https://vimeo.com/123");

  const upload = await uploadedLecture(s, token);
  assert.equal((await send({ url: URL1 }, token, upload)).status, 409);
  await finish(s, token, lec.id);
  assert.equal((await send({ url: URL1 })).status, 409, "not once the notes are being written");
});

test("finish without a link: 409, and the lecture can still get one", async t => {
  const s = setup(); t.after(() => s.close());
  const token = await s.signIn(), course = (await s.call("POST", "/courses", { token, json: { code: "ECON 1001" } })).body;
  const lec = (await s.call("POST", "/lectures", { token, json: { courseId: course.id, title: "Replay", language: "en", source: "link" } })).body;
  const r = await finish(s, token, lec.id);
  assert.equal(r.status, 409); assert.match(r.body.message, /link/i);
  assert.equal(s.store.lecture(lec.id)!.status, "recording");
});

test("a download that fails: failed, with the reason for the student; retry downloads again", async t => {
  const s = setup(); t.after(() => s.close());
  const token = await s.signIn(), id = await linkLecture(s, token);
  s.links.next = { fail: "login" };
  await finish(s, token, id); await s.pipeline.idle();
  const l = await lectureOf(s, token, id);
  assert.equal(l.status, "failed"); assert.equal(l.error, STUDENT_MESSAGE.login);
  assert.match(s.store.lecture(id)!.error!, /login: stub download failed/);
  const home = HomeSchema.parse((await s.call("GET", "/home", { token })).body);
  assert.equal(home.lectures.find(x => x.id === id)!.error, STUDENT_MESSAGE.login);
  assert.deepEqual(tempFiles(s), []);

  s.links.next = {};
  const r = await s.call("POST", `/lectures/${id}/retry`, { token });
  assert.equal(r.body.status, "processing");
  await s.pipeline.idle();
  const again = await lectureOf(s, token, id);
  assert.equal(again.status, "ready"); assert.equal(again.error, undefined);
  assert.equal(s.links.calls.length, 2);
});

test("notes that fail after the download: no reason for the student, and retry does not download again", async t => {
  const s = setup(); t.after(() => s.close());
  const token = await s.signIn(), id = await linkLecture(s, token);
  s.notes.replies = [new Error("model down")];
  await finish(s, token, id); await s.pipeline.idle();
  const l = await lectureOf(s, token, id);
  assert.equal(l.status, "failed"); assert.equal(l.error, undefined);
  await s.call("POST", `/lectures/${id}/retry`, { token }); await s.pipeline.idle();
  assert.equal(s.store.lecture(id)!.status, "ready");
  assert.equal(s.links.calls.length, 1);
});

test("what came down is not a lecture: no audio, or longer than 5 hours", async t => {
  const s = setup(); t.after(() => s.close());
  const token = await s.signIn(), id = await linkLecture(s, token);
  s.links.next = { content: "<html>not audio</html>" };
  await finish(s, token, id); await s.pipeline.idle();
  assert.equal((await lectureOf(s, token, id)).error, STUDENT_MESSAGE["no-media"]);

  const long = await linkLecture(s, token);
  s.links.next = {}; (s.media as { duration: number }).duration = 5 * 3600 + 60;
  await finish(s, token, long); await s.pipeline.idle();
  assert.equal((await lectureOf(s, token, long)).error, STUDENT_MESSAGE["too-long"]);
  assert.equal(s.stt.calls, 0, "nothing was transcribed");
});

test("deleted while downloading: the download stops and nothing is left", async t => {
  const s = setup(); t.after(() => s.close());
  const token = await s.signIn(), id = await linkLecture(s, token);
  s.links.next = { hold: true };
  await finish(s, token, id);
  while (!s.links.calls.length) await new Promise(r => setTimeout(r, 5));
  assert.equal((await s.call("DELETE", `/lectures/${id}`, { token })).status, 204);
  await s.pipeline.idle();
  assert.equal(s.store.lecture(id), undefined);
  assert.equal(fs.existsSync(path.join(s.dir, "lectures", id)), false);
  assert.deepEqual(tempFiles(s), []);
});

test("a link lecture counts toward the lectures a month", async t => {
  const s = setup({ plans: p => { p.plans[0].lecturesPerMonth = 1; } }); t.after(() => s.close());
  const token = await s.signIn();
  await linkLecture(s, token);
  const course = (await s.call("POST", "/courses", { token, json: { code: "ECON 2001" } })).body;
  const r = await s.call("POST", "/lectures", { token, json: { courseId: course.id, title: "Another", language: "en", source: "link" } });
  assert.equal(r.status, 429);
});

test("a shared link lecture: the public page and a classmate's saved copy do not carry the pasted link", async t => {
  const s = setup(); t.after(() => s.close());
  const token = await s.signIn(), other = await s.signIn("CODE-B"), id = await linkLecture(s, token);
  await finish(s, token, id); await s.pipeline.idle();
  const url = (await s.call("POST", `/lectures/${id}/share`, { token })).body.url as string, share = url.split("#/s/")[1];
  const page = SharedReplySchema.parse((await s.call("GET", `/shared/${share}`)).body);
  assert.equal(page.lecture.link, undefined, "the shared page plays no recording, and shows no link to one");
  const saved = await s.call("POST", `/shared/${share}/save`, { token: other });
  assert.equal(saved.status, 200, saved.text);
  assert.equal(LectureSchema.parse(saved.body).link, undefined);
});

test("the shared page of a link lecture that also carries a failure reason has no link, no error and no source", async t => {
  const s = setup(); t.after(() => s.close());
  const token = await s.signIn(), id = await linkLecture(s, token);
  await finish(s, token, id); await s.pipeline.idle();
  const share = ((await s.call("POST", `/lectures/${id}/share`, { token })).body.url as string).split("#/s/")[1];
  s.store.setFailed(id, "details for the log", STUDENT_MESSAGE.login);   /* notes still stored, as after a later failed run */
  const own = await lectureOf(s, token, id);
  assert.equal(own.link, URL1); assert.equal(own.error, STUDENT_MESSAGE.login); assert.equal(own.source, "link", "the owner sees all three");
  const page = await s.call("GET", `/shared/${share}`);
  assert.equal(page.status, 200, page.text);
  const lecture = SharedReplySchema.parse(page.body).lecture;
  assert.equal(lecture.link, undefined); assert.equal(lecture.error, undefined); assert.equal(lecture.source, undefined);
  for (const secret of [URL1, STUDENT_MESSAGE.login, "details for the log"]) assert.ok(!JSON.stringify(page.body).includes(secret), secret);
});

const until = async (ok: () => boolean, ms = 3000) => { const end = Date.now() + ms; while (!ok() && Date.now() < end) await new Promise(r => setTimeout(r, 5)); return ok(); };

test("a download in progress does not hold up the notes of other lectures", async t => {
  const s = setup({ env: { PIPELINE_CONCURRENCY: "1" } }); t.after(() => s.close());
  const token = await s.signIn(), link = await linkLecture(s, token);
  s.links.next = { hold: true };
  await finish(s, token, link);
  assert.ok(await until(() => s.links.calls.length === 1));
  const upload = await uploadedLecture(s, token);
  await finish(s, token, upload);
  assert.ok(await until(() => s.store.lecture(upload)!.status === "ready"), "the upload got its notes while the link was still downloading");
  assert.equal(s.store.lecture(link)!.status, "processing");
  s.links.release(); await s.pipeline.idle();
  assert.equal(s.store.lecture(link)!.status, "ready");
});

test("LINK_CONCURRENCY downloads at a time; the next one starts when one ends", async t => {
  const s = setup({ env: { LINK_CONCURRENCY: "1" } }); t.after(() => s.close());
  const token = await s.signIn(), first = await linkLecture(s, token), second = await linkLecture(s, token, "https://vimeo.com/2");
  s.links.next = { hold: true };
  await finish(s, token, first); await finish(s, token, second);
  assert.ok(await until(() => s.links.calls.length === 1));
  await new Promise(r => setTimeout(r, 50));
  assert.equal(s.links.calls.length, 1, "the second waits");
  s.links.release();
  assert.ok(await until(() => s.links.calls.length === 2));
  s.links.next = {}; s.links.release(); await s.pipeline.idle();
  assert.deepEqual([first, second].map(id => s.store.lecture(id)!.status), ["ready", "ready"]);
});
