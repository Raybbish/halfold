/* The issues still open at the retest of 2026-11-23 (handoff of 2026-11-23, item 6): a failed lecture and the free
   plan's limits, Chinese explanations in both scripts and in mainland usage for Simplified, Chinese explanations on by
   default and Mandarin or Cantonese classes, the built-in example notes, and exam radar dates added by hand. */
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { HomeSchema, SharedReplySchema, UpcomingSchema } from "../src/shapes";
import { loadConfig } from "../src/config";
import { Store } from "../src/db";
import { localDate } from "../src/time";
import { systemPrompt, userPrompt } from "../src/notes/prompt";
import { buildDetail, parseModelNotes } from "../src/notes/normalize";
import { ElevenLabsScribe } from "../src/stt/elevenlabs";
import { chunkForm, fakeChunk, LIVE_WORDS, liveLecture, readyLecture, setup, uploadedLecture, type TestServer } from "./helpers";

const home = async (s: TestServer, token: string) => HomeSchema.parse((await s.call("GET", "/home", { token })).body);
const send = (s: TestServer, token: string, id: string, seq: number, seconds: number) =>
  s.call("POST", `/lectures/${id}/chunks`, { token, body: chunkForm(fakeChunk(seconds), seq) });

test("a live recording whose notes fail is not counted in today's recording minutes or the month's lectures; Try again counts it again", async t => {
  const s = setup({ realPlans: true }); s.stt.words = LIVE_WORDS; t.after(() => s.close());
  const token = await s.signIn(), id = await liveLecture(s, token);
  assert.equal((await send(s, token, id, 0, 600)).status, 200);
  assert.equal((await send(s, token, id, 1, 600)).status, 200);
  assert.equal((await home(s, token)).usage!.minutesToday, 20, "a recording in progress counts");

  s.notes.replies = [new Error("deepseek replied 500: busy"), new Error("deepseek replied 500: busy")];
  await s.call("POST", `/lectures/${id}/finish`, { token, json: { duration: 1200 } }); await s.pipeline.idle();
  assert.equal(s.store.lecture(id)!.status, "failed");
  const failed = (await home(s, token)).usage!;
  assert.deepEqual([failed.minutesToday, failed.lecturesThisMonth], [0, 0], "the failed recording does not count");

  s.notes.replies = [];
  assert.equal((await s.call("POST", `/lectures/${id}/retry`, { token })).status, 200);
  await s.pipeline.idle();
  assert.equal(s.store.lecture(id)!.status, "ready");
  const ready = (await home(s, token)).usage!;
  assert.deepEqual([ready.minutesToday, ready.lecturesThisMonth], [20, 1], "notes written: it counts");
});

test("Chinese explanations: the model is asked for both scripts, Simplified in mainland usage; each form is kept as written", () => {
  const input = { courseCode: "ECON 2101", courseName: "", title: "Week 3", date: "Tuesday 2026-11-17", language: "en" as const, duration: 600, lines: [], slides: [], zh: true };
  const sys = systemPrompt(input);
  assert.match(sys, /"zhHans": Simplified Chinese as written in mainland China/);
  assert.match(sys, /美联储 \(not 联储局\), 商品 \(not 货品\), 实际 GDP \(not 实质本地生产总值\)/);
  assert.match(sys, /"zhHant": Traditional Chinese as written in Hong Kong/);
  assert.match(sys, /Never make one by changing the characters of the other/);
  assert.match(sys, /"zhHans": "\.\.\.", "zhHant": "\.\.\."/);
  assert.doesNotMatch(systemPrompt({ ...input, zh: false }), /zhHans|zhHant/);

  /* Both written: kept as they are (OpenCC would have made 联储局 and 货品 of the Hong Kong text). */
  const reply = (p: Record<string, string>) => JSON.stringify({ sections: [{ title: "Money", start: 0, end: 600, points: [{ t: 5, text: "The Fed raised rates.", ...p }] }] });
  const ctx = { duration: 600, lines: [], slidePages: [], zh: true };
  const both = buildDetail(parseModelNotes(reply({ zhHans: "美联储加息，商品价格随之变化。", zhHant: "聯儲局加息，貨品價格隨之變化。" })), ctx).detail.sections[0].points[0];
  assert.deepEqual([both.zhHans, both.zhHant], ["美联储加息，商品价格随之变化。", "聯儲局加息，貨品價格隨之變化。"]);
  /* Only one form (or the older single "zh"): OpenCC writes the other, whichever script it was in. */
  const onlyHant = buildDetail(parseModelNotes(reply({ zh: "機會成本" })), ctx).detail.sections[0].points[0];
  assert.deepEqual([onlyHant.zhHant, onlyHant.zhHans], ["機會成本", "机会成本"]);
  const onlyHans = buildDetail(parseModelNotes(reply({ zhHans: "机会成本" })), ctx).detail.sections[0].points[0];
  assert.deepEqual([onlyHans.zhHant, onlyHans.zhHans], ["機會成本", "机会成本"]);
  assert.equal(buildDetail(parseModelNotes(reply({ zhHans: "机会成本" })), { ...ctx, zh: false }).detail.sections[0].points[0].zhHans, undefined);
});

test("classes taught in Mandarin or Cantonese: accepted for a lecture and in Settings, told to the model, sent to speech-to-text", async t => {
  const s = setup(); t.after(() => s.close());
  const token = await s.signIn();
  const course = (await s.call("POST", "/courses", { token, json: { code: "ECON 2101", name: "" } })).body.id;
  for (const language of ["zh", "yue"]) {
    assert.equal((await s.call("POST", "/lectures", { token, json: { courseId: course, title: "W1", language, source: "upload" } })).status, 200, language);
    assert.equal((await s.call("PUT", "/settings", { token, json: { name: "Mei", classLanguage: language, zhDefault: true } })).status, 204, language);
    assert.equal((await home(s, token)).settings!.classLanguage, language);
  }
  const ask = (language: "zh" | "yue") => userPrompt({ courseCode: "C", courseName: "", title: "t", date: "d", language, duration: 60, lines: [], slides: [], zh: true });
  assert.match(ask("zh"), /Language spoken: Mandarin, perhaps with English terms/);
  assert.match(ask("yue"), /Language spoken: Cantonese, perhaps with English terms/);
  assert.match(systemPrompt({ courseCode: "C", courseName: "", title: "t", date: "d", language: "zh", duration: 60, lines: [], slides: [], zh: true }), /Some or all of it may be in Mandarin or Cantonese/);
  const scribe = new ElevenLabsScribe("k", "scribe_v3", 0.2);
  assert.deepEqual(scribe.languageFields("zh"), [["language_code", "zho"], ["secondary_language_codes", "en"]]);
  assert.deepEqual(scribe.languageFields("yue"), [["language_code", "yue"], ["secondary_language_codes", "en"]]);
  assert.deepEqual([s.config.stt.deepgram.languages.zh, s.config.stt.deepgram.languages.yue], ["multi", "multi"]);
  /* A Cantonese class's transcript reads in Traditional, as an English-and-Cantonese one does. */
  s.stt.words = [{ text: "即系话", start: 1, end: 2 }, { text: "机会成本", start: 2, end: 3 }];
  const id = await uploadedLecture(s, token, { language: "yue" });
  await s.call("POST", `/lectures/${id}/finish`, { token, json: { duration: 600 } }); await s.pipeline.idle();
  assert.equal(s.notes.calls.at(-1)!.input.lines[0].text, "即係話機會成本");
});

test("中文解釋 is on by default: for new students, and once for students made before", async t => {
  const s = setup(); t.after(() => s.close());
  assert.equal((await home(s, await s.signIn())).settings!.zhDefault, true);
  /* A database from before: the students had it off (the old default). Opening it turns it on once; a later choice stays. */
  s.store.db.prepare("UPDATE users SET zh_default = 0").run();
  s.store.db.prepare("DELETE FROM meta WHERE key = 'zh_default_on'").run();
  const again = new Store(path.join(s.dir, "test.db")); t.after(() => again.close());
  assert.deepEqual(again.listUsers().map(u => u.zh_default), [1, 1]);
  again.setSettings(again.userByCode("CODE-A")!.id, { name: "Ann", classLanguage: "en", zhDefault: false });
  const third = new Store(path.join(s.dir, "test.db")); t.after(() => third.close());
  assert.deepEqual(third.listUsers().map(u => u.zh_default), [0, 1]);
});

test("the built-in example notes: GET /shared/econ-w9 without a shared lecture in the database; not saved; EXAMPLE_SHARE_ID", async t => {
  const s = setup(); t.after(() => s.close());
  const r = await s.call("GET", "/shared/econ-w9");
  assert.equal(r.status, 200);
  const ex = SharedReplySchema.parse(r.body);
  assert.equal(ex.example, true); assert.equal(ex.sharedBy, "Halfold");
  assert.deepEqual([ex.lecture.title, ex.lecture.week, ex.course?.code], ["Opportunity cost and comparative advantage", 9, "ECON 1001"]);
  assert.equal(ex.detail.sections.length, 5); assert.equal(ex.detail.slides.length, 25);
  const p = ex.detail.sections[0].points[0];
  assert.ok(p.zhHans && p.zhHant && p.zhHans !== p.zhHant, "both scripts"); assert.equal(p.zh, undefined);
  assert.equal((await s.call("GET", "/shared/econ-w8")).status, 404);
  const save = await s.call("POST", "/shared/econ-w9/save", { token: await s.signIn() });
  assert.equal(save.status, 409); assert.match(save.body.message, /^These are example notes/);
  /* Not set: the built-in example; off: no links; another id: that shared lecture. */
  assert.equal(loadConfig({}).exampleShareId, "econ-w9");
  assert.equal(loadConfig({ EXAMPLE_SHARE_ID: " " }).exampleShareId, "econ-w9");
  assert.equal(loadConfig({ EXAMPLE_SHARE_ID: "off" }).exampleShareId, null);
  assert.equal(loadConfig({ EXAMPLE_SHARE_ID: "Ab12Cd34" }).exampleShareId, "Ab12Cd34");
});

test("exam radar dates added by hand: added, listed on /home with the lecturer's dates by date, removed; checked", async t => {
  const s = setup(); t.after(() => s.close());
  const token = await s.signIn(), other = await s.signIn("CODE-B");
  const lec = await readyLecture(s, token), course = s.store.lecture(lec)!.course_id;   // its notes have a midterm on 2099-11-26
  const today = localDate(new Date(), s.config.timezone);
  const add = (json: Record<string, unknown>, tk = token) => s.call("POST", "/upcoming", { token: tk, json });
  const made = await add({ course, date: "2099-11-20", kind: "Quiz", text: "  Quiz on   chapter 3 " });
  assert.equal(made.status, 200);
  const quiz = UpcomingSchema.parse(made.body);
  assert.deepEqual({ ...quiz, id: "x" }, { date: "2099-11-20", kind: "Quiz", text: "Quiz on chapter 3", course: "ECON 1001", lecture: null, t: null, id: "x" });
  assert.equal((await add({ course, date: today, kind: "Deadline", text: "" })).status, 200, "today, with no note");
  const radar = (await home(s, token)).upcoming;
  assert.deepEqual(radar.map(u => [u.date, u.kind, !!u.id]), [[today, "Deadline", true], ["2099-11-20", "Quiz", true], ["2099-11-26", "Midterm", false]]);
  for (const [json, status, message] of [
    [{ course: "nope", date: "2099-01-01", kind: "Quiz" }, 404, "That course does not exist."],
    [{ course, date: "2099-02-30", kind: "Quiz" }, 400, "Choose the date."],
    [{ course, date: "", kind: "Quiz" }, 400, "Choose the date."],
    [{ course, date: "2000-01-01", kind: "Quiz" }, 400, "Choose a date from today on."],
    [{ course, date: "2099-01-01", kind: "Party" }, 400, "Choose what the date is for."],
    [{ course, date: "2099-01-01", kind: "Final", text: "x".repeat(201) }, 400, "The note can be at most 200 characters."]
  ] as const) { const bad = await add(json); assert.equal(bad.status, status, message); assert.equal(bad.body.message, message); }
  /* Someone else's course or date. */
  assert.equal((await add({ course, date: "2099-01-01", kind: "Quiz" }, other)).status, 404);
  assert.equal((await s.call("DELETE", `/upcoming/${quiz.id}`, { token: other })).status, 404);
  assert.equal((await s.call("DELETE", `/upcoming/${quiz.id}`, { token })).status, 204);
  assert.equal((await s.call("DELETE", `/upcoming/${quiz.id}`, { token })).status, 404);
  assert.deepEqual((await home(s, token)).upcoming.map(u => u.kind), ["Deadline", "Midterm"]);
  /* Deleted with the course. */
  await s.call("DELETE", `/courses/${course}`, { token });
  assert.deepEqual((await home(s, token)).upcoming, []);
  assert.equal((await s.call("POST", "/upcoming", { json: { course, date: "2099-01-01", kind: "Quiz" } })).status, 401);
});
