/* Marks made in class (POST /lectures/:id/marks, detail.marks), a question about a lecture (POST /lectures/:id/ask) and
   flashcard review across lectures (GET /review, PUT /lectures/:id/cards/known, reviewCount in GET /home). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { AskReplySchema, ErrorReplySchema, HomeSchema, LectureReplySchema, ReviewReplySchema, SharedReplySchema } from "../src/shapes";
import { askPrompt, readAnswer } from "../src/notes/ask";
import { liveLecture, readyLecture, setup } from "./helpers";

const isError = (r: { body: unknown }) => ErrorReplySchema.parse(r.body);
const getDetail = async (s: ReturnType<typeof setup>, token: string, id: string) => LectureReplySchema.parse((await s.call("GET", `/lectures/${id}`, { token })).body).detail!;

/* ---------- marks ---------- */

test("marks: sent while recording, back in detail.marks by time once the notes are written; the same mark twice is kept once", async t => {
  const s = setup(); t.after(() => s.close());
  const token = await s.signIn(), id = await liveLecture(s, token);
  for (const json of [{ t: 408, kind: "important" }, { t: 95.04, kind: "lost" }, { t: 408, kind: "important" }, { t: 408, kind: "lost" }])
    assert.equal((await s.call("POST", `/lectures/${id}/marks`, { token, json })).status, 204, JSON.stringify(json));
  /* No notes yet: no detail to carry them. */
  assert.equal(LectureReplySchema.parse((await s.call("GET", `/lectures/${id}`, { token })).body).detail, null);
  assert.deepEqual(s.store.marks(id), [{ t: 95, kind: "lost" }, { t: 408, kind: "important" }, { t: 408, kind: "lost" }]);

  const ready = await readyLecture(s, token);
  assert.equal((await getDetail(s, token, ready)).marks, undefined);   // a lecture without marks has no marks field
  await s.call("POST", `/lectures/${ready}/marks`, { token, json: { t: 252, kind: "lost" } });
  await s.call("POST", `/lectures/${ready}/marks`, { token, json: { t: 18, kind: "important" } });
  assert.deepEqual((await getDetail(s, token, ready)).marks, [{ t: 18, kind: "important" }, { t: 252, kind: "lost" }]);
});

test("marks: bad input refused with a message; someone else's lecture is a 404; at most 500 a lecture; deleted with the lecture", async t => {
  const s = setup(); t.after(() => s.close());
  const token = await s.signIn(), id = await liveLecture(s, token);
  for (const json of [{}, { t: 10 }, { t: 10, kind: "funny" }, { t: -1, kind: "lost" }, { t: "10", kind: "lost" }, { t: 13 * 3600, kind: "lost" }, { kind: "important" }]) {
    const r = await s.call("POST", `/lectures/${id}/marks`, { token, json }); assert.equal(r.status, 400, JSON.stringify(json)); isError(r);
  }
  const other = await s.call("POST", `/lectures/${id}/marks`, { token: await s.signIn("CODE-B"), json: { t: 1, kind: "lost" } });
  assert.equal(other.status, 404); isError(other);
  assert.equal(s.store.markCount(id), 0);

  for (let i = 0; i < 500; i++) s.store.addMark(id, i, "important");
  const full = await s.call("POST", `/lectures/${id}/marks`, { token, json: { t: 600, kind: "lost" } });
  assert.equal(full.status, 409); assert.equal(isError(full).message, "A lecture can keep at most 500 marks.");

  assert.equal((await s.call("DELETE", `/lectures/${id}`, { token })).status, 204);
  assert.equal(s.store.markCount(id), 0);
});

test("marks are the student's own: not on the shared page, not in a classmate's saved copy", async t => {
  const s = setup(); t.after(() => s.close());
  const token = await s.signIn(), reader = await s.signIn("CODE-B"), id = await readyLecture(s, token);
  await s.call("POST", `/lectures/${id}/marks`, { token, json: { t: 18, kind: "lost" } });
  const url = (await s.call("POST", `/lectures/${id}/share`, { token })).body.url as string, shareId = url.split("#/s/")[1];
  const shared = SharedReplySchema.parse((await s.call("GET", `/shared/${shareId}`)).body);
  assert.equal(shared.detail.marks, undefined);
  const copy = (await s.call("POST", `/shared/${shareId}/save`, { token: reader })).body.id as string;
  assert.equal((await getDetail(s, reader, copy)).marks, undefined);
  /* The owner still has theirs. */
  assert.deepEqual((await getDetail(s, token, id)).marks, [{ t: 18, kind: "lost" }]);
});

/* ---------- asking about a lecture ---------- */

test("ask: answered from the transcript; refs are the lines themselves with their times; the cost is logged without the question", async t => {
  const s = setup(); t.after(() => s.close());
  const token = await s.signIn(), id = await readyLecture(s, token);
  const transcript = (await getDetail(s, token, id)).transcript;
  assert.ok(transcript.length >= 3);
  s.ask.replies.push({ answer: "It is on 26 November.", refs: [1] });
  const r = await s.call("POST", `/lectures/${id}/ask`, { token, json: { question: "  When is the midterm?  " } });
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(AskReplySchema.parse(r.body), { answer: "It is on 26 November.", refs: [{ t: transcript[1].t, text: transcript[1].text }] });
  const input = s.ask.calls[0];
  assert.equal(input.question, "When is the midterm?"); assert.equal(input.courseCode, "ECON 1001"); assert.equal(input.title, "Week 9"); assert.equal(input.language, "en-yue");
  assert.deepEqual(input.lines, transcript);

  const cost = s.store.costs().filter(c => c.stage === "ask");
  assert.equal(cost.length, 1);
  assert.equal(cost[0].lecture_id, id); assert.equal(cost[0].provider, "stub-ask"); assert.equal(cost[0].input_tokens, 9000); assert.equal(cost[0].cached_input_tokens, 6000);
  assert.ok(cost[0].usd! > 0);
  const meta = JSON.parse(cost[0].meta_json!);
  assert.equal(meta.completed, true); assert.equal(meta.refs, 1); assert.equal(meta.questionChars, 20);
  assert.ok(!cost[0].meta_json!.includes("midterm"), "the question itself is not kept");

  /* Not covered: an answer that says so, and no lines. */
  s.ask.replies.push({ answer: "The lecture does not say.", refs: [] });
  const none = AskReplySchema.parse((await s.call("POST", `/lectures/${id}/ask`, { token, json: { question: "Who won the World Cup?" } })).body);
  assert.deepEqual(none, { answer: "The lecture does not say.", refs: [] });
});

test("ask: the model failing is a 502 with a message, and its tokens are still logged; bad questions and lectures without notes are refused", async t => {
  const s = setup(); t.after(() => s.close());
  const token = await s.signIn(), id = await readyLecture(s, token);
  s.ask.replies.push(new Error("the reply had no answer"));
  const failed = await s.call("POST", `/lectures/${id}/ask`, { token, json: { question: "What is opportunity cost?" } });
  assert.equal(failed.status, 502); assert.equal(isError(failed).message, "Hal could not answer that just now. Try again in a moment.");
  const cost = s.store.costs().filter(c => c.stage === "ask");
  assert.equal(cost.length, 1); assert.equal(JSON.parse(cost[0].meta_json!).completed, false);

  for (const json of [{}, { question: "   " }, { question: 42 }, { question: "x".repeat(301) }]) {
    const r = await s.call("POST", `/lectures/${id}/ask`, { token, json }); assert.equal(r.status, 400, JSON.stringify(json)); isError(r);
  }
  assert.equal((await s.call("POST", `/lectures/${id}/ask`, { token, json: { question: "x".repeat(300) } })).status, 200);
  const notYet = await s.call("POST", `/lectures/${await liveLecture(s, token)}/ask`, { token, json: { question: "Anything?" } });
  assert.equal(notYet.status, 409); assert.equal(isError(notYet).message, "Ask about this lecture once its notes are ready.");
  assert.equal((await s.call("POST", `/lectures/${id}/ask`, { token: await s.signIn("CODE-B"), json: { question: "Anything?" } })).status, 404);
  assert.equal(s.ask.calls.length, 2);   // only the failing call and the 300-character one reached the model
});

test("ask: the prompt numbers the lines and ends with the question; the reply keeps only lines that exist, at most four, in the order said", () => {
  const p = askPrompt({ courseCode: "ECON 1001", title: "Week 9", language: "en-yue", question: "期中考考什麼？", lines: [{ t: 18, text: "The midterm is on 26 November." }, { t: 75, text: "Chapters one to five." }] });
  assert.match(p.system, /English and Cantonese/);
  assert.match(p.system, /language the question is written in/);
  assert.match(p.user, /\[0\] 0:18 The midterm is on 26 November\.\n\[1\] 1:15 Chapters one to five\.\n\nQuestion: 期中考考什麼？$/);

  assert.deepEqual(readAnswer(JSON.stringify({ answer: " 第一到五章。 ", refs: [1, 0, 1, 7, -1, 2.5, "0"] }), 2), { answer: "第一到五章。", refs: [0, 1] });
  assert.deepEqual(readAnswer(JSON.stringify({ answer: "x", refs: [5, 4, 3, 2, 1, 0] }), 6).refs, [2, 3, 4, 5]);
  assert.deepEqual(readAnswer(JSON.stringify({ answer: "x" }), 6).refs, []);
  assert.throws(() => readAnswer("not json", 2), /not JSON/);
  assert.throws(() => readAnswer(JSON.stringify({ answer: "  ", refs: [0] }), 2), /no answer/);
});

test("ask: ASK_* settings, falling back to the Catch me up model", () => {
  const s = setup({ env: { CATCHUP_MODEL: "deepseek-flash" } });
  try {
    assert.equal(s.config.ask.model, "deepseek-flash"); assert.equal(s.config.ask.reasoningEffort, "none"); assert.deepEqual(s.config.ask.prices, s.config.catchUp.prices);
  } finally { s.close(); }
  const o = setup({ env: { ASK_MODEL: "deepseek-v4-pro", ASK_REASONING_EFFORT: "low", ASK_MAX_TOKENS: "4000", ASK_USD_PER_M_OUTPUT: "9" } });
  try {
    assert.equal(o.config.ask.model, "deepseek-v4-pro"); assert.equal(o.config.ask.reasoningEffort, "low"); assert.equal(o.config.ask.maxTokens, 4000);
    assert.equal(o.config.ask.prices.output, 9); assert.equal(o.config.ask.prices.inputCacheMiss, 1.32);
  } finally { o.close(); }
});

/* ---------- review across lectures ---------- */

test("review: cards not known from every lecture with notes, newest first; known ones drop out; reviewCount in /home follows", async t => {
  const s = setup(); t.after(() => s.close());
  const token = await s.signIn(), older = await readyLecture(s, token, { title: "Week 8" });
  const course = s.store.lecture(older)!.course_id, newer = await readyLecture(s, token, { courseId: course, title: "Week 9" });
  /* A second card in the newer lecture. */
  s.store.editDetail(newer, d => { d.flashcards.push({ q: "What is a sunk cost?", a: "A cost already paid." }); });
  await liveLecture(s, token);   // no notes yet: no cards

  let r = ReviewReplySchema.parse((await s.call("GET", "/review", { token })).body);
  assert.deepEqual(r.cards.map(c => [c.lecture, c.index, c.q]), [["Week 9", 0, "What is opportunity cost?"], ["Week 9", 1, "What is a sunk cost?"], ["Week 8", 0, "What is opportunity cost?"]]);
  assert.deepEqual(r.cards[0], { lectureId: newer, lecture: "Week 9", index: 0, q: "What is opportunity cost?", a: "The next best alternative given up." });
  assert.equal(HomeSchema.parse((await s.call("GET", "/home", { token })).body).reviewCount, 3);

  /* Known from the Review page; the quiz score saved on the lecture page stays. */
  await s.call("PUT", `/lectures/${newer}/progress`, { token, json: { known: [], quizScore: 80 } });
  assert.equal((await s.call("PUT", `/lectures/${newer}/cards/known`, { token, json: { index: 1, known: true } })).status, 204);
  assert.deepEqual(s.store.progress(newer), { known: [1], quizScore: 80 });
  /* Known from the lecture page (PUT /progress) counts too. */
  await s.call("PUT", `/lectures/${older}/progress`, { token, json: { known: [0], quizScore: null } });
  r = ReviewReplySchema.parse((await s.call("GET", "/review", { token })).body);
  assert.deepEqual(r.cards.map(c => [c.lectureId, c.index]), [[newer, 0]]);
  assert.equal(HomeSchema.parse((await s.call("GET", "/home", { token })).body).reviewCount, 1);
  assert.deepEqual((await getDetail(s, token, newer)).progress, { known: [1] });

  /* Not known again; twice the same is the same. */
  await s.call("PUT", `/lectures/${newer}/cards/known`, { token, json: { index: 1, known: false } });
  await s.call("PUT", `/lectures/${newer}/cards/known`, { token, json: { index: 0, known: true } });
  await s.call("PUT", `/lectures/${newer}/cards/known`, { token, json: { index: 0, known: true } });
  assert.deepEqual(s.store.progress(newer), { known: [0], quizScore: 80 });

  /* Another student sees only their own (none). */
  const other = await s.signIn("CODE-B");
  assert.deepEqual(ReviewReplySchema.parse((await s.call("GET", "/review", { token: other })).body), { cards: [] });
  assert.equal(HomeSchema.parse((await s.call("GET", "/home", { token: other })).body).reviewCount, 0);
});

test("cards/known: a card that is not there is a 404; bad input a 400; someone else's lecture a 404; a lecture without notes a 404", async t => {
  const s = setup(); t.after(() => s.close());
  const token = await s.signIn(), id = await readyLecture(s, token);
  const gone = await s.call("PUT", `/lectures/${id}/cards/known`, { token, json: { index: 1, known: true } });
  assert.equal(gone.status, 404); assert.equal(isError(gone).message, "This flashcard is no longer there. Open the lecture again to see its cards.");
  for (const json of [{}, { index: -1, known: true }, { index: 0.5, known: true }, { index: "0", known: true }, { index: 0 }, { index: 0, known: "yes" }]) {
    const r = await s.call("PUT", `/lectures/${id}/cards/known`, { token, json }); assert.equal(r.status, 400, JSON.stringify(json)); isError(r);
  }
  assert.equal((await s.call("PUT", `/lectures/${id}/cards/known`, { token: await s.signIn("CODE-B"), json: { index: 0, known: true } })).status, 404);
  assert.equal((await s.call("PUT", `/lectures/${await liveLecture(s, token)}/cards/known`, { token, json: { index: 0, known: true } })).status, 404);
  assert.equal(s.store.progress(id), null);
});

test("review: a saved copy of shared notes brings its cards; a deleted lecture takes them away", async t => {
  const s = setup(); t.after(() => s.close());
  const token = await s.signIn(), reader = await s.signIn("CODE-B"), id = await readyLecture(s, token);
  await s.call("PUT", `/lectures/${id}/cards/known`, { token, json: { index: 0, known: true } });
  const url = (await s.call("POST", `/lectures/${id}/share`, { token })).body.url as string;
  const copy = (await s.call("POST", `/shared/${url.split("#/s/")[1]}/save`, { token: reader })).body.id as string;
  /* The owner's progress is not copied: the reader has the card to learn. */
  assert.deepEqual(ReviewReplySchema.parse((await s.call("GET", "/review", { token: reader })).body).cards.map(c => c.lectureId), [copy]);
  await s.call("DELETE", `/lectures/${copy}`, { token: reader });
  assert.deepEqual(ReviewReplySchema.parse((await s.call("GET", "/review", { token: reader })).body).cards, []);
});
