/* Phase 3: review packs (GET and POST /courses/:id/review-pack, INTEGRATION.md 3.3). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { ErrorReplySchema, ReviewPackSchema } from "../src/shapes";
import { readyLecture, setup } from "./helpers";

type S = ReturnType<typeof setup>;
const hold = (s: S) => { let open!: () => void; s.notes.gate = new Promise(r => { open = r; }); return () => { s.notes.gate = null; open(); }; };
const getPack = async (s: S, token: string, course: string) => { const r = await s.call("GET", `/courses/${course}/review-pack`, { token }); assert.equal(r.status, 200, r.text); return ReviewPackSchema.parse(r.body); };
async function twoLectures(s: S, token: string) {
  const a = await readyLecture(s, token, { title: "Week 9" }), course = s.store.lecture(a)!.course_id;
  const b = await readyLecture(s, token, { courseId: course, title: "Week 10" });
  return { a, b, course };
}

test("review pack: none, processing, then ready: the flagged items, a sheet of the student's own points by topic, a mock exam", async t => {
  const s = setup(); t.after(() => s.close());
  const token = await s.signIn();
  const { a, b, course } = await twoLectures(s, token);
  await s.call("PATCH", `/lectures/${a}/points`, { token, json: { section: 1, index: 0, text: "Edited before the pack." } });
  assert.deepEqual(await getPack(s, token, course), { status: "none" });

  const release = hold(s);
  assert.deepEqual((await s.call("POST", `/courses/${course}/review-pack`, { token })).body, { status: "processing" });
  assert.deepEqual(await getPack(s, token, course), { status: "processing" });
  assert.deepEqual((await s.call("POST", `/courses/${course}/review-pack`, { token })).body, { status: "processing" });   // not made twice
  release(); await s.packs.idle();
  assert.equal(s.notes.packCalls.length, 1);
  /* The model sees every point, numbered across the course, lectures in the order they were taught. */
  const input = s.notes.packCalls[0].input;
  assert.deepEqual(input.lectures.map(l => [l.n, l.title, l.sections.flatMap(x => x.points.map(p => [p.id, p.t, p.text]))]), [
    [1, "Week 9", [[1, 18, "The midterm is on 26 November."], [2, 252, "Edited before the pack."]]],
    [2, "Week 10", [[3, 18, "The midterm is on 26 November."], [4, 252, "Opportunity cost is the next best thing you give up."]]]
  ]);

  const pack = await getPack(s, token, course);
  assert.equal(pack.status, "ready");
  if (pack.status !== "ready") return;
  assert.deepEqual(pack.hints, [
    { t: 18, kind: "Midterm", text: "Midterm on 26 November, chapters 1 to 5.", lecture: "Week 9", lectureId: a },
    { t: 18, kind: "Midterm", text: "Midterm on 26 November, chapters 1 to 5.", lecture: "Week 10", lectureId: b }
  ]);
  assert.deepEqual(pack.sheet.map(x => [x.topic, x.points.map(p => [p.text, p.t, p.off, p.lecture, p.lectureId])]), [
    ["Topic of Week 9", [["The midterm is on 26 November.", 18, false, "Week 9", a], ["Edited before the pack.", 252, false, "Week 9", a]]],
    ["Topic of Week 10", [["The midterm is on 26 November.", 18, false, "Week 10", b], ["Opportunity cost is the next best thing you give up.", 252, false, "Week 10", b]]]
  ]);
  assert.deepEqual(pack.exam, [{ q: "Which is the opportunity cost?", opts: ["The price", "The next best alternative", "A sunk cost", "A tax"], a: 1, why: "It is what you give up.", t: 252, lectureId: a }]);
  /* A renamed lecture shows its new name. The call is in the cost log, under the course. */
  await s.call("PATCH", `/lectures/${a}`, { token, json: { title: "Week 9: costs" } });
  const renamed = await getPack(s, token, course);
  assert.equal(renamed.status === "ready" && renamed.hints[0].lecture, "Week 9: costs");
  assert.deepEqual(s.store.costs().filter(c => c.stage === "pack").map(c => [c.lecture_id, c.model]), [[course, "stub-notes-1"]]);

  /* Someone else's course does not exist. */
  const other = await s.signIn("CODE-B");
  for (const m of ["GET", "POST"]) assert.equal((await s.call(m, `/courses/${course}/review-pack`, { token: other })).status, 404);
});

test("review pack: once the course's lectures change (added, moved away, deleted) it is none, and can be made again", async t => {
  const s = setup(); t.after(() => s.close());
  const token = await s.signIn();
  const { a, b, course } = await twoLectures(s, token);
  const make = async () => { await s.call("POST", `/courses/${course}/review-pack`, { token }); await s.packs.idle(); assert.equal((await getPack(s, token, course)).status, "ready"); };
  await make();
  /* A lecture still being written does not count until it has notes. */
  const c = (await s.call("POST", "/lectures", { token, json: { courseId: course, title: "Week 11", language: "en", source: "upload" } })).body.id;
  assert.equal((await getPack(s, token, course)).status, "ready");
  await s.call("DELETE", `/lectures/${c}`, { token });
  await readyLecture(s, token, { courseId: course, title: "Week 11" });
  assert.deepEqual(await getPack(s, token, course), { status: "none" });
  await make();
  const other = (await s.call("POST", "/courses", { token, json: { code: "COMP 1021" } })).body.id;
  await s.call("PATCH", `/lectures/${b}`, { token, json: { course: other } });
  assert.deepEqual(await getPack(s, token, course), { status: "none" });
  await make();
  await s.call("DELETE", `/lectures/${a}`, { token });
  assert.deepEqual(await getPack(s, token, course), { status: "none" });
  assert.equal(s.notes.packCalls.length, 3);
});

test("review pack: a pack that cannot be made is a 502 once, then none; replies are read leniently and the exam falls back to the quizzes", async t => {
  const s = setup(); t.after(() => s.close());
  const token = await s.signIn();
  const { a, course } = await twoLectures(s, token);
  s.notes.packReplies = ["not JSON", JSON.stringify({ sheet: [{ topic: "X", points: [99] }] })];
  await s.call("POST", `/courses/${course}/review-pack`, { token }); await s.packs.idle();
  assert.match(s.notes.packCalls[1].repair!.problem, /not valid JSON/);
  const failed = await s.call("GET", `/courses/${course}/review-pack`, { token });
  assert.equal(failed.status, 502); assert.equal(ErrorReplySchema.parse(failed.body).message, "Hal could not make the review pack just now. Try again in a moment.");
  assert.deepEqual(await getPack(s, token, course), { status: "none" });
  /* The model's service failing is the same (no second call: deepseek.ts already retries what the service refused). */
  s.notes.packReplies = [new Error("DeepSeek 503")];
  await s.call("POST", `/courses/${course}/review-pack`, { token }); await s.packs.idle();
  assert.equal((await s.call("GET", `/courses/${course}/review-pack`, { token })).status, 502);

  /* Numbers as strings, unknown and repeated points skipped, empty topics dropped; no usable question: the quizzes. */
  s.notes.packReplies = [JSON.stringify({
    sheet: [{ topic: "Costs", points: ["2", 2, 99, 4] }, { topic: "Nothing", points: [77] }, { points: [1] }],
    exam: [{ q: "No options", opts: [], a: 0, lecture: 1 }, { q: "Bad lecture", opts: ["a", "b"], a: 0, lecture: 9 }]
  })];
  await s.call("POST", `/courses/${course}/review-pack`, { token }); await s.packs.idle();
  const pack = await getPack(s, token, course);
  assert.equal(pack.status, "ready"); if (pack.status !== "ready") return;
  assert.deepEqual(pack.sheet.map(x => [x.topic, x.points.map(p => p.text)]), [
    ["Costs", ["Opportunity cost is the next best thing you give up.", "Opportunity cost is the next best thing you give up."]], ["Topic", ["The midterm is on 26 November."]]
  ]);
  assert.deepEqual(pack.exam.map(q => [q.q, q.lectureId]), [["Opportunity cost is...", a], ["Opportunity cost is...", s.store.courseLectures(course)[1].id]]);
  assert.equal(s.store.costs().filter(c => c.stage === "pack").length, 4);
});

test("review pack: a course with no notes yet is ready at once and empty; a course deleted while its pack is made; a restart makes it again", async t => {
  const s = setup(); t.after(() => s.close());
  const token = await s.signIn();
  const empty = (await s.call("POST", "/courses", { token, json: { code: "HIST 1001" } })).body.id;
  assert.deepEqual((await s.call("POST", `/courses/${empty}/review-pack`, { token })).body, { status: "ready" });
  assert.deepEqual(await getPack(s, token, empty), { status: "ready", hints: [], sheet: [], exam: [] });
  assert.equal(s.notes.packCalls.length, 0);

  const { course } = await twoLectures(s, token);
  let release = hold(s);
  await s.call("POST", `/courses/${course}/review-pack`, { token });
  assert.equal((await s.call("DELETE", `/courses/${course}`, { token })).status, 204);
  release(); await s.packs.idle();
  assert.equal(s.store.pack(course), undefined);

  const again = await twoLectures(s, token);
  release = hold(s);
  await s.call("POST", `/courses/${again.course}/review-pack`, { token });
  s.packs.stopAll(); release(); await s.packs.idle();
  assert.deepEqual(await getPack(s, token, again.course), { status: "processing" });
  s.packs.resume(); await s.packs.idle();
  assert.equal((await getPack(s, token, again.course)).status, "ready");
});
