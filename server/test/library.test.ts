/* Phase 3: renaming and moving a lecture, editing the notes, study progress, feedback, editing and deleting a course. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { ErrorReplySchema, HomeSchema, LectureReplySchema, PointSchema } from "../src/shapes";
import { chunkForm, fakeChunk, liveLecture, readyLecture, setup, uploadedLecture } from "./helpers";

const isError = (r: { body: unknown }) => ErrorReplySchema.parse(r.body);
const getDetail = async (s: ReturnType<typeof setup>, token: string, id: string) => LectureReplySchema.parse((await s.call("GET", `/lectures/${id}`, { token })).body).detail!;

test("PATCH /lectures/:id renames ({title}) and moves ({course}); the upcoming dates follow; checks both", async t => {
  const s = setup(); t.after(() => s.close());
  const token = await s.signIn(), other = await s.signIn("CODE-B");
  const id = await readyLecture(s, token);
  const to = (await s.call("POST", "/courses", { token, json: { code: "COMP 1021", name: "Intro to CS" } })).body;

  assert.equal((await s.call("PATCH", `/lectures/${id}`, { token, json: { title: "  Week 9: costs  " } })).status, 204);
  let home = HomeSchema.parse((await s.call("GET", "/home", { token })).body);
  assert.equal(home.lectures[0].title, "Week 9: costs");

  assert.equal((await s.call("PATCH", `/lectures/${id}`, { token, json: { course: to.id } })).status, 204);
  home = HomeSchema.parse((await s.call("GET", "/home", { token })).body);
  assert.equal(home.lectures[0].course, to.id);
  assert.deepEqual(home.upcoming.map(u => [u.lecture, u.course]), [[id, "COMP 1021"]]);
  /* The id, notes and recording stay. */
  const after = LectureReplySchema.parse((await s.call("GET", `/lectures/${id}`, { token })).body);
  assert.equal(after.lecture.id, id); assert.ok(after.detail!.audio!.url);

  for (const json of [{}, { title: "  " }, { title: "x".repeat(201) }]) { const r = await s.call("PATCH", `/lectures/${id}`, { token, json }); assert.equal(r.status, 400, JSON.stringify(json)); isError(r); }
  /* Someone else's course, or someone else's lecture, does not exist for this student. */
  const theirs = (await s.call("POST", "/courses", { token: other, json: { code: "X 1" } })).body;
  const bad = await s.call("PATCH", `/lectures/${id}`, { token, json: { course: theirs.id } });
  assert.equal(bad.status, 404); isError(bad);
  assert.equal(s.store.lecture(id)!.course_id, to.id);
  assert.equal((await s.call("PATCH", `/lectures/${id}`, { token: other, json: { title: "Mine now" } })).status, 404);
  assert.equal(s.store.lecture(id)!.title, "Week 9: costs");
});

test("editing the notes: change, add and delete points by section and place; the order and the rest stay", async t => {
  const s = setup(); t.after(() => s.close());
  const token = await s.signIn();
  const id = await readyLecture(s, token);
  const before = await getDetail(s, token, id);

  /* Changing a point changes its text only. */
  assert.equal((await s.call("PATCH", `/lectures/${id}/points`, { token, json: { section: 1, index: 0, text: " Opportunity cost: the next best alternative given up. " } })).status, 204);
  let d = await getDetail(s, token, id);
  assert.deepEqual(d.sections[1].points[0], { ...before.sections[1].points[0], text: "Opportunity cost: the next best alternative given up." });

  /* Adding returns the point the front end shows: no time, the student's own. It goes last in its section. */
  const added = await s.call("POST", `/lectures/${id}/points`, { token, json: { section: 0, text: "Bring a calculator." } });
  assert.equal(added.status, 200);
  assert.deepEqual(PointSchema.parse(added.body), { t: null, text: "Bring a calculator.", mine: true, off: false, slide: null });
  await s.call("POST", `/lectures/${id}/points`, { token, json: { section: 0, text: "Past papers are on the course page." } });
  d = await getDetail(s, token, id);
  assert.deepEqual(d.sections[0].points.map(p => p.text), ["The midterm is on 26 November.", "Bring a calculator.", "Past papers are on the course page."]);

  /* Deleting by place; a section with no points left stays, so the places of the others do not move. */
  assert.equal((await s.call("DELETE", `/lectures/${id}/points`, { token, json: { section: 0, index: 1 } })).status, 204);
  d = await getDetail(s, token, id);
  assert.deepEqual(d.sections[0].points.map(p => p.text), ["The midterm is on 26 November.", "Past papers are on the course page."]);
  await s.call("DELETE", `/lectures/${id}/points`, { token, json: { section: 1, index: 0 } });
  d = await getDetail(s, token, id);
  assert.equal(d.sections.length, 2); assert.deepEqual(d.sections[1].points, []);
  assert.equal(d.sections[1].title, "Opportunity cost");
  /* Everything else is untouched. */
  assert.deepEqual([d.transcript, d.flashcards, d.quiz, d.alerts], [before.transcript, before.flashcards, before.quiz, before.alerts]);

  /* A point that is not there: 404 with a message, nothing changes. */
  for (const [m, json] of [["PATCH", { section: 0, index: 5, text: "x" }], ["PATCH", { section: 9, index: 0, text: "x" }], ["POST", { section: 9, text: "x" }], ["DELETE", { section: 1, index: 0 }]] as const) {
    const r = await s.call(m, `/lectures/${id}/points`, { token, json });
    assert.equal(r.status, 404, `${m} ${JSON.stringify(json)}`); isError(r);
  }
  /* Bad input: 400. */
  for (const [m, json] of [["PATCH", { section: 0, index: 0, text: "  " }], ["PATCH", { section: "0", index: 0, text: "x" }], ["POST", { section: -1, text: "x" }],
    ["POST", { section: 0, text: "x".repeat(2001) }], ["DELETE", { section: 0, index: 1.5 }]] as const) {
    const r = await s.call(m, `/lectures/${id}/points`, { token, json });
    assert.equal(r.status, 400, `${m} ${JSON.stringify(json)}`); isError(r);
  }
  assert.deepEqual((await getDetail(s, token, id)).sections, d.sections);
  /* Someone else cannot edit them. */
  const other = await s.signIn("CODE-B");
  assert.equal((await s.call("POST", `/lectures/${id}/points`, { token: other, json: { section: 0, text: "spam" } })).status, 404);
});

test("editing the notes: 409 before the notes are written", async t => {
  const s = setup(); t.after(() => s.close());
  const token = await s.signIn();
  const id = await uploadedLecture(s, token);
  const r = await s.call("POST", `/lectures/${id}/points`, { token, json: { section: 0, text: "x" } });
  assert.equal(r.status, 409); assert.equal(isError(r).message, "This lecture has no notes yet.");
});

test("PUT /lectures/:id/progress: known cards come back in detail.progress; a null quiz score keeps the last one", async t => {
  const s = setup(); t.after(() => s.close());
  const token = await s.signIn();
  const id = await readyLecture(s, token);
  assert.equal((await getDetail(s, token, id)).progress, undefined);
  assert.equal((await s.call("PUT", `/lectures/${id}/progress`, { token, json: { known: [3, 0, 3], quizScore: 4 } })).status, 204);
  assert.deepEqual((await getDetail(s, token, id)).progress, { known: [0, 3] });
  await s.call("PUT", `/lectures/${id}/progress`, { token, json: { known: [0, 3, 5], quizScore: null } });
  assert.deepEqual((await getDetail(s, token, id)).progress, { known: [0, 3, 5] });
  assert.deepEqual(s.store.progress(id), { known: [0, 3, 5], quizScore: 4 });
  for (const json of [{ known: "0,1" }, { known: [-1] }, { known: [0.5] }, { known: [0], quizScore: "7" }, { known: [0], quizScore: -1 }]) {
    const r = await s.call("PUT", `/lectures/${id}/progress`, { token, json });
    assert.equal(r.status, 400, JSON.stringify(json)); isError(r);
  }
  const other = await s.signIn("CODE-B");
  assert.equal((await s.call("PUT", `/lectures/${id}/progress`, { token: other, json: { known: [] } })).status, 404);
});

test("POST /lectures/:id/feedback is kept with the lecture and deleted with it", async t => {
  const s = setup(); t.after(() => s.close());
  const token = await s.signIn();
  const id = await readyLecture(s, token);
  assert.equal((await s.call("POST", `/lectures/${id}/feedback`, { token, json: { text: " The midterm is on the 27th, not the 26th. " } })).status, 204);
  assert.deepEqual(s.store.feedback().map(f => [f.lecture_id, f.text, f.title, f.course_code, f.user_name]), [[id, "The midterm is on the 27th, not the 26th.", "Week 9", "ECON 1001", "Ann"]]);
  for (const json of [{ text: " " }, { text: "x".repeat(4001) }]) assert.equal((await s.call("POST", `/lectures/${id}/feedback`, { token, json })).status, 400);
  await s.call("DELETE", `/lectures/${id}`, { token });
  assert.deepEqual(s.store.feedback(), []);
});

test("PATCH /courses/:id changes the code and name; the upcoming dates show the new code; checks like adding a course", async t => {
  const s = setup(); t.after(() => s.close());
  const token = await s.signIn();
  const id = await readyLecture(s, token), course = s.store.lecture(id)!.course_id;
  assert.equal((await s.call("PATCH", `/courses/${course}`, { token, json: { code: "ECON 1002", name: "" } })).status, 204);
  const home = HomeSchema.parse((await s.call("GET", "/home", { token })).body);
  assert.deepEqual(home.courses.map(c => [c.id, c.code, c.name]), [[course, "ECON 1002", ""]]);
  assert.equal(home.upcoming[0].course, "ECON 1002");
  for (const json of [{ code: "", name: "a" }, { code: "x".repeat(21), name: "" }, { code: "OK", name: "n".repeat(81) }]) {
    const r = await s.call("PATCH", `/courses/${course}`, { token, json }); assert.equal(r.status, 400); isError(r);
  }
  const other = await s.signIn("CODE-B");
  assert.equal((await s.call("PATCH", `/courses/${course}`, { token: other, json: { code: "HACK" } })).status, 404);
  assert.equal(s.store.courseById(course)!.code, "ECON 1002");
});

test("DELETE /courses/:id deletes its lectures with their files, notes and shared links; other courses stay", async t => {
  const s = setup(); t.after(() => s.close());
  const token = await s.signIn();
  const a = await readyLecture(s, token), course = s.store.lecture(a)!.course_id;
  const b = await readyLecture(s, token, { courseId: course, title: "Week 10" });
  const keep = await readyLecture(s, token, { title: "Other course" });
  const share = (await s.call("POST", `/lectures/${a}/share`, { token })).body.url as string;
  await s.call("PUT", `/lectures/${a}/progress`, { token, json: { known: [0], quizScore: 1 } });
  await s.call("POST", `/courses/${course}/review-pack`, { token }); await s.packs.idle();

  const other = await s.signIn("CODE-B");
  assert.equal((await s.call("DELETE", `/courses/${course}`, { token: other })).status, 404);
  assert.equal((await s.call("DELETE", `/courses/${course}`, { token })).status, 204);
  const home = HomeSchema.parse((await s.call("GET", "/home", { token })).body);
  assert.deepEqual(home.lectures.map(l => l.id), [keep]);
  assert.deepEqual(home.upcoming.map(u => u.lecture), [keep]);
  for (const id of [a, b]) { assert.equal(s.store.lecture(id), undefined); assert.equal(s.files.exists(id, "audio.m4a"), false); assert.equal(s.store.detail(id), null); }
  assert.equal((await s.call("GET", `/shared/${share.split("/").pop()}`)).status, 404);
  assert.equal(s.store.pack(course), undefined);
  assert.equal(s.store.progress(a), null);
  assert.equal((await s.call("GET", `/courses/${course}/review-pack`, { token })).status, 404);
});

test("DELETE /courses/:id is refused (409) while one of its lectures is being recorded", async t => {
  const s = setup(); t.after(() => s.close());
  const token = await s.signIn();
  const id = await liveLecture(s, token), course = s.store.lecture(id)!.course_id;
  assert.equal((await s.call("POST", `/lectures/${id}/chunks`, { token, body: chunkForm(fakeChunk(), 0) })).status, 200);
  const r = await s.call("DELETE", `/courses/${course}`, { token });
  assert.equal(r.status, 409); assert.match(isError(r).message, /being recorded/);
  /* A recording that stopped long ago (the page was closed) does not hold the course. */
  s.store.db.prepare("UPDATE chunks SET created_at = ?").run(new Date(Date.now() - 10 * 60_000).toISOString());
  assert.equal((await s.call("DELETE", `/courses/${course}`, { token })).status, 204);
  assert.equal(s.store.lecture(id), undefined);
});
