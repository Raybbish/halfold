/* A study pack made from a slide deck alone, with no recording (lecture source "slides"). The model explains what the
   slides say, slide by slide, and writes flashcards and a quiz. With no recording there is no transcript, so nothing
   has a time, nothing is "off" (said in class but not on the slides) and there are no exam alerts: each point carries
   the number of the slide it explains (t null, slide n), and the result is a Detail with kind "slides".
   The reply is read leniently, item by item, like the notes (normalize.ts); an item that cannot be used is dropped on
   its own. No usable point at all is an error that can be shown to the model to correct itself. */
import type { Detail, Point, QuizQuestion, Section } from "../../../src/types";
import { bothScripts } from "./zh";
import { slideLabels, slideList } from "./normalize";

export interface SlidesPackInput {
  courseCode: string;
  courseName: string;
  title: string;
  slides: { n: number; text: string }[];
  zh: "hant" | "hans" | null;         // which script the Chinese explanations are written in; null = none
}

/* How many flashcards and quiz questions a deck is worth, at most: about one card for every 2 pages with text and one
   question for every 4; at least 2 and 1, at most 15 and 10 (the most a recorded lecture gets, prompt.ts studyCounts). */
export function packCounts(pages: { text: string }[]) {
  const n = pages.filter(p => p.text.trim()).length, clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
  return { cards: clamp(Math.round(n / 2), 2, 15), quiz: clamp(Math.round(n / 4), 1, 10) };
}

export function slidesPackPrompt(input: SlidesPackInput) {
  const zh = input.zh === "hans" ? "Simplified Chinese (as used in mainland China)" : "Traditional Chinese (as used in Hong Kong)";
  const n = packCounts(input.slides);
  const system = `You write a study pack for Halfold, an app for university students. The student has the lecturer's slide deck but no recording of the class; you get the text of each slide page. Reply with one JSON object and nothing else.

What the student needs:
- "title": what the deck is about, in English, at most 8 words (such as "Opportunity cost and the production frontier"). No date, no course code.
- "summary": the 3 to 5 most important things the slides teach, one short sentence each, in the order of the deck (1 or 2 for a short deck).
- Notes grouped by topic, in the order of the slides. Each section is one topic: one slide or a run of slides.
- Points: short, clear sentences in English that explain what the slides say, so that a student who was not in class understands them: what a term means, what a formula or a table shows, how one idea leads to the next. Keep the slides' definitions, numbers, formulas and examples. "slide" is the number of the slide page the point explains.
- Pages with nothing to learn (the title page, an outline, "Questions?", a list of references) get no points.${input.zh ? `
- "zh" on each point: one short explanation of the point in ${zh}, written for a student whose first language is Chinese. Use standard written Chinese (書面語). Explain the idea; do not just translate word for word. Keep key English terms in brackets where they help.` : ""}
- Up to ${n.cards} flashcards and up to ${n.quiz} multiple-choice question${n.quiz === 1 ? "" : "s"} with 4 options each, on the ideas worth remembering; fewer when the deck teaches less. Never ask about how the course is run. "a" is the index (0 to 3) of the right option, "why" explains it in one sentence, "slide" is the page it is taught on. The options are shown in a mixed order, so no option may refer to another ("all of the above", "both A and B").
- "slides": one entry per slide page you were given, with a short title (at most 8 words).

Rules:
- Explain what is on the slides; do not add to it. No topics, examples, facts or numbers that are not on the slides, and no guesses about what the lecturer said in class. A slide with only a few words gets a plain explanation of those words, not new material.
- The text was taken from a PDF: lines may be out of order, and pictures and charts are missing. Do not describe what you cannot see.
- Slides may be partly in Chinese: understand them, but write the notes in English.
- One to three points for a slide with something to learn; 3 to 10 sections for a deck of 40 pages, fewer for a short one.

The JSON object has exactly these fields:
{
  "title": "...",
  "summary": ["...", "..."],
  "sections": [{ "title": "Opportunity cost", "points": [{ "slide": 3, "text": "..."${input.zh ? `, "zh": "..."` : ""} }] }],
  "slides": [{ "n": 3, "title": "Opportunity cost" }],
  "flashcards": [{ "q": "...", "a": "..." }],
  "quiz": [{ "q": "...", "opts": ["...", "...", "...", "..."], "a": 1, "why": "...", "slide": 3 }]
}`;
  const head = [`Course: ${input.courseCode || "-"}${input.courseName ? " " + input.courseName : ""}`, `Title the student gave: ${input.title}`].join("\n");
  const pages = input.slides.map(s => `--- Slide ${s.n} ---\n${s.text || "(no text)"}`).join("\n");
  const user = `${head}\n\nSLIDES (text of each page)\n${pages}\n\nWrite the study pack as the JSON object described.`;
  return { system, user };
}

export interface PackModel {
  title: string;
  summary: string[];
  sections: { title: string; points: { slide: number | null; text: string; zh: string | null }[] }[];
  slides: { n: number; title: string }[];
  flashcards: { q: string; a: string }[];
  quiz: { q: string; opts: string[]; a: number | null; why: string | null }[];
}

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | null => v && typeof v === "object" && !Array.isArray(v) ? v as Obj : null;
const items = <T>(v: unknown, read: (o: Obj) => T | null): T[] =>
  (Array.isArray(v) ? v : []).map(x => { const o = obj(x); return o ? read(o) : null; }).filter((x): x is T => x !== null);
const num = (v: unknown) => typeof v === "number" ? (Number.isFinite(v) ? v : null)
  : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : null;
const str = (v: unknown) => typeof v === "string" ? v.trim() : typeof v === "number" && Number.isFinite(v) ? String(v) : "";
/* 1, "1" or "B" (for the second option). */
const answer = (v: unknown, count: number) => {
  const n = num(v); if (n !== null) return n;
  const s = str(v).toUpperCase();
  return /^[A-Z]$/.test(s) && s.charCodeAt(0) - 65 < count ? s.charCodeAt(0) - 65 : null;
};

/* The model's reply. Throws an Error whose message can be shown to the model to correct itself. */
export function readSlidesPack(reply: string): PackModel {
  let json: unknown;
  try { json = JSON.parse(reply.trim().replace(/^```(?:json)?\s*|\s*```$/g, "")); }
  catch (e) { throw new Error("it is not valid JSON (" + (e as Error).message + ")"); }
  const top = obj(json);
  if (!top || !Array.isArray(top.sections)) throw new Error('it does not have the fields asked for: "sections" must be a list');
  const sections = items(top.sections, s => {
    const points = items(s.points, p => { const text = str(p.text); return text ? { slide: num(p.slide), text, zh: str(p.zh) || null } : null; });
    return points.length ? { title: str(s.title), points } : null;
  });
  if (!sections.length) throw new Error('it has no sections with points (each point needs a "text" and the "slide" it explains)');
  return {
    title: str(top.title),
    summary: (Array.isArray(top.summary) ? top.summary : []).map(str).filter(Boolean),
    sections,
    slides: items(top.slides, s => { const n = num(s.n); return n === null ? null : { n, title: str(s.title) }; }),
    flashcards: items(top.flashcards, f => { const q = str(f.q), a = str(f.a); return q && a ? { q, a } : null; }),
    quiz: items(top.quiz, q => { const opts = (Array.isArray(q.opts) ? q.opts : []).map(str); return { q: str(q.q), opts, a: answer(q.a, opts.length), why: str(q.why) || null }; })
  };
}

/* The pack as the front end reads it (INTEGRATION.md 3.2, kind "slides"). Sections have no time: start and end are 0,
   so they still follow one another. A point whose slide is not a page of the deck keeps its text and loses the number.
   title: the model's title for the deck, a single line of at most 120 characters, or null. */
export function buildSlidesPack(m: PackModel, ctx: { pages: { n: number; text: string }[]; zh: "hant" | "hans" | null }): { detail: Detail; title: string | null } {
  const pages = new Set(ctx.pages.map(p => p.n)), most = packCounts(ctx.pages);
  const sections: Section[] = m.sections.map(s => ({
    title: s.title || "Notes", start: 0, end: 0,
    points: s.points.map((p): Point => {
      const slide = p.slide !== null && pages.has(Math.round(p.slide)) ? Math.round(p.slide) : null;
      const zh = ctx.zh && p.zh ? bothScripts(p.zh, ctx.zh) : {};
      return { t: null, text: p.text, ...zh, off: false, slide };
    })
  }));
  const labels = slideLabels(sections);
  sections.forEach((s, i) => { if (labels[i]) s.slides = labels[i]; });
  const quiz: QuizQuestion[] = m.quiz
    .filter(q => q.q && q.opts.length >= 2 && q.opts.every(Boolean) && q.a !== null && Number.isInteger(q.a) && q.a >= 0 && q.a < q.opts.length)
    .map(q => ({ q: q.q, opts: q.opts, a: q.a!, ...(q.why ? { why: q.why } : {}), t: null }));
  return {
    detail: { kind: "slides", ...(m.summary.length ? { summary: m.summary.slice(0, 5) } : {}), alerts: [], sections, slides: slideList(ctx.pages, m.slides), transcript: [],
      flashcards: m.flashcards.slice(0, most.cards), quiz: quiz.slice(0, most.quiz) },
    title: m.title.replace(/\s+/g, " ").trim().slice(0, 120) || null
  };
}
