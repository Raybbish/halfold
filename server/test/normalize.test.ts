/* Tidying the model's reply into a Detail that keeps INTEGRATION.md 3.2, and cutting words into transcript lines. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDetail, parseModelNotes, slideLabel, slideLabels } from "../src/notes/normalize";
import { studyCounts, systemPrompt } from "../src/notes/prompt";
import { joinTokens, wordsToLines } from "../src/stt/lines";
import { DetailSchema } from "../src/shapes";

const ctx = { duration: 600.4, lines: [{ t: 30, text: "b" }, { t: 5, text: "a" }, { t: 40, text: "  " }], slidePages: [{ n: 1, text: "Intro\nWelcome" }, { n: 2, text: "" }], zh: "hant" as const };

test("parseModelNotes: accepts fenced JSON and numbers as strings; explains what is wrong otherwise", () => {
  const m = parseModelNotes('```json\n{"sections":[{"title":"A","start":"0","end":"10","points":[{"t":"3","text":" x "}]}]}\n```');
  assert.equal(m.sections[0].points[0].t, 3); assert.equal(m.sections[0].points[0].text, "x");
  assert.throws(() => parseModelNotes("{nope"), /not valid JSON/);
  assert.throws(() => parseModelNotes('{"notes": []}'), /does not have the fields asked for: "sections" must be a list/);
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

test("parseModelNotes: one unusable item is dropped on its own, not the whole reply", () => {
  const m = parseModelNotes(JSON.stringify({
    sections: [
      { title: "A", start: 0, points: [{ t: 5, text: "kept", off: "false", slide: "2" }, { text: "no time" }, { t: null, text: "null time" }, "junk"] },
      { title: "B", start: "60", end: 120, points: [{ t: 70, text: "also kept", off: "true" }] },
      { title: "Empty", start: 130, end: 140, points: [] }
    ],
    alerts: [{ t: 3, kind: null, text: "Quiz next week" }, { t: 4, kind: "Deadline" }],
    flashcards: [{ q: "q1", a: "a1" }, { q: "q2" }],
    quiz: [{ q: "numbers", opts: [3, 4, 5, 6], a: 1 }, { q: "letter", opts: ["w", "x", "y", "z"], a: "C" }, { q: "bad letter", opts: ["w", "x"], a: "D" }]
  }));
  assert.deepEqual(m.sections.map(s => [s.title, s.start, s.end, s.points.map(p => [p.t, p.text, p.off, p.slide])]),
    [["A", 0, null, [[5, "kept", false, 2]]], ["B", 60, 120, [[70, "also kept", true, null]]]]);
  assert.deepEqual(m.alerts, [{ t: 3, kind: "", text: "Quiz next week", date: null }]);
  assert.deepEqual(m.flashcards, [{ q: "q1", a: "a1" }]);
  assert.deepEqual(m.quiz.map(q => [q.opts, q.a]), [[["3", "4", "5", "6"], 1], [["w", "x", "y", "z"], 2], [["w", "x"], null]]);
  const { detail } = buildDetail(m, { ...ctx, duration: 5400, slidePages: [] });   // a 90-minute lecture: room for both questions
  assert.deepEqual(detail.sections.map(s => [s.start, s.end]), [[0, 60], [60, 120]]);
  assert.deepEqual(detail.quiz.map(q => q.q), ["numbers", "letter"]);
  assert.equal(detail.alerts[0].kind, "Exam hint");
  DetailSchema.parse(detail);
});

test("buildDetail: a section with no start begins at its first point; the last one with no end runs to the end", () => {
  const { detail } = buildDetail(parseModelNotes(JSON.stringify({ sections: [{ title: "Only", points: [{ t: 42, text: "x" }] }] })), { ...ctx, slidePages: [] });
  assert.deepEqual([detail.sections[0].start, detail.sections[0].end], [42, 600]);
});

test("slideLabel: the pages as they are, a range only over pages that are all there", () => {
  assert.equal(slideLabel([]), undefined); assert.equal(slideLabel([4, 4]), "Slide 4"); assert.equal(slideLabel([6, 3, 4, 5]), "Slides 3 to 6");
  assert.equal(slideLabel([3, 1]), "Slides 1 and 3"); assert.equal(slideLabel([6, 3, 4]), "Slides 3 to 4 and 6"); assert.equal(slideLabel([1, 2, 3, 5, 8]), "Slides 1 to 3, 5 and 8");
});

test("slideLabels: a page counts for the section with most of its points, so a look ahead or back does not stretch a label", () => {
  /* The lecture of the test of 2026-11-18, page numbers only: "Slides 1 to 3", "Slide 2", "Slide 3", "Slides 3 to 4" before. */
  const sec = (...pages: (number | null)[]) => ({ points: pages.map(slide => ({ slide })) });
  assert.deepEqual(slideLabels([sec(1, 3), sec(2, 2, 2, 2), sec(3, 3), sec(4, 4, 4, 3, 4)]), ["Slide 1", "Slide 2", "Slide 3", "Slide 4"]);
  /* A page shared evenly counts for both (2); page 1 counts where most of its points are; no pages, no label. */
  assert.deepEqual(slideLabels([sec(1, 2), sec(2, 3), sec(3, 3, 1, 1), sec(null)]), ["Slide 2", "Slide 2", "Slides 1 and 3", undefined]);
  /* A section whose pages all count elsewhere keeps its own. */
  assert.deepEqual(slideLabels([sec(5), sec(5, 5, 6)]), ["Slide 5", "Slides 5 to 6"]);
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

test("cantoneseTraditional: Simplified Cantonese from speech-to-text becomes Hong Kong Traditional, 係 included", async () => {
  const { cantoneseTraditional } = await import("../src/notes/zh");
  assert.equal(cantoneseTraditional("即系话，你拣咗一样嘢，就系机会成本。"), "即係話，你揀咗一樣嘢，就係機會成本。");
  assert.equal(cantoneseTraditional("我系经济系学生，系咪？唔系。关系好重要。"), "我係經濟系學生，係咪？唔係。關係好重要。");
  assert.equal(cantoneseTraditional("opportunity cost 都系 important"), "opportunity cost 都係 important");
});

test("flashcards and questions follow the length: at most about one card per 6 minutes and one question per 10, asked for and kept", () => {
  assert.deepEqual([60, 1200, 3600, 5400, 3 * 3600].map(x => studyCounts(x)), [
    { cards: 2, quiz: 1 }, { cards: 3, quiz: 2 }, { cards: 10, quiz: 6 }, { cards: 15, quiz: 9 }, { cards: 15, quiz: 10 }]);
  const input = { courseCode: "ECON 1001", courseName: "", title: "t", date: "Fri 20 Nov 2026", language: "en" as const, duration: 60, lines: [], slides: [], zh: null };
  const short = systemPrompt(input), long = systemPrompt({ ...input, duration: 5400 });
  assert.match(short, /Up to 2 flashcards and up to 1 multiple-choice question with 4 options/);
  assert.match(long, /Up to 15 flashcards and up to 9 multiple-choice questions with 4 options/);
  assert.match(short, /Never ask about how the class is run/);
  const many = parseModelNotes(JSON.stringify({ sections: [{ title: "A", start: 0, end: 60, points: [{ t: 5, text: "p" }] }],
    flashcards: Array.from({ length: 8 }, (_, i) => ({ q: "q" + i, a: "a" + i })),
    quiz: Array.from({ length: 5 }, (_, i) => ({ q: "Q" + i, opts: ["a", "b", "c", "d"], a: 0 })) }));
  const { detail } = buildDetail(many, { ...ctx, duration: 60, slidePages: [] });
  assert.deepEqual([detail.flashcards.map(f => f.q), detail.quiz.map(q => q.q)], [["q0", "q1"], ["Q0"]], "a 1-minute recording keeps 2 cards and 1 question");
});
