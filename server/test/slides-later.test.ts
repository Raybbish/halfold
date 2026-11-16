/* Phase 3: slides sent after the notes were written (API-CHANGES.md section 3). The lecture is processing before the
   reply; the points are placed under the slides without writing the notes again; if that fails, the lecture is ready
   again with the notes as they were and no slides. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { ErrorReplySchema, LectureReplySchema } from "../src/shapes";
import { fileForm, readyLecture, setup } from "./helpers";

const pdf = () => fileForm("%PDF-1.4 fake", "slides.pdf");
const hold = (s: ReturnType<typeof setup>) => { let open!: () => void; s.notes.gate = new Promise(r => { open = r; }); return () => { s.notes.gate = null; open(); }; };

test("slides after the notes: processing before the reply, then every point under its slide; text, order, edits and the student's own points stay", async t => {
  const s = setup(); t.after(() => s.close());
  const token = await s.signIn();
  const id = await readyLecture(s, token);
  await s.call("PATCH", `/lectures/${id}/points`, { token, json: { section: 1, index: 0, text: "Edited: the next best alternative." } });
  await s.call("POST", `/lectures/${id}/points`, { token, json: { section: 0, text: "My own note." } });
  const before = s.store.detail(id)!;
  assert.deepEqual(before.slides, []);

  const release = hold(s);
  assert.equal((await s.call("POST", `/lectures/${id}/slides`, { token, body: pdf() })).status, 204);
  /* Processing before the reply, so the front end's first poll does not read "ready". The notes are still there to read. */
  assert.deepEqual((await s.call("GET", `/lectures/${id}/status`, { token })).body, { status: "processing" });
  const during = LectureReplySchema.parse((await s.call("GET", `/lectures/${id}`, { token })).body);
  assert.equal(during.lecture.status, "processing"); assert.deepEqual(during.detail!.sections, before.sections);
  /* Edits and more slides wait until it is done. */
  const edit = await s.call("PATCH", `/lectures/${id}/points`, { token, json: { section: 0, index: 0, text: "x" } });
  assert.equal(edit.status, 409); assert.equal(ErrorReplySchema.parse(edit.body).message, "Hal is putting the notes under the slides. Try again in a minute.");
  assert.equal((await s.call("POST", `/lectures/${id}/slides`, { token, body: pdf() })).status, 409);
  release();
  await s.pipeline.idle();

  const after = LectureReplySchema.parse((await s.call("GET", `/lectures/${id}`, { token })).body);
  assert.equal(after.lecture.status, "ready");
  const d = after.detail!;
  assert.deepEqual(d.slides, [{ n: 1, title: "Page 1", image: null }, { n: 2, title: "Page 2", image: null }]);
  /* The model was asked about the lecturer's points only (numbered 1, 2), with the student's edits. */
  assert.deepEqual(s.notes.slideCalls[0].input.sections.map(x => x.points), [[{ id: 1, text: "The midterm is on 26 November." }], [{ id: 2, text: "Edited: the next best alternative." }]]);
  assert.deepEqual(d.sections.map(x => [x.title, x.slides, x.points.map(p => [p.text, p.slide, p.off])]), [
    ["Admin", "Slide 1", [["The midterm is on 26 November.", 1, false], ["My own note.", null, false]]],
    ["Opportunity cost", "Slide 2", [["Edited: the next best alternative.", 2, true]]]
  ]);
  assert.deepEqual(d.sections[0].points[1], { t: null, text: "My own note.", mine: true, off: false, slide: null });
  assert.equal(d.sections[0].points[0].zhHant, before.sections[0].points[0].zhHant);
  assert.deepEqual([d.transcript, d.flashcards, d.quiz, d.alerts], [before.transcript, before.flashcards, before.quiz, before.alerts]);
  /* Not transcribed or written again; the call is in the cost log. */
  assert.equal(s.stt.calls, 1); assert.equal(s.notes.calls.length, 1); assert.equal(s.notes.slideCalls.length, 1);
  assert.deepEqual(s.store.costs().filter(c => c.lecture_id === id).map(c => c.stage), ["stt", "notes", "slides"]);
  /* Slides are there now: the front end no longer offers to add them, and the backend refuses. */
  const twice = await s.call("POST", `/lectures/${id}/slides`, { token, body: pdf() });
  assert.equal(twice.status, 409); assert.equal(twice.body.message, "This lecture already has slides.");
});

test("slides after the notes that cannot be used: ready again, notes as they were, no slides; adding them again works", async t => {
  const s = setup(); t.after(() => s.close());
  const token = await s.signIn();
  const id = await readyLecture(s, token);
  const before = s.store.detail(id)!;
  /* Two replies that cannot be used: the second call shows the model its first reply and what was wrong. */
  s.notes.slideReplies = ["this is not JSON", JSON.stringify({ points: [{ id: 99, slide: 1, off: false }] })];
  await s.call("POST", `/lectures/${id}/slides`, { token, body: pdf() });
  await s.pipeline.idle();
  assert.equal(s.notes.slideCalls.length, 2); assert.match(s.notes.slideCalls[1].repair!.problem, /not valid JSON/);
  const l = s.store.lecture(id)!;
  assert.equal(l.status, "ready"); assert.equal(l.has_slides, 0); assert.match(l.error!, /did not place the points/);
  assert.deepEqual(s.store.detail(id), before);
  assert.equal(s.files.exists(id, "slides.pdf"), false);
  assert.deepEqual(LectureReplySchema.parse((await s.call("GET", `/lectures/${id}`, { token })).body).detail!.slides, []);

  await s.call("POST", `/lectures/${id}/slides`, { token, body: pdf() });
  await s.pipeline.idle();
  assert.equal(s.store.detail(id)!.slides.length, 2);
});

test("slides after the notes that cannot be read: the model is not asked; the notes stay", async t => {
  const s = setup({ slides: async () => { throw new Error("password protected"); } }); t.after(() => s.close());
  const token = await s.signIn();
  const id = await readyLecture(s, token);
  await s.call("POST", `/lectures/${id}/slides`, { token, body: pdf() });
  await s.pipeline.idle();
  assert.equal(s.notes.slideCalls.length, 0);
  assert.equal(s.store.lecture(id)!.status, "ready"); assert.match(s.store.lecture(id)!.error!, /could not be read: password protected/);
  assert.deepEqual(s.store.detail(id)!.slides, []);
});

test("slides after the notes: deleted while matching, nothing comes back; stopped by a restart, matched again (not transcribed again)", async t => {
  const s = setup(); t.after(() => s.close());
  const token = await s.signIn();
  const gone = await readyLecture(s, token), kept = await readyLecture(s, token);
  let release = hold(s);
  await s.call("POST", `/lectures/${gone}/slides`, { token, body: pdf() });
  await s.call("DELETE", `/lectures/${gone}`, { token });
  release(); await s.pipeline.idle();
  assert.equal(s.store.lecture(gone), undefined); assert.equal(s.files.exists(gone, "slides.pdf"), false);

  release = hold(s);
  await s.call("POST", `/lectures/${kept}/slides`, { token, body: pdf() });
  s.pipeline.stopAll();
  release(); await s.pipeline.idle();
  assert.equal(s.store.lecture(kept)!.status, "processing");
  s.pipeline.resume(); await s.pipeline.idle();
  assert.equal(s.store.lecture(kept)!.status, "ready");
  assert.equal(s.store.detail(kept)!.slides.length, 2);
  assert.equal(s.stt.calls, 2); assert.equal(s.notes.calls.length, 2);   // one each for the two lectures, at the start
});
