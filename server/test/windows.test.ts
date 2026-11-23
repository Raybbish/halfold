/* The live transcript's windows (src/live/windows.ts) and its exam alerts (src/live/alerts.ts). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { cutWindow, dropRepeat, holdUnfinished, HOLD, MAX_HELD, shift } from "../src/live/windows";
import { alertKind, findAlerts } from "../src/live/alerts";
import type { Word } from "../src/stt/types";

const w = (text: string, start: number, end: number): Word => ({ text, start, end });

test("cutWindow: keeps the words that end before the held tail, and stops halfway through the next gap", () => {
  const words = [w("one", 1, 2), w("two", 3, 4), w("three", 12, 12.8), w("four", 14.1, 14.9)];
  const cut = cutWindow(words, 0, 15, false);
  assert.deepEqual(cut.keep.map(x => x.text), ["one", "two", "three"]);   // "four" ends inside the last HOLD seconds
  assert.equal(cut.next, 15 - HOLD);   // "four" starts after the hold line: the next round starts there
  /* A word running across the hold line is not kept either. */
  const across = cutWindow([w("a", 1, 2), w("long", 12.5, 13.5)], 0, 15, false);
  assert.deepEqual(across.keep.map(x => x.text), ["a"]);
  assert.equal(across.next, (2 + 12.5) / 2);
});

test("cutWindow: silence moves on but still holds the tail; final keeps everything", () => {
  assert.deepEqual(cutWindow([], 30, 45, false), { keep: [], next: 45 - HOLD });
  /* No word finished yet, one is running: wait at its start. */
  assert.deepEqual(cutWindow([w("x", 40, 44)], 30, 45, false), { keep: [], next: 40 });
  /* The last word of a window with nothing after it: the tail is held anyway, in case a word starts there. */
  assert.equal(cutWindow([w("a", 31, 32)], 30, 45, false).next, 45 - HOLD);
  const fin = cutWindow([w("b", 44, 45.5), w("a", 31, 32)], 30, 45.5, true);
  assert.deepEqual(fin.keep.map(x => x.text), ["a", "b"]); assert.equal(fin.next, 45.5);
  /* A window shorter than the hold keeps nothing and does not move. */
  assert.deepEqual(cutWindow([w("a", 30.2, 30.5)], 30, 31.5, false), { keep: [], next: 30 });
});

test("dropRepeat: the end of the last word heard again at the start of the next window is dropped once", () => {
  const last = w("放", 27.0, 27.3);
  assert.deepEqual(dropRepeat([w("放", 27.35, 27.5), w("棄", 27.5, 27.7)], last).map(x => x.text), ["棄"]);
  assert.deepEqual(dropRepeat([w("Cost.", 40.1, 40.5)], w("cost", 39.8, 40.0)).map(x => x.text), []);
  /* Said again later, or a different word: kept. */
  assert.equal(dropRepeat([w("放", 29, 29.2)], last).length, 1);
  assert.equal(dropRepeat([w("棄", 27.35, 27.5)], last).length, 1);
  assert.equal(dropRepeat([w("放", 27.35, 27.5)], undefined).length, 1);
});

test("holdUnfinished: the words after the last sentence end wait for the next round, unless the sentence never ends", () => {
  const words = [w("Supply", 1, 1.5), w("rises.", 1.5, 2), w("Demand", 3, 3.5), w("falls", 3.5, 4)];
  assert.deepEqual(holdUnfinished(words, 15), { send: words.slice(0, 2), held: words.slice(2) });
  assert.deepEqual(holdUnfinished([w("價格上升。", 1, 2)], 15), { send: [w("價格上升。", 1, 2)], held: [] });
  assert.deepEqual(holdUnfinished([w("no", 1, 2), w("end", 2, 3)], 15).send, []);
  assert.deepEqual(holdUnfinished([w("no", 1, 2), w("end", 2, 3)], 1 + MAX_HELD + 1), { send: [w("no", 1, 2), w("end", 2, 3)], held: [] });
  /* No punctuation (Deepgram multi): a word marked endsSentence is a sentence end too. */
  const marked = [w("首先", 1, 1.5), { ...w("我哋", 1.5, 2), endsSentence: true }, w("好多", 3, 3.5)];
  assert.deepEqual(holdUnfinished(marked, 15), { send: marked.slice(0, 2), held: marked.slice(2) });
});

test("shift: window times become recording times", () => {
  assert.deepEqual(shift([w("a", 0.5, 1)], 60), [w("a", 60.5, 61)]);
});

test("alerts: exam, quiz and deadline lines in English and Chinese; ordinary lines are not alerts", () => {
  assert.equal(alertKind("The midterm is on November 26."), "Midterm");
  assert.equal(alertKind("期中考會考第一至第五章。"), "Midterm");
  assert.equal(alertKind("The final exam is three hours."), "Final");
  assert.equal(alertKind("期末考試在十二月。"), "Final");
  assert.equal(alertKind("There will be a quiz in week 7."), "Quiz");
  assert.equal(alertKind("下星期有小測。"), "Quiz");
  assert.equal(alertKind("Problem set two is due next Friday."), "Deadline");
  assert.equal(alertKind("下個星期三交第二次作業。"), "Deadline");
  assert.equal(alertKind("The deadline for the essay is Monday."), "Deadline");
  assert.equal(alertKind("This comes up in the exam every year."), "Exam hint");
  assert.equal(alertKind("呢個位考試好常出。"), "Exam hint");
  for (const plain of ["For example, think about coffee.", "That is due to higher costs.", "Our final answer is 2.", "Let me check the homework from last week.", "你要考慮機會成本。", "我哋會考慮呢個問題。", "參考第三章。"])
    assert.equal(alertKind(plain), null, plain);
});

test("findAlerts: one alert of a kind per two minutes", () => {
  const lines = [{ t: 10, text: "The midterm is on the 26th." }, { t: 40, text: "The midterm covers chapters 1 to 5." }, { t: 50, text: "And a quiz next week." }, { t: 200, text: "Again, the midterm." }];
  const got = findAlerts(lines, []);
  assert.deepEqual(got.map(a => [a.t, a.kind]), [[10, "Midterm"], [50, "Quiz"], [200, "Midterm"]]);
  assert.deepEqual(findAlerts([{ t: 60, text: "The midterm is hard." }], [{ t: 10, kind: "Midterm", text: "x" }]), []);
});
