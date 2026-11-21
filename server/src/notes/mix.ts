/* Quiz options in a mixed order. The model tends to put the right answer first (12 of 13 questions in the test of
   2026-11-18), so the options of each question are ordered by a hash of the question and the option. The order is fixed
   (the same question always shows the same order, on the shared page too) and mixing twice changes nothing, so it is done
   when notes are read (Store.detail, the review pack): notes written before this change are mixed as well, and nothing
   stored has to be rewritten. */
import type { QuizQuestion } from "../../../src/types";

function fnv(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

export function mixQuestion<Q extends QuizQuestion>(q: Q): Q {
  const order = q.opts.map((o, i) => ({ o, i, h: fnv(q.q + "\n" + o) })).sort((x, y) => x.h - y.h || x.i - y.i);
  return { ...q, opts: order.map(x => x.o), a: order.findIndex(x => x.i === q.a) };
}

export const mixQuiz = <Q extends QuizQuestion>(quiz: Q[]): Q[] => quiz.map(mixQuestion);
