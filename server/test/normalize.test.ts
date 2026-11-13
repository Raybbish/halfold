/* Tidying the model's reply into a Detail that keeps INTEGRATION.md 3.2, and cutting words into transcript lines. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDetail, parseModelNotes, slideLabel } from "../src/notes/normalize";
import { joinTokens, wordsToLines } from "../src/stt/lines";
import { DetailSchema } from "../src/shapes";

const ctx = { duration: 600.4, lines: [{ t: 30, text: "b" }, { t: 5, text: "a" }, { t: 40, text: "  " }], slidePages: [{ n: 1, text: "Intro\nWelcome" }, { n: 2, text: "" }], zh: "hant" as const };

test("parseModelNotes: accepts fenced JSON and numbers as strings; explains what is wrong otherwise", () => {
  const m = parseModelNotes('```json\n{"sections":[{"title":"A","start":"0","end":"10","points":[{"t":"3","text":" x "}]}]}\n```');
  assert.equal(m.sections[0].points[0].t, 3); assert.equal(m.sections[0].points[0].text, "x");
  assert.throws(() => parseModelNotes("{nope"), /not valid JSON/);
  assert.throws(() => parseModelNotes('{"notes": []}'), /does not have the fields asked for: sections/);
  assert.throws(() => parseModelNotes('{"sections":[{"title":"A","start":0,"end":1,"points":[]}]}'), /no sections with points/);
});

test("buildDetail: times clamped and whole, sections sorted and following one another, empty ones dropped", () => {
  const { detail } = buildDetail(parseModelNotes(JSON.stringify({
    sections: [
      { title: "Second", start: 300.6, end: 999, points: [{ t: 700, text: "late" }, { t: 320.2, text: "early" }] },
      { title: "Empty", start: 100, end: 200, points: [{ t: 150, text: "" }] },
      { title: "First", start: -5, end: 250, points: [{ t: 10, text: "p", slide: 2, off: true }, { t: 20, text: "q", slide: 9 }] }
    ]
  })), ctx);
  assert.deepEqual(detail.sections.map(s => [s.title, s.start, s.end]), [["First", 0, 301], ["Second", 301, 600]]);
  assert.deepEqual(detail.sections[1].points.map(p => [p.t, p.text]), [[320, "early"], [600, "late"]]);
  assert.equal(detail.sections[0].points[0].slide, 2); assert.equal(detail.sections[0].points[0].off, true);
  assert.equal(detail.sections[0].points[1].slide, null);   // there is no slide 9
  assert.equal(detail.sections[0].slides, "Slide 2"); assert.equal(detail.sections[1].slides, undefined);
  assert.deepEqual(detail.slides, [{ n: 1, title: "Intro", image: null }, { n: 2, title: "Slide 2", image: null }]);
  assert.deepEqual(detail.transcript, [{ t: 5, text: "a" }, { t: 30, text: "b" }]);
  DetailSchema.parse(detail);
});

test("buildDetail: alerts use the front end's words and keep real dates only; broken quiz questions are dropped", () => {
  const { detail, dated } = buildDetail(parseModelNotes(JSON.stringify({
    sections: [{ title: "A", start: 0, end: 600, points: [{ t: 1, text: "x", zh: "機會成本" }] }],
    alerts: [{ t: 9, kind: "FINAL EXAM", text: "Final covers all", date: "2026-12-14" }, { t: 5, kind: "deadline", text: "Essay due", date: "2026-02-30" },
      { t: 7, kind: "Office hours", text: "Moved to Friday", date: null }],
    quiz: [{ q: "ok", opts: ["a", "b"], a: 1 }, { q: "bad index", opts: ["a", "b"], a: 2 }, { q: "one option", opts: ["a"], a: 0 }, { q: "blank option", opts: ["a", " "], a: 0 }],
    flashcards: [{ q: "q", a: "a" }, { q: "", a: "a" }]
  })), { ...ctx, slidePages: [] });
  assert.deepEqual(detail.alerts, [{ t: 5, kind: "Deadline", text: "Essay due" }, { t: 7, kind: "Office hours", text: "Moved to Friday" }, { t: 9, kind: "Final", text: "Final covers all" }]);
  assert.deepEqual(dated, [{ date: "2026-12-14", kind: "Final", text: "Final covers all", t: 9 }]);
  assert.deepEqual(detail.quiz, [{ q: "ok", opts: ["a", "b"], a: 1, t: null }]);
  assert.equal(detail.flashcards.length, 1);
  assert.deepEqual(detail.slides, []);
  assert.deepEqual([detail.sections[0].points[0].zhHant, detail.sections[0].points[0].zhHans], ["機會成本", "机会成本"]);
  DetailSchema.parse(detail);
});

test("slideLabel", () => {
  assert.equal(slideLabel([]), undefined); assert.equal(slideLabel([4, 4]), "Slide 4"); assert.equal(slideLabel([6, 3, 4]), "Slides 3 to 6");
});

test("joinTokens: spaces between English words, none between Chinese characters or before punctuation", () => {
  assert.equal(joinTokens(["Hello", ",", "world", "."]), "Hello, world.");
  assert.equal(joinTokens(["我哋", "今日", "講", "opportunity", "cost", "，", "即係", "(", "OC", ")"]), "我哋今日講 opportunity cost，即係 (OC)");
});

test("wordsToLines: a line ends at a sentence end after 3 seconds, at a pause, or after 25 seconds", () => {
  const w = (text: string, start: number, end = start + 0.4) => ({ text, start, end });
  const lines = wordsToLines([
    w("Hi.", 0.5, 0.9), w("Today", 1.2), w("we", 1.7), w("start.", 2.2, 4),                 // "Hi." is too short to stand alone
    w("After", 8.9), w("a", 9.3), w("pause", 9.6),                                           // pause of 4.9 s before it
    ...Array.from({ length: 40 }, (_, i) => w("on", 10 + i))                                // no full stop for 40 seconds
  ]);
  assert.deepEqual(lines.map(l => l.t), [0, 8, 34]);
  assert.equal(lines[0].text, "Hi. Today we start.");
  assert.ok(lines[1].text.startsWith("After a pause on"));
});

test("mixedErrorRate: English by word, Chinese by character, 繁 and 简 the same, punctuation ignored", async () => {
  const { mixedErrorRate, tokens, mix } = await import("../src/stt/compare");
  assert.deepEqual(tokens("機會成本 is the Opportunity cost, 對嗎?"), ["机", "会", "成", "本", "is", "the", "opportunity", "cost", "对", "吗"]);
  assert.equal(mixedErrorRate("机会成本 is the cost", "機會成本 is the cost."), 0);
  assert.equal(mixedErrorRate("机会成本 is the cost", "机会成本 is a cost"), 1 / 7);
  assert.deepEqual(mix("我哋 learn economics"), { tokens: 4, chinese: 2, other: 2 });
});
