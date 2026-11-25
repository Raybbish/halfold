/* A study pack made from a slide deck alone, with no recording (source "slides", notes/slidesPack.ts): created without
   counting against the month's lectures, the PDF read, the pack written with no times, alerts, transcript or "off"
   points; a pack that cannot be written keeps its file; a recording added later turns it into an upload whose notes
   are written again with the slides. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { HomeSchema, LectureReplySchema, LectureSchema } from "../src/shapes";
import { packInput, packPrompt, readPack } from "../src/notes/pack";
import { slidesPackPrompt } from "../src/notes/slidesPack";
import { FAKE_AUDIO, fileForm, setup, uploadedLecture, type TestServer } from "./helpers";

const pdf = () => fileForm("%PDF-1.4 fake", "week10-slides.pdf");
const recording = () => fileForm(FAKE_AUDIO + "-bytes", "week10.mp3");

/* A course and a lecture of source "slides" with its PDF sent; finish starts the pack unless told not to. */
async function slidesLecture(s: TestServer, token: string, o: { finish?: boolean; title?: string; autoTitle?: boolean; language?: string } = {}) {
  const course = (await s.call("POST", "/courses", { token, json: { code: "ECON 1001", name: "Microeconomics" } })).body;
  const r = await s.call("POST", "/lectures", { token, json: { courseId: course.id, title: o.title ?? "Week 10", language: o.language ?? "en", source: "slides", ...(o.autoTitle ? { autoTitle: true } : {}) } });
  assert.equal(r.status, 200, r.text);
  const id = LectureSchema.parse(r.body).id;
  assert.equal((await s.call("POST", `/lectures/${id}/slides`, { token, body: pdf() })).status, 204);
  if (o.finish !== false) {
    assert.deepEqual((await s.call("POST", `/lectures/${id}/finish`, { token, json: { duration: 0 } })).body, { status: "processing" });
    await s.pipeline.idle();
  }
  return { id, courseId: course.id as string };
}
const lectureReply = async (s: TestServer, token: string, id: string) => LectureReplySchema.parse((await s.call("GET", `/lectures/${id}`, { token })).body);
const usage = async (s: TestServer, token: string) => HomeSchema.parse((await s.call("GET", "/home", { token })).body).usage!;

test("a study pack from slides alone: not one of the month's lectures, the PDF read, the pack written with no times, alerts, transcript or off points", async t => {
  const s = setup({ plans: p => { p.plans[0].lecturesPerMonth = 1; } }); t.after(() => s.close());
  const token = await s.signIn();
  const { id, courseId } = await slidesLecture(s, token, { title: "Lecture, Tue 24 Nov, 10:00", autoTitle: true, language: "en-yue" });

  const r = await lectureReply(s, token, id);
  assert.equal(r.lecture.status, "ready"); assert.equal(r.lecture.source, "slides"); assert.equal(r.lecture.duration, undefined);
  assert.equal(r.lecture.title, "Opportunity cost from the slides");   // the dated title the front end filled in gives way to the model's
  const d = r.detail!;
  assert.equal(d.kind, "slides");
  assert.deepEqual([d.alerts, d.transcript, d.progress], [[], [], undefined]);
  assert.deepEqual(d.slides, [{ n: 1, title: "Page 1", image: null }, { n: 2, title: "Page 2", image: null }]);
  assert.deepEqual(d.sections.map(x => [x.title, x.slides, x.start, x.end]), [["Page 1", "Slide 1", 0, 0], ["Page 2", "Slide 2", 0, 0]]);
  assert.deepEqual(d.sections[0].points[0], { t: null, text: "Slide 1 explained: Course admin", zhHant: "第 1 頁的解釋。", zhHans: "第 1 页的解释。", off: false, slide: 1 });
  assert.ok(d.sections.flatMap(x => x.points).every(p => p.t === null && p.off === false && p.slide && !p.mine));
  assert.deepEqual(d.quiz.map(q => q.t), [null]); assert.equal(d.flashcards.length, 1); assert.deepEqual(d.summary, ["Opportunity cost is the next best alternative given up."]);

  /* Read from the PDF; nothing transcribed or converted, and the call is in the cost log under its own stage. */
  assert.deepEqual(s.notes.slidesPackCalls[0].input, { courseCode: "ECON 1001", courseName: "Microeconomics", title: "Lecture, Tue 24 Nov, 10:00", zh: true,
    slides: [{ n: 1, text: "Course admin\nMidterm" }, { n: 2, text: "Opportunity cost\nThe value of the next best alternative" }] });
  assert.equal(s.stt.calls, 0); assert.equal(s.notes.calls.length, 0);
  const costs = s.store.costs().filter(c => c.lecture_id === id);
  assert.deepEqual(costs.map(c => [c.stage, c.provider]), [["slides-pack", "stub-notes"]]);
  assert.equal(JSON.parse(costs[0].meta_json!).slidePages, 2); assert.ok(costs[0].usd! > 0);
  assert.deepEqual(s.store.upcoming(s.store.userByCode("CODE-A")!.id, "2000-01-01"), []);
  assert.equal(s.files.exists(id, "slides.pdf"), true);

  /* Free of the plan's lecture limit (1 a month here): the pack did not count, so a recorded lecture can still be made, and then no more. */
  assert.equal((await usage(s, token)).lecturesThisMonth, 0);
  const lec = await s.call("POST", "/lectures", { token, json: { courseId, title: "Week 10 recording", language: "en", source: "upload" } });
  assert.equal(lec.status, 200, lec.text);
  assert.equal((await s.call("POST", "/lectures", { token, json: { courseId, title: "Week 11", language: "en", source: "upload" } })).status, 429);
  const another = await s.call("POST", "/lectures", { token, json: { courseId, title: "Week 11 slides", language: "en", source: "slides" } });
  assert.equal(another.status, 200, "packs are not refused when the month's lectures are used up");
});

test("the slides-only prompt has the deck and asks for explanations, not what was said; the review pack labels its points by slide", async t => {
  const input = { courseCode: "ECON 1001", courseName: "Micro", title: "Week 10", zh: false, slides: [{ n: 1, text: "Opportunity cost" }, { n: 2, text: "" }] };
  const p = slidesPackPrompt(input);
  assert.match(p.user, /--- Slide 1 ---\nOpportunity cost\n--- Slide 2 ---\n\(no text\)/);
  assert.match(p.system, /no recording of the class/); assert.match(p.system, /do not add to it/);
  assert.doesNotMatch(p.system + p.user, /TRANSCRIPT|"t":|"off"|"alerts"|"zh"/);
  assert.match(slidesPackPrompt({ ...input, zh: true }).system, /"zhHans" and "zhHant" on each point[\s\S]*"zhHans": Simplified Chinese as written in mainland China[\s\S]*Never make one by changing the characters of the other/);

  const s = setup(); t.after(() => s.close());
  const token = await s.signIn(), { id } = await slidesLecture(s, token);
  const { input: packIn } = packInput({ code: "ECON 1001", name: "" }, [{ id, title: "Week 10", date: "24 Nov", duration: 0, detail: s.store.detail(id)! }]);
  assert.match(packPrompt(packIn).user, /\[1\] \(slide 1\) Slide 1 explained/);
  assert.doesNotMatch(packPrompt(packIn).user, /added by the student/);
  const { ctx } = packInput({ code: "ECON 1001", name: "" }, [{ id, title: "Week 10", date: "24 Nov", duration: 0, detail: s.store.detail(id)! }]);
  const read = readPack(JSON.stringify({ sheet: [{ topic: "Cost", points: [1, 2] }], exam: [{ q: "Q?", opts: ["a", "b", "c", "d"], a: 1, lecture: 1, t: 30 }] }), ctx);
  assert.deepEqual([read.sheet[0].points.map(p => p.t), read.exam[0].t], [[null, null], null]);   // no times from a pack, not even 0:00
});

test("a study pack needs its slide deck: finish without one is refused", async t => {
  const s = setup(); t.after(() => s.close());
  const token = await s.signIn();
  const course = (await s.call("POST", "/courses", { token, json: { code: "ECON 1001" } })).body;
  const id = (await s.call("POST", "/lectures", { token, json: { courseId: course.id, title: "W", language: "en", source: "slides" } })).body.id;
  const r = await s.call("POST", `/lectures/${id}/finish`, { token, json: { duration: 0 } });
  assert.equal(r.status, 409); assert.equal(r.body.message, "Add the slide deck first. A study pack is made from the slides.");
  assert.equal((await s.call("POST", `/lectures/${id}/slides`, { token, body: fileForm("not a pdf", "x.pdf") })).status, 415);
  assert.equal(s.store.lecture(id)!.status, "recording");
});

test("a study pack that cannot be written: failed, the slide file kept, and Try again reads it again", async t => {
  const s = setup(); t.after(() => s.close());
  const token = await s.signIn();
  /* Two replies that cannot be used: the second call shows the model its first reply and what was wrong. */
  s.notes.slidesPackReplies = ["this is not JSON", JSON.stringify({ sections: [{ title: "Empty", points: [{ slide: 1 }] }] })];
  const { id } = await slidesLecture(s, token);
  assert.equal(s.notes.slidesPackCalls.length, 2); assert.match(s.notes.slidesPackCalls[1].repair!.problem, /not valid JSON/);
  const l = s.store.lecture(id)!;
  assert.equal(l.status, "failed"); assert.match(l.error!, /did not write a usable study pack: it has no sections with points/);
  assert.equal(s.files.exists(id, "slides.pdf"), true);
  assert.equal((await lectureReply(s, token, id)).detail, null);
  assert.deepEqual(s.store.costs().filter(c => c.lecture_id === id).map(c => c.stage), ["slides-pack", "slides-pack"]);

  assert.deepEqual((await s.call("POST", `/lectures/${id}/retry`, { token })).body, { status: "processing" });
  await s.pipeline.idle();
  assert.equal(s.store.lecture(id)!.status, "ready"); assert.equal(s.store.detail(id)!.kind, "slides");
});

test("slides that cannot be read, or have no text: failed without asking the model, the file kept", async t => {
  for (const [slides, why] of [[async () => { throw new Error("password protected"); }, /could not be read: password protected/],
    [async () => [{ n: 1, text: "" }, { n: 2, text: "" }], /have no text to read/]] as const) {
    const s = setup({ slides }); t.after(() => s.close());
    const token = await s.signIn(), { id } = await slidesLecture(s, token);
    const l = s.store.lecture(id)!;
    assert.equal(l.status, "failed"); assert.match(l.error!, why);
    assert.equal(s.notes.slidesPackCalls.length, 0); assert.equal(s.files.exists(id, "slides.pdf"), true);
  }
});

test("adding a recording to a study pack: an upload from then on, counted, and the notes are written again with the slides", async t => {
  const s = setup({ plans: p => { p.plans[0].lecturesPerMonth = 1; } }); t.after(() => s.close());
  const token = await s.signIn();
  const { id, courseId } = await slidesLecture(s, token);
  await s.call("PUT", `/lectures/${id}/progress`, { token, json: { known: [0], quizScore: 100 } });
  /* The notes call is held, to look at the lecture while they are written. */
  const release = (() => { let open!: () => void; s.notes.gate = new Promise(r => { open = r; }); return () => { s.notes.gate = null; open(); }; })();

  assert.equal((await s.call("POST", `/lectures/${id}/recording`, { token, body: recording() })).status, 204);
  /* Processing before the reply; the pack is no longer sent, so the page shows the notes being written. */
  const during = await lectureReply(s, token, id);
  assert.deepEqual([during.lecture.status, during.lecture.source, during.detail], ["processing", "upload", null]);
  assert.deepEqual((await s.call("POST", `/lectures/${id}/finish`, { token, json: { duration: 0 } })).body, { status: "processing" });
  assert.equal((await s.call("POST", `/lectures/${id}/recording`, { token, body: recording() })).status, 409);
  release(); await s.pipeline.idle();

  const after = await lectureReply(s, token, id);
  assert.equal(after.lecture.status, "ready"); assert.equal(after.lecture.duration, 600);
  const d = after.detail!;
  assert.equal(d.kind, undefined);
  assert.ok(d.transcript.length > 0 && d.alerts.length > 0);
  assert.deepEqual(d.slides.map(x => x.n), [1, 2]);
  assert.deepEqual(d.sections.flatMap(x => x.points).map(p => [p.t, p.slide, p.off]), [[18, 1, true], [252, 2, false]]);
  assert.equal(s.notes.calls.length, 1); assert.equal(s.notes.calls[0].input.slides.length, 2);   // the regular notes, with the slides
  assert.equal(s.stt.calls, 1);
  assert.deepEqual(d.progress, { known: [] });   // the flashcards were written again
  assert.deepEqual(s.store.costs().filter(c => c.lecture_id === id).map(c => c.stage), ["slides-pack", "stt", "notes"]);

  /* Now it is one of the month's lectures (1 here): another recorded lecture is refused. */
  assert.equal((await usage(s, token)).lecturesThisMonth, 1);
  assert.equal((await s.call("POST", "/lectures", { token, json: { courseId, title: "Week 11", language: "en", source: "upload" } })).status, 429);
});

test("adding a recording to a study pack: refused when the month's lectures are used up, or while the pack is being written", async t => {
  const s = setup({ plans: p => { p.plans[0].lecturesPerMonth = 1; } }); t.after(() => s.close());
  const token = await s.signIn();
  await uploadedLecture(s, token);   // the one lecture of the month (being uploaded counts)
  const { id } = await slidesLecture(s, token);
  const r = await s.call("POST", `/lectures/${id}/recording`, { token, body: recording() });
  assert.equal(r.status, 429); assert.match(r.body.message, /You have used the 1 lecture that Free includes this month/);
  assert.deepEqual([s.store.lecture(id)!.status, s.store.lecture(id)!.source, s.store.lecture(id)!.recording_file], ["ready", "slides", null]);
  assert.equal(s.files.exists(id, "recording"), false);
  assert.equal(s.store.detail(id)!.kind, "slides");

  const s2 = setup(); t.after(() => s2.close());
  const token2 = await s2.signIn();
  let open!: () => void; s2.notes.gate = new Promise(r2 => { open = r2; });
  const { id: busy } = await slidesLecture(s2, token2, { finish: false });
  await s2.call("POST", `/lectures/${busy}/finish`, { token: token2, json: {} });
  const refused = await s2.call("POST", `/lectures/${busy}/recording`, { token: token2, body: recording() });
  assert.equal(refused.status, 409); assert.equal(refused.body.message, "Hal is still reading the slides. Add the recording when the study pack is ready.");
  s2.notes.gate = null; open(); await s2.pipeline.idle();
});

test("a recording added to a pack that failed, or before the pack was made, gives regular notes with the slides", async t => {
  const s = setup(); t.after(() => s.close());
  const token = await s.signIn();
  s.notes.slidesPackReplies = [new Error("model down")];
  const { id: failed } = await slidesLecture(s, token);
  assert.equal(s.store.lecture(failed)!.status, "failed");
  assert.equal((await s.call("POST", `/lectures/${failed}/recording`, { token, body: recording() })).status, 204);
  await s.pipeline.idle();
  assert.equal(s.store.lecture(failed)!.status, "ready"); assert.equal(s.store.lecture(failed)!.source, "upload");
  assert.equal(s.store.detail(failed)!.slides.length, 2); assert.equal(s.store.detail(failed)!.kind, undefined);

  /* Before the pack: the slides are in but the lecture was never finished. It is an ordinary upload from here. */
  const { id: early } = await slidesLecture(s, token, { finish: false });
  assert.equal((await s.call("POST", `/lectures/${early}/recording`, { token, body: recording() })).status, 204);
  assert.deepEqual([s.store.lecture(early)!.status, s.store.lecture(early)!.source], ["recording", "upload"]);
  assert.deepEqual((await s.call("POST", `/lectures/${early}/finish`, { token, json: { duration: 0 } })).body, { status: "processing" });
  await s.pipeline.idle();
  assert.equal(s.store.lecture(early)!.status, "ready"); assert.equal(s.store.detail(early)!.slides.length, 2);
  assert.equal(s.notes.slidesPackCalls.length, 1);   // only the failed try of the first pack
});
