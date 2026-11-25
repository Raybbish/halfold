/* The same class recorded by several students (dedupe.ts, handoff of 2026-11-23 item 3 stage 1): the same file or the
   same YouTube video is transcribed and written up once, and every other student gets a copy of their own. Matches,
   the cases that must not match, a match while the first is still being transcribed, deleting the first copy, slides
   of one's own, and the figures for npm run costs. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { DetailSchema } from "../src/shapes";
import { STUDENT_MESSAGE } from "../src/links/ytdlp";
import { classStats, linkKey } from "../src/dedupe";
import { FAKE_AUDIO, goodNotes, linkLecture, setup, uploadedLecture, type TestServer } from "./helpers";

const SAME = FAKE_AUDIO + "-the-class-everyone-recorded";
const VIDEO = "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s";
const finish = (s: TestServer, token: string, id: string) => s.call("POST", `/lectures/${id}/finish`, { token, json: { duration: 600 } });
const get = async (s: TestServer, token: string, id: string) => (await s.call("GET", `/lectures/${id}`, { token })).body;
const points = (d: { sections: { points: { text: string }[] }[] }) => d.sections.flatMap(x => x.points.map(p => p.text));
const MODEL_POINTS = ["The midterm is on 26 November.", "Opportunity cost is the next best thing you give up."];
async function ready(s: TestServer, token: string, o: Parameters<typeof uploadedLecture>[2] = {}) {
  const id = await uploadedLecture(s, token, o);
  await finish(s, token, id); await s.pipeline.idle();
  assert.equal(s.store.lecture(id)!.status, "ready", s.store.lecture(id)!.error ?? "");
  return id;
}
async function until(what: () => boolean) {
  for (let i = 0; i < 200 && !what(); i++) await new Promise(r => setTimeout(r, 5));
  assert.ok(what());
}
const recordings = (s: TestServer) => s.store.classRecordings().map(r => [r.lecture_id, r.class_id, r.match_on, r.reused]);

test("the same file uploaded by another student: the transcript and the notes as the model wrote them are copied, nothing is paid again, and each copy is the student's own", async t => {
  const s = setup(); t.after(() => s.close());
  const ann = await s.signIn("CODE-A"), ben = await s.signIn("CODE-B"), benId = s.store.userByCode("CODE-B")!.id;
  s.notes.replies = [JSON.stringify({ ...goodNotes(), title: "Opportunity cost" })];
  const a = await ready(s, ann, { bytes: SAME, title: "Lecture, Mon 23 Nov, 10:00", autoTitle: true });
  /* Ann makes her notes her own: a point changed, a point of her own, a name, her progress. */
  assert.equal((await s.call("PATCH", `/lectures/${a}/points`, { token: ann, json: { section: 1, index: 0, text: "Ann's own words." } })).status, 204);
  assert.equal((await s.call("POST", `/lectures/${a}/points`, { token: ann, json: { section: 0, text: "Ann's phone number." } })).status, 200);
  assert.equal((await s.call("PATCH", `/lectures/${a}`, { token: ann, json: { title: "Ann's econ class" } })).status, 204);
  assert.equal((await s.call("PUT", `/lectures/${a}/progress`, { token: ann, json: { known: [0], quizScore: 1 } })).status, 204);

  const b = await uploadedLecture(s, ben, { bytes: SAME, title: "Lecture, Tue 24 Nov, 09:00", autoTitle: true });
  assert.deepEqual((await finish(s, ben, b)).body, { status: "processing" }, "the student sees the usual wait");
  await s.pipeline.idle();
  assert.equal(s.stt.calls, 1, "transcribed once"); assert.equal(s.notes.calls.length, 1, "written once");
  assert.deepEqual(s.store.costs().filter(c => c.lecture_id === b), [], "the copy logs no cost");
  const lb = s.store.lecture(b)!;
  assert.equal(lb.status, "ready"); assert.equal(lb.reused_from, a);
  assert.match(lb.content_key!, /^file:[0-9a-f]{64}$/); assert.equal(lb.content_key, s.store.lecture(a)!.content_key);

  /* What Ben sees: the notes as the model wrote them, not Ann's edits, own point, name or progress. */
  const B = await get(s, ben, b);
  DetailSchema.parse(B.detail);
  assert.equal(B.lecture.title, "Opportunity cost", "the model's title for a dated title, as for any lecture");
  assert.deepEqual(points(B.detail), MODEL_POINTS);
  assert.equal(B.detail.progress, undefined);
  assert.deepEqual(B.detail.transcript, (await get(s, ann, a)).detail.transcript);
  assert.deepEqual(s.store.transcript(b), s.store.transcript(a));
  assert.ok(B.detail.audio, "Ben plays his own recording");
  assert.ok(s.files.exists(b, "audio.m4a")); assert.equal(s.files.exists(b, "recording"), false, "his original is deleted once the notes are in, as for any lecture");
  assert.equal((await s.app.request(B.detail.audio.url)).status, 200);
  const home = (await s.call("GET", "/home", { token: ben })).body;
  assert.deepEqual(home.upcoming.map((u: { lecture: string; text: string }) => [u.lecture, u.text]), [[b, "Midterm on 26 November, chapters 1 to 5."]]);

  /* Each edits their own copy. */
  assert.equal((await s.call("PATCH", `/lectures/${b}/points`, { token: ben, json: { section: 0, index: 0, text: "Ben's words." } })).status, 204);
  assert.deepEqual(points(s.store.detail(a)!), ["The midterm is on 26 November.", "Ann's phone number.", "Ann's own words."]);
  assert.deepEqual(points(s.store.detail(b)!), ["Ben's words.", MODEL_POINTS[1]]);
  assert.equal((await s.call("GET", `/lectures/${a}`, { token: ben })).status, 404, "Ben still cannot open Ann's lecture");

  /* It counts as one of Ben's lectures this month, as any other (the quota rules are not decided). */
  assert.equal(s.store.lecturesUsed(benId, "2000-01-01T00:00:00.000Z"), 1);
  /* npm run costs: one class, two recordings, one merged. */
  assert.deepEqual(recordings(s), [[a, a, "file", "none"], [b, a, "file", "notes"]]);
  assert.deepEqual(classStats(s.store.classRecordings()), { lectures: 2, matchable: 2, merged: 1, notesCopied: 1, classes: 1, sizes: [[2, 1]] });
});

test("a link to the same YouTube video, pasted another way: matched; each student still downloads their own recording, and a link that no longer opens fails as before", async t => {
  const s = setup(); t.after(() => s.close());
  const ann = await s.signIn("CODE-A"), ben = await s.signIn("CODE-B");
  const a = await linkLecture(s, ann, VIDEO);
  await finish(s, ann, a); await s.pipeline.idle();
  assert.equal(s.store.lecture(a)!.status, "ready");

  const b = await linkLecture(s, ben, "https://youtu.be/dQw4w9WgXcQ?si=from-the-group-chat");
  await finish(s, ben, b); await s.pipeline.idle();
  const lb = s.store.lecture(b)!;
  assert.equal(lb.status, "ready", lb.error ?? ""); assert.equal(lb.reused_from, a); assert.equal(lb.content_key, "youtube:dQw4w9WgXcQ");
  assert.equal(s.links.calls.length, 2, "downloaded for each student");
  assert.equal(s.stt.calls, 1); assert.equal(s.notes.calls.length, 1);
  const B = await get(s, ben, b);
  assert.equal(B.lecture.link, "https://youtu.be/dQw4w9WgXcQ?si=from-the-group-chat", "the link as Ben pasted it");
  assert.deepEqual(points(B.detail), MODEL_POINTS);
  assert.ok(B.detail.audio);

  /* The video has gone private since: Ben's second paste fails as it would have, and gets nothing of Ann's. */
  s.links.next = { fail: "login" };
  const c = await linkLecture(s, ben, VIDEO);
  await finish(s, ben, c); await s.pipeline.idle();
  const lc = s.store.lecture(c)!;
  assert.equal(lc.status, "failed"); assert.equal(lc.public_error, STUDENT_MESSAGE.login);
  assert.equal(s.store.transcript(c), null); assert.equal(s.store.detail(c), null);
  assert.deepEqual(recordings(s), [[a, a, "link", "none"], [b, a, "link", "notes"]]);
});

test("no match: another file, the same file in another class language, a link to another site, a video trimmed since", async t => {
  const s = setup(); t.after(() => s.close());
  const ann = await s.signIn("CODE-A"), ben = await s.signIn("CODE-B");
  const first = await ready(s, ann, { bytes: SAME, language: "en-yue" });
  const other = await ready(s, ben, { bytes: SAME + "-another-seat" });
  const otherLanguage = await ready(s, ben, { bytes: SAME, language: "en" });
  assert.equal(s.stt.calls, 3);

  /* The file behind a link to another site can be replaced: such links are never matched, even the same link. */
  const vimeo = [await linkLecture(s, ann, "https://vimeo.com/123456789"), await linkLecture(s, ben, "https://vimeo.com/123456789")];
  await finish(s, ann, vimeo[0]); await finish(s, ben, vimeo[1]); await s.pipeline.idle();
  assert.equal(s.store.lecture(vimeo[0])!.content_key, null);
  assert.equal(s.stt.calls, 5);

  /* The same YouTube video, trimmed by its owner between the two downloads: a different length is not the same recording. */
  const whole = await linkLecture(s, ann, VIDEO);
  await finish(s, ann, whole); await s.pipeline.idle();
  s.links.next = { content: `${FAKE_AUDIO}:540\n` };
  const trimmed = await linkLecture(s, ben, VIDEO);
  await finish(s, ben, trimmed); await s.pipeline.idle();
  assert.equal(s.store.lecture(trimmed)!.duration, 540);
  assert.equal(s.stt.calls, 7); assert.equal(s.notes.calls.length, 7);

  for (const id of [first, other, otherLanguage, ...vimeo, whole, trimmed]) {
    const l = s.store.lecture(id)!;
    assert.equal(l.status, "ready", `${id}: ${l.error}`); assert.equal(l.reused_from, null, id);
  }
  assert.deepEqual(s.store.classRecordings().map(r => r.reused), Array(7).fill("none"));
  assert.deepEqual(classStats(s.store.classRecordings()), { lectures: 7, matchable: 5, merged: 0, notesCopied: 0, classes: 7, sizes: [[1, 7]] });
});

test("the same recording while the first is still being transcribed: the second waits for it, without a slot or a second transcription, then copies", async t => {
  const s = setup({ env: { PIPELINE_CONCURRENCY: "2" } }); t.after(() => s.close());
  const ann = await s.signIn("CODE-A"), ben = await s.signIn("CODE-B");
  let release!: () => void; s.stt.gate = new Promise(r => { release = r; });
  const a = await uploadedLecture(s, ann, { bytes: SAME });
  await finish(s, ann, a);
  await until(() => s.stt.calls === 1);

  const b = await uploadedLecture(s, ben, { bytes: SAME });
  await finish(s, ben, b);
  await new Promise(r => setTimeout(r, 30));
  assert.equal(s.stt.calls, 1, "no second transcription");
  assert.deepEqual((await s.call("GET", `/lectures/${b}/status`, { token: ben })).body, { status: "processing" });
  /* Waiting does not hold one of the two runs: another student's lecture is transcribed meanwhile. */
  const c = await uploadedLecture(s, ben, { bytes: SAME + "-another-class" });
  await finish(s, ben, c);
  await until(() => s.stt.calls === 2);

  release(); await s.pipeline.idle();
  assert.equal(s.stt.calls, 2); assert.equal(s.notes.calls.length, 2);
  for (const id of [a, b, c]) assert.equal(s.store.lecture(id)!.status, "ready");
  assert.equal(s.store.lecture(b)!.reused_from, a);
  assert.deepEqual(points(s.store.detail(b)!), MODEL_POINTS);
  assert.deepEqual(s.store.costs().filter(x => x.lecture_id === b), []);
});

test("the first fails, or is deleted, while the second waits: the second does the work itself", async t => {
  const s = setup(); t.after(() => s.close());
  const ann = await s.signIn("CODE-A"), ben = await s.signIn("CODE-B");
  /* Failed: the first transcription fails once the second is waiting. */
  let release!: () => void; const gate = new Promise<void>(r => { release = r; });
  const real = s.stt.transcribe.bind(s.stt); let n = 0;
  s.stt.transcribe = async (file: string) => { if (++n === 1) { await gate; throw new Error("elevenlabs replied 500: busy"); } return real(file); };
  const a = await uploadedLecture(s, ann, { bytes: SAME });
  await finish(s, ann, a);
  await until(() => n === 1);
  const b = await uploadedLecture(s, ben, { bytes: SAME });
  await finish(s, ben, b);
  await new Promise(r => setTimeout(r, 30));
  assert.equal(n, 1);
  release(); await s.pipeline.idle();
  assert.equal(s.store.lecture(a)!.status, "failed");
  assert.equal(s.store.lecture(b)!.status, "ready"); assert.equal(s.store.lecture(b)!.reused_from, null);
  assert.equal(n, 2);

  /* Deleted: the first is deleted while it is being transcribed. */
  s.stt.transcribe = real;
  let open!: () => void; s.stt.gate = new Promise(r => { open = r; });
  const other = SAME + "-week-10", c = await uploadedLecture(s, ann, { bytes: other });
  await finish(s, ann, c);
  await until(() => s.stt.calls === 2);
  const d = await uploadedLecture(s, ben, { bytes: other });
  await finish(s, ben, d);
  await new Promise(r => setTimeout(r, 30));
  assert.equal(s.stt.calls, 2);
  assert.equal((await s.call("DELETE", `/lectures/${c}`, { token: ann })).status, 204);
  open(); await s.pipeline.idle();
  assert.equal(s.store.lecture(c), undefined);
  const ld = s.store.lecture(d)!;
  assert.equal(ld.status, "ready", ld.error ?? ""); assert.equal(ld.reused_from, null);
  assert.equal(s.stt.calls, 3);
});

test("deleting the first student's lecture leaves the copies as they are; the next upload copies from a copy", async t => {
  const s = setup(); t.after(() => s.close());
  const ann = await s.signIn("CODE-A"), ben = await s.signIn("CODE-B");
  const a = await ready(s, ann, { bytes: SAME });
  const b = await ready(s, ben, { bytes: SAME });
  assert.equal(s.store.lecture(b)!.reused_from, a);
  assert.equal((await s.call("DELETE", `/lectures/${a}`, { token: ann })).status, 204);
  assert.equal(s.store.lecture(a), undefined); assert.equal(s.store.detail(a), null); assert.equal(s.store.transcript(a), null);

  const B = await get(s, ben, b);
  assert.equal(B.lecture.status, "ready");
  assert.deepEqual(points(DetailSchema.parse(B.detail)), MODEL_POINTS);
  assert.equal(B.detail.transcript.length, 3);
  assert.equal((await s.app.request(B.detail.audio.url)).status, 200, "Ben's recording still plays");
  assert.equal((await s.call("GET", "/home", { token: ben })).body.upcoming.length, 1);
  assert.equal((await s.call("PATCH", `/lectures/${b}/points`, { token: ben, json: { section: 0, index: 0, text: "Still mine." } })).status, 204);

  /* Ann uploads the same file again: copied from Ben's lecture, the model's notes and not Ben's edit. */
  const c = await ready(s, ann, { bytes: SAME });
  assert.equal(s.stt.calls, 1); assert.equal(s.notes.calls.length, 1);
  assert.equal(s.store.lecture(c)!.reused_from, b);
  assert.deepEqual(points(s.store.detail(c)!), MODEL_POINTS);
  /* The class keeps the id of the lecture transcribed for it, though that lecture is gone. */
  assert.deepEqual(recordings(s), [[a, a, "file", "none"], [b, a, "file", "notes"], [c, a, "file", "notes"]]);
  assert.deepEqual(classStats(s.store.classRecordings()).sizes, [[3, 1]]);
});

test("slides of one's own: the transcript is copied and the notes are written with the slides; notes written with slides are never copied", async t => {
  const s = setup(); t.after(() => s.close());
  const ann = await s.signIn("CODE-A"), ben = await s.signIn("CODE-B");
  const a = await ready(s, ann, { bytes: SAME, slides: true });
  assert.equal(s.store.originalNotes(a), null, "notes written with Ann's slides are not kept to copy");
  const b = await ready(s, ben, { bytes: SAME });
  assert.equal(s.stt.calls, 1); assert.equal(s.notes.calls.length, 2, "Ben's notes are written without Ann's slides");
  assert.deepEqual(s.notes.calls[1].input.slides, []);
  assert.deepEqual(s.store.detail(b)!.slides, []);
  assert.equal(s.store.lecture(b)!.reused_from, a);
  await ready(s, ann, { bytes: SAME, slides: true });
  assert.equal(s.stt.calls, 1); assert.equal(s.notes.calls.length, 3);
  assert.equal(s.notes.calls[2].input.slides.length, 2, "written with this lecture's slides");
  const d = await ready(s, ben, { bytes: SAME });
  assert.equal(s.notes.calls.length, 3, "Ben's notes without slides are copied");
  assert.equal(s.store.lecture(d)!.reused_from, b, "from a lecture whose notes can be copied");
  assert.deepEqual(recordings(s).map(r => r[3]), ["none", "transcript", "transcript", "notes"]);
  assert.deepEqual(classStats(s.store.classRecordings()), { lectures: 4, matchable: 4, merged: 3, notesCopied: 1, classes: 1, sizes: [[4, 1]] });
});

test("linkKey: the YouTube video from any form of its link; nothing else is matched", () => {
  for (const u of ["https://www.youtube.com/watch?v=dQw4w9WgXcQ", "https://youtube.com/watch?v=dQw4w9WgXcQ&t=42s&list=PL1", "http://m.youtube.com/watch?feature=share&v=dQw4w9WgXcQ",
    "https://music.youtube.com/watch?v=dQw4w9WgXcQ", "https://youtu.be/dQw4w9WgXcQ?si=abc", "https://www.youtube.com/shorts/dQw4w9WgXcQ",
    "https://www.youtube.com/live/dQw4w9WgXcQ?feature=shared", "https://www.youtube.com/embed/dQw4w9WgXcQ", "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
    "  https://WWW.YouTube.com/watch?v=dQw4w9WgXcQ  "]) assert.equal(linkKey(u), "youtube:dQw4w9WgXcQ", u);
  assert.equal(linkKey("https://youtu.be/DQW4W9WGXCQ"), "youtube:DQW4W9WGXCQ", "ids are case-sensitive: another video");
  for (const u of ["https://www.youtube.com/watch?v=lecture9", "https://www.youtube.com/playlist?list=PL1", "https://www.youtube.com/clip/UgkxAbCdEfGhIjKl",
    "https://www.youtube.com/@channel", "https://www.youtube.com/watch", "https://vimeo.com/123456", "https://drive.google.com/file/d/abc/view",
    "https://example.com/watch?v=dQw4w9WgXcQ", "https://youtube.com.example.net/watch?v=dQw4w9WgXcQ", "https://notyoutube.com/watch?v=dQw4w9WgXcQ",
    "ftp://youtu.be/dQw4w9WgXcQ", "not a link"]) assert.equal(linkKey(u), null, u);
});
