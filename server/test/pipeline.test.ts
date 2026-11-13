/* Recording -> notes with the speech-to-text service and the notes model stubbed: ready and failed, retries that do not
   pay twice, a reply the model is asked to correct, deletion part way, restarts, and the cost log. */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { DetailSchema } from "../src/shapes";
import { goodNotes, setup, uploadedLecture } from "./helpers";

const finish = (s: ReturnType<typeof setup>, token: string, id: string) => s.call("POST", `/lectures/${id}/finish`, { token, json: { duration: 600 } });

test("ready: transcript from the words, notes from the model, both Chinese scripts, dates and costs", async t => {
  const s = setup(); t.after(() => s.close());
  const token = await s.signIn(), id = await uploadedLecture(s, token, { language: "en-yue" });
  await finish(s, token, id); await s.pipeline.idle();
  const l = s.store.lecture(id)!;
  assert.equal(l.status, "ready"); assert.equal(l.duration, 600);
  const d = DetailSchema.parse(s.store.detail(id));
  assert.deepEqual(d.transcript, [{ t: 1, text: "Good morning." }, { t: 18, text: "The midterm is on November 26." }, { t: 250, text: "機會成本 opportunity cost." }]);
  assert.deepEqual(d.sections.map(x => [x.title, x.start, x.end]), [["Admin", 0, 200], ["Opportunity cost", 200, 600]]);
  const p = d.sections[1].points[0];
  assert.equal(p.zhHant, "機會成本是你放棄的次佳選擇。"); assert.equal(p.zhHans, "机会成本是你放弃的次佳选择。");
  assert.equal(p.slide, null); assert.equal(p.off, false);   // no slides: no slide numbers, nothing is "off the slides"
  assert.deepEqual(d.slides, []);
  assert.deepEqual(d.alerts, [{ t: 18, kind: "Midterm", text: "Midterm on 26 November, chapters 1 to 5." }]);
  /* What the model was given. */
  const input = s.notes.calls[0].input;
  assert.equal(input.zh, "hant"); assert.equal(input.language, "en-yue"); assert.equal(input.courseCode, "ECON 1001");
  assert.match(input.date, /^[A-Z][a-z]+day \d{4}-\d{2}-\d{2}$/);
  assert.equal(input.lines.length, 3); assert.deepEqual(input.slides, []);
  /* The cost of each step. */
  const costs = s.store.costs();
  assert.deepEqual(costs.map(c => c.stage), ["stt", "notes"]);
  assert.equal(costs[0].audio_seconds, 600); assert.ok(Math.abs(costs[0].usd! - 600 / 3600 * 0.2) < 1e-9);
  assert.equal(costs[1].input_tokens, 30000); assert.equal(costs[1].output_tokens, 12000); assert.equal(costs[1].reasoning_tokens, 4000);
  assert.equal(JSON.parse(costs[1].meta_json!).completed, true);
  assert.ok(fs.existsSync(path.join(s.dir, "lectures", id, "transcript.stub-stt.json")));
});

test("with slides: points keep their slide numbers and 'off'; section slide labels; slide titles", async t => {
  const s = setup(); t.after(() => s.close());
  const token = await s.signIn(), id = await uploadedLecture(s, token, { slides: true, language: "en-zh" });
  await finish(s, token, id); await s.pipeline.idle();
  const d = DetailSchema.parse(s.store.detail(id));
  assert.deepEqual(d.slides, [{ n: 1, title: "Course admin", image: null }, { n: 2, title: "Opportunity cost", image: null }]);
  assert.deepEqual(d.sections.map(x => x.slides), ["Slide 1", "Slide 2"]);
  assert.equal(d.sections[0].points[0].off, true); assert.equal(d.sections[0].points[0].slide, 1);
  assert.equal(s.notes.calls[0].input.zh, "hans");
  assert.equal(s.notes.calls[0].input.slides.length, 2);
  /* en-zh is written in Simplified; the Traditional form is converted. */
  assert.equal(d.sections[1].points[0].zhHans, "機會成本是你放棄的次佳選擇。");
});

test("ZH_EXPLANATIONS=off: no Chinese explanations are asked for or kept", async t => {
  const s = setup({ env: { ZH_EXPLANATIONS: "off" } }); t.after(() => s.close());
  const token = await s.signIn(), id = await uploadedLecture(s, token);
  await finish(s, token, id); await s.pipeline.idle();
  assert.equal(s.notes.calls[0].input.zh, null);
  const p = s.store.detail(id)!.sections[0].points[0];
  assert.equal(p.zhHant, undefined); assert.equal(p.zhHans, undefined);
});

test("an unusable reply is shown back to the model once; the second reply is used", async t => {
  const s = setup(); t.after(() => s.close());
  const token = await s.signIn(), id = await uploadedLecture(s, token);
  s.notes.replies = ["Here are your notes: {oops", JSON.stringify(goodNotes())];
  await finish(s, token, id); await s.pipeline.idle();
  assert.equal(s.store.lecture(id)!.status, "ready");
  assert.equal(s.notes.calls.length, 2);
  assert.equal(s.notes.calls[1].repair!.reply, "Here are your notes: {oops");
  assert.match(s.notes.calls[1].repair!.problem, /not valid JSON/);
  assert.equal(s.store.costs().filter(c => c.stage === "notes").length, 2);   // both calls are paid for
});

test("failed after two unusable replies; retry writes the notes again without transcribing again", async t => {
  const s = setup(); t.after(() => s.close());
  const token = await s.signIn(), id = await uploadedLecture(s, token);
  s.notes.replies = [JSON.stringify({ sections: [] }), JSON.stringify({ sections: [{ title: "x", start: 0, end: 5, points: [] }] })];
  await finish(s, token, id); await s.pipeline.idle();
  const l = s.store.lecture(id)!;
  assert.equal(l.status, "failed"); assert.match(l.error!, /did not write usable notes/);
  assert.equal((await s.call("GET", `/lectures/${id}`, { token })).body.detail, null);

  assert.deepEqual((await s.call("POST", `/lectures/${id}/retry`, { token })).body, { status: "processing" });
  await s.pipeline.idle();
  assert.equal(s.store.lecture(id)!.status, "ready");
  assert.equal(s.stt.calls, 1);   // the transcript was kept
  assert.equal(s.notes.calls.length, 3);
});

test("speech-to-text errors fail the lecture; retry transcribes again; finish on a failed lecture also retries", async t => {
  const s = setup(); t.after(() => s.close());
  const token = await s.signIn(), id = await uploadedLecture(s, token);
  s.stt.error = new Error("elevenlabs replied 500: busy");
  await finish(s, token, id); await s.pipeline.idle();
  assert.equal(s.store.lecture(id)!.status, "failed");
  assert.equal(s.store.costs().length, 0);
  s.stt.error = null;
  assert.deepEqual((await finish(s, token, id)).body, { status: "processing" });
  await s.pipeline.idle();
  assert.equal(s.store.lecture(id)!.status, "ready"); assert.equal(s.stt.calls, 2);
});

test("a model error (network, max_tokens) fails the lecture and keeps the transcript", async t => {
  const s = setup(); t.after(() => s.close());
  const token = await s.signIn(), id = await uploadedLecture(s, token);
  s.notes.replies = [new Error("DeepSeek stopped at max_tokens")];
  await finish(s, token, id); await s.pipeline.idle();
  assert.equal(s.store.lecture(id)!.status, "failed");
  assert.ok(s.store.transcript(id));
});

test("deleting a lecture while its notes are written stops the run and leaves nothing", async t => {
  const s = setup(); t.after(() => s.close());
  const token = await s.signIn(), id = await uploadedLecture(s, token);
  let release!: () => void; s.stt.gate = new Promise(r => { release = r; });
  await finish(s, token, id);
  await new Promise(r => setTimeout(r, 20));
  assert.equal(s.stt.calls, 1);
  assert.equal((await s.call("DELETE", `/lectures/${id}`, { token })).status, 204);
  release(); await s.pipeline.idle();
  assert.equal(s.store.lecture(id), undefined);
  assert.equal(s.notes.calls.length, 0);
  assert.equal(fs.existsSync(path.join(s.dir, "lectures", id)), false);
  /* The transcription was paid for: it is in the cost log even though the lecture is gone. */
  assert.deepEqual(s.store.costs().map(c => [c.lecture_id, c.stage]), [[id, "stt"]]);
});

test("after a restart, lectures left processing are run again", async t => {
  const s = setup(); t.after(() => s.close());
  const token = await s.signIn(), id = await uploadedLecture(s, token);
  assert.ok(s.store.startProcessing(id, ["recording"]));   // as if the server stopped right after finish
  assert.equal(s.store.lecture(id)!.status, "processing");
  s.pipeline.resume(); await s.pipeline.idle();
  assert.equal(s.store.lecture(id)!.status, "ready");
});

test("the queue runs at most PIPELINE_CONCURRENCY lectures at once", async t => {
  const s = setup({ env: { PIPELINE_CONCURRENCY: "1" } }); t.after(() => s.close());
  const token = await s.signIn();
  const a = await uploadedLecture(s, token), b = await uploadedLecture(s, token);
  let release!: () => void; s.stt.gate = new Promise(r => { release = r; });
  await finish(s, token, a); await finish(s, token, b);
  await new Promise(r => setTimeout(r, 20));
  assert.equal(s.stt.calls, 1);
  release(); await s.pipeline.idle();
  assert.equal(s.stt.calls, 2);
  assert.equal(s.store.lecture(a)!.status, "ready"); assert.equal(s.store.lecture(b)!.status, "ready");
});
