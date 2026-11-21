/* The review pack of a course (INTEGRATION.md 3.3): what the lecturer flagged, one revision sheet grouped by topic, and
   a mock exam. "What the lecturer flagged" is every alert of every lecture, as it is: no model needed. For the sheet the
   model only groups and picks points by number, so every point on it is the student's own notes (with their edits)
   and links back to the second it was said; it writes the topic names and the exam questions. */
import type { Detail, QuizQuestion } from "../../../src/types";

export interface PackLecture { id: string; title: string; date: string; duration: number; detail: Detail }
export interface PackInput {
  courseCode: string;
  courseName: string;
  lectures: { n: number; title: string; date: string; sections: { title: string; points: { id: number; t: number | null; text: string; off: boolean }[] }[]; alerts: { kind: string; text: string }[] }[];
}

/* Stored without lecture titles: those are filled in when the pack is read, so a renamed lecture shows its new title. */
export interface StoredPack {
  hints: { t: number; kind: string; text: string; lectureId: string }[];
  sheet: { topic: string; points: { text: string; off: boolean; t: number | null; lectureId: string }[] }[];
  exam: (QuizQuestion & { lectureId: string })[];
}

interface Ref { lectureId: string; text: string; off: boolean; t: number | null }
export interface PackContext { points: Map<number, Ref>; lectures: Map<number, { id: string; duration: number }> }

const MAX_EXAM = 25;

export function packInput(course: { code: string; name: string }, lectures: PackLecture[]): { input: PackInput; ctx: PackContext } {
  const ctx: PackContext = { points: new Map(), lectures: new Map() };
  let id = 0;
  const input: PackInput = {
    courseCode: course.code, courseName: course.name,
    lectures: lectures.map((l, i) => {
      ctx.lectures.set(i + 1, { id: l.id, duration: l.duration });
      return {
        n: i + 1, title: l.title, date: l.date,
        sections: l.detail.sections.map(s => ({
          title: s.title,
          points: s.points.map(p => { ctx.points.set(++id, { lectureId: l.id, text: p.text, off: !!p.off, t: p.t }); return { id, t: p.t, text: p.text, off: !!p.off }; })
        })),
        alerts: l.detail.alerts.map(a => ({ kind: a.kind, text: a.text }))
      };
    })
  };
  return { input, ctx };
}

export function packPrompt(input: PackInput) {
  const system = `You make the review pack for a whole university course for Halfold, an app for students. You get the notes of every lecture in the course; each point has a number. Reply with one JSON object and nothing else.

- "sheet": one revision sheet for the course, grouped by topic. A topic that runs across several lectures is one topic. Order the topics as the course teaches them, and give each a short name (at most 6 words). For each topic, list the numbers of the points a student needs for the exam: definitions, formulas, key examples, and everything the lecturer flagged for the exam. Points marked "(not on the slides)" were said in class only; keep them when they matter. Leave out admin, greetings and repetition. Use each point at most once.
- "exam": a mock exam of 10 to 20 multiple-choice questions, like a final exam. Mix the lectures, and test understanding and application, not only recall. 4 options each, none referring to another ("all of the above"), since they are shown in a mixed order; "a" is the index (0 to 3) of the right option; "why" explains the answer in one sentence; "lecture" is the number of the lecture where it is taught, and "t" the second in that lecture (take it from the point the question is based on).
- Only use what is in the notes. Do not add facts from elsewhere. Write in English.

The JSON object has exactly these fields:
{
  "sheet": [{ "topic": "Price elasticity", "points": [12, 40, 41] }],
  "exam": [{ "q": "...", "opts": ["...", "...", "...", "..."], "a": 1, "why": "...", "lecture": 2, "t": 860 }]
}`;
  const lectures = input.lectures.map(l => {
    const notes = l.sections.map(s => `## ${s.title}\n` + s.points.map(p => `[${p.id}] ${p.t == null ? "(added by the student)" : `(t=${p.t})`} ${p.text}${p.off ? " (not on the slides)" : ""}`).join("\n")).join("\n");
    const flagged = l.alerts.length ? `\nFlagged by the lecturer:\n${l.alerts.map(a => `- ${a.kind}: ${a.text}`).join("\n")}` : "";
    return `=== LECTURE ${l.n}: ${l.title} (${l.date}) ===\n${notes}${flagged}`;
  }).join("\n\n");
  const user = `Course: ${input.courseCode}${input.courseName ? " " + input.courseName : ""}\n\n${lectures}\n\nWrite the review pack as the JSON object described.`;
  return { system, user };
}

type Obj = Record<string, unknown>;
const num = (v: unknown) => typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : null;
const text = (v: unknown) => typeof v === "string" ? v.trim() : typeof v === "number" && Number.isFinite(v) ? String(v) : "";
const list = (v: unknown) => (Array.isArray(v) ? v : []).filter((x): x is Obj => !!x && typeof x === "object" && !Array.isArray(x));

/* The model's sheet and exam. Points it names that do not exist, or names twice, are skipped; a question that cannot be
   used is dropped. Throws (with a message for the model) when no topic has a usable point. */
export function readPack(reply: string, ctx: PackContext): Pick<StoredPack, "sheet" | "exam"> {
  let j: unknown;
  try { j = JSON.parse(reply.trim().replace(/^```(?:json)?\s*|\s*```$/g, "")); } catch (e) { throw new Error("it is not valid JSON (" + (e as Error).message + ")"); }
  const top = j && typeof j === "object" && !Array.isArray(j) ? j as Obj : null;
  if (!top || !Array.isArray(top.sheet)) throw new Error('it does not have the fields asked for: "sheet" must be a list');
  const used = new Set<number>();
  const sheet = list(top.sheet).flatMap(s => {
    const points = (Array.isArray(s.points) ? s.points : []).flatMap(x => {
      const id = num(x);
      if (id === null || !ctx.points.has(id) || used.has(id)) return [];
      used.add(id);
      const p = ctx.points.get(id)!;
      return [{ text: p.text, off: p.off, t: p.t, lectureId: p.lectureId }];
    });
    return points.length ? [{ topic: (text(s.topic) || "Topic").slice(0, 120), points }] : [];
  });
  if (!sheet.length) throw new Error('its "sheet" has no topic with the number of a point from the notes');
  const exam = list(top.exam).flatMap(q => {
    const opts = (Array.isArray(q.opts) ? q.opts : []).map(text), a = num(q.a), from = ctx.lectures.get(num(q.lecture) ?? -1), t = num(q.t);
    if (!text(q.q) || opts.length < 2 || !opts.every(Boolean) || a === null || !Number.isInteger(a) || a < 0 || a >= opts.length || !from) return [];
    return [{ q: text(q.q), opts, a, ...(text(q.why) ? { why: text(q.why) } : {}), t: t === null ? null : Math.min(Math.round(from.duration), Math.max(0, Math.round(t))), lectureId: from.id }];
  }).slice(0, MAX_EXAM);
  return { sheet, exam };
}

/* Everything the lecturers flagged, lecture by lecture; and the lectures' own quiz questions, when the model's mock
   exam had none that could be used. */
export function packHints(lectures: PackLecture[]): StoredPack["hints"] {
  return lectures.flatMap(l => l.detail.alerts.map(a => ({ t: a.t, kind: a.kind, text: a.text, lectureId: l.id })));
}
export function quizExam(lectures: PackLecture[]): StoredPack["exam"] {
  return lectures.flatMap(l => l.detail.quiz.map(q => ({ ...q, lectureId: l.id }))).slice(0, MAX_EXAM);
}
