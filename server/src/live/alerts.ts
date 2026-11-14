/* Alerts on the recording screen: a line of the live transcript that mentions an exam, a quiz or a deadline pops up as
   it is said ("the midterm is on the 26th"). Found by keywords, not by a model: it costs nothing and the line is shown as
   it was said. The notes written after the lecture have the real alerts, with dates. */
import type { Alert, Line } from "../../../src/types";

const DEADLINE_WORK = /\b(assignments?|homework|problem sets?|essays?|reports?|projects?|lab reports?|tutorials?)\b|功課|作業|作业|功课|報告|报告|習題|习题|練習|练习/i;
const DEADLINE_WHEN = /\b(due|deadline|submit|submitted|hand (it |them )?in|turn (it |them )?in)\b|截止|交|下(個|个)?(星期|禮拜|礼拜|週|周)/i;

/* The kind is one of the words the front end translates (INTEGRATION.md 3.2). Earlier rules win. */
const RULES: [string, (text: string) => boolean][] = [
  ["Midterm", t => /\bmid[- ]?terms?\b/i.test(t) || /期中/.test(t)],
  ["Final", t => /\bfinal (exam|examination|test|paper)s?\b|\bfinals\b/i.test(t) || /期末/.test(t)],
  ["Quiz", t => /\bquiz(zes)?\b/i.test(t) || /測驗|测验|小測|小测|小考/.test(t)],
  ["Deadline", t => /\bdeadlines?\b|\bdue (on|by|next|this|tomorrow|today|at|before|in|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i.test(t) || /截止/.test(t) || (DEADLINE_WORK.test(t) && DEADLINE_WHEN.test(t))],
  /* 會考, 要考 ("will be examined") but not 會考慮, 要考慮 ("will consider"). */
  ["Exam hint", t => /\bexams?\b|\bexamination\b|\bin the test\b|\bon the test\b/i.test(t) || /考試|考试|考題|考题|考到|[會会要常]考(?![慮虑察核究])/.test(t)]
];

export function alertKind(text: string): string | null {
  for (const [kind, hit] of RULES) if (hit(text)) return kind;
  return null;
}

const SAME_KIND_GAP = 120;   // seconds: one alert of a kind per two minutes, so a long announcement is not five pop-ups

/* New alerts for new lines, given the alerts already raised in this recording. */
export function findAlerts(lines: Line[], earlier: Alert[]): Alert[] {
  const out: Alert[] = [], seen = [...earlier];
  for (const l of lines) {
    const kind = alertKind(l.text);
    if (!kind || seen.some(a => a.kind === kind && Math.abs(a.t - l.t) < SAME_KIND_GAP)) continue;
    const a = { t: l.t, kind, text: l.text.slice(0, 300) };
    out.push(a); seen.push(a);
  }
  return out;
}
