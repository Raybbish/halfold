/* Quiz options in a mixed order (notes/mix.ts): the model tends to put the right answer first. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { LectureReplySchema } from "../src/shapes";
import { mixQuestion, mixQuiz } from "../src/notes/mix";
import { readyLecture, setup } from "./helpers";

test("mixQuestion: the right option stays right, the order is fixed, and mixing twice changes nothing", () => {
  const q = { q: "Which is the opportunity cost?", opts: ["The next best alternative", "The price", "A sunk cost", "A tax"], a: 0, why: "It is what you give up.", t: 252 };
  const m = mixQuestion(q);
  assert.equal(m.opts[m.a], "The next best alternative");
  assert.deepEqual([...m.opts].sort(), [...q.opts].sort());
  assert.deepEqual({ ...m, opts: q.opts, a: q.a }, q, "only the options and the answer's place change");
  assert.deepEqual(mixQuestion(q), m, "the same question, the same order");
  assert.deepEqual(mixQuestion(m), m, "mixing twice changes nothing");
  /* Two options with the same text: the answer keeps pointing at one of them. */
  const twins = mixQuestion({ q: "Twins", opts: ["same", "other", "same"], a: 2 });
  assert.equal(twins.opts[twins.a], "same");
});

test("mixQuiz: twenty questions with the answer first come out with the answer in more than one place", () => {
  const quiz = Array.from({ length: 20 }, (_, i) => ({ q: `Question ${i}`, opts: ["right", "wrong one", "wrong two", "wrong three"], a: 0 }));
  const mixed = mixQuiz(quiz);
  assert.ok(mixed.every(q => q.opts[q.a] === "right"));
  const places = new Set(mixed.map(q => q.a));
  assert.ok(places.size >= 3, `the right answer is at ${[...places].join(", ")}`);
  assert.ok(mixed.filter(q => q.a === 0).length <= 10, "most answers are no longer first");
});

test("GET /lectures/:id and the shared page give the quiz mixed, also for notes stored before mixing", async t => {
  const s = setup(); t.after(() => s.close());
  const token = await s.signIn(), id = await readyLecture(s, token);
  const stored = [{ q: "Opportunity cost is...", opts: ["the price", "the next best alternative", "a sunk cost", "a tax"], a: 1, why: "It is what you give up.", t: 252 }];
  const d = LectureReplySchema.parse((await s.call("GET", `/lectures/${id}`, { token })).body).detail!;
  assert.deepEqual(d.quiz, mixQuiz(stored));
  assert.equal(d.quiz[0].opts[d.quiz[0].a], "the next best alternative");
  const share = (await s.call("POST", `/lectures/${id}/share`, { token })).body as { url: string };
  const shared = (await s.call("GET", `/shared/${share.url.split("/").pop()}`)).body as { detail: { quiz: unknown } };
  assert.deepEqual(shared.detail.quiz, d.quiz, "the shared page shows the same order");
});
