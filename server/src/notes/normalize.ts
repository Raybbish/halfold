/* The model's JSON -> Detail. The reply is read leniently, item by item: numbers given as strings, "true" for true, a
   letter for a quiz answer, missing lists. An item that still cannot be used (a point with no time or text, a flashcard
   with no answer) is dropped on its own, so one slip does not cost a whole second call. Then the notes are tidied to
   the rules of INTEGRATION.md 3.2: times are whole seconds within the recording, sections follow one another, slide
   numbers exist, alert kinds use the words the front end translates, quiz answers point at an option. No notes at all
   is an error. The pipeline checks the result against DetailSchema. */
import type { Alert, Detail, Line, Point, QuizQuestion, Section, Slide } from "../../../src/types";
import { zhForms } from "./zh";
import { studyCounts } from "./prompt";

/* zhHans, zhHant: the Chinese explanation in each script, as the model wrote it; zh: a single one (older replies). */
export interface ModelPoint { t: number; text: string; zhHans: string | null; zhHant: string | null; zh: string | null; slide: number | null; off: boolean }
export interface ModelSection { title: string; start: number | null; end: number | null; points: ModelPoint[] }
export interface ModelNotes {
  sections: ModelSection[];
  slides: { n: number; title: string }[];
  alerts: { t: number; kind: string; text: string; date: string | null }[];
  flashcards: { q: string; a: string }[];
  quiz: { q: string; opts: string[]; a: number | null; why: string | null; t: number | null }[];
  summary: string[];   // the lecture in 3 to 5 sentences
  title: string;       // what the lecture is about; "" when the model gave none
}

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | null => v && typeof v === "object" && !Array.isArray(v) ? v as Obj : null;
const items = <T>(v: unknown, read: (o: Obj) => T | null): T[] =>
  (Array.isArray(v) ? v : []).map(x => { const o = obj(x); return o ? read(o) : null; }).filter((x): x is T => x !== null);
const num = (v: unknown) => typeof v === "number" ? (Number.isFinite(v) ? v : null)
  : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : null;
const str = (v: unknown) => typeof v === "string" ? v.trim() : typeof v === "number" && Number.isFinite(v) ? String(v) : "";
const yes = (v: unknown) => v === true || (typeof v === "string" && v.trim().toLowerCase() === "true");
/* 1, "1" or "B" (for the second option). */
const answer = (v: unknown, count: number) => {
  const n = num(v); if (n !== null) return n;
  const s = str(v).toUpperCase();
  return /^[A-Z]$/.test(s) && s.charCodeAt(0) - 65 < count ? s.charCodeAt(0) - 65 : null;
};

/* Parses the model's reply. Throws an Error whose message can be shown to the model to correct itself. */
export function parseModelNotes(reply: string): ModelNotes {
  let json: unknown;
  try { json = JSON.parse(reply.trim().replace(/^```(?:json)?\s*|\s*```$/g, "")); }
  catch (e) { throw new Error("it is not valid JSON (" + (e as Error).message + ")"); }
  const top = obj(json);
  if (!top || !Array.isArray(top.sections)) throw new Error('it does not have the fields asked for: "sections" must be a list');
  const sections = items(top.sections, s => {
    const points = items(s.points, p => {
      const t = num(p.t), text = str(p.text);
      return t === null || !text ? null : { t, text, zhHans: str(p.zhHans) || null, zhHant: str(p.zhHant) || null, zh: str(p.zh) || null, slide: num(p.slide), off: yes(p.off) };
    });
    return points.length ? { title: str(s.title), start: num(s.start), end: num(s.end), points } : null;
  });
  if (!sections.length) throw new Error("it has no sections with points (each point needs a time \"t\" and a \"text\")");
  return {
    sections,
    slides: items(top.slides, s => { const n = num(s.n); return n === null ? null : { n, title: str(s.title) }; }),
    alerts: items(top.alerts, a => { const t = num(a.t), text = str(a.text); return t === null || !text ? null : { t, kind: str(a.kind), text, date: str(a.date) || null }; }),
    flashcards: items(top.flashcards, f => { const q = str(f.q), a = str(f.a); return q && a ? { q, a } : null; }),
    quiz: items(top.quiz, q => {
      const opts = (Array.isArray(q.opts) ? q.opts : []).map(str);
      return { q: str(q.q), opts, a: answer(q.a, opts.length), why: str(q.why) || null, t: num(q.t) };
    }),
    summary: (Array.isArray(top.summary) ? top.summary : []).map(str).filter(Boolean),
    title: str(top.title)
  };
}

export interface BuildContext { duration: number; lines: Line[]; slidePages: { n: number; text: string }[]; zh: boolean }
export interface Dated { date: string; kind: string; text: string; t: number }

const KINDS: Record<string, string> = { midterm: "Midterm", "mid-term": "Midterm", deadline: "Deadline", "exam hint": "Exam hint", exam: "Exam hint", quiz: "Quiz", final: "Final", "final exam": "Final" };
const realDate = (s: string | null | undefined) => {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(s + "T00:00:00Z");
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s ? s : null;
};
/* The pages as they are: "Slide 4", "Slides 3 to 6", "Slides 1 and 3", "Slides 1 to 3 and 5". A range is only written
   over pages that are all there, so a label never names a page that is not in it. */
export function slideLabel(nums: number[]) {
  const pages = [...new Set(nums)].sort((a, b) => a - b);
  if (!pages.length) return undefined;
  const runs: number[][] = [];
  for (const n of pages) { const r = runs[runs.length - 1]; if (r && n === r[r.length - 1] + 1) r.push(n); else runs.push([n]); }
  const items = runs.map(r => r.length > 1 ? `${r[0]} to ${r[r.length - 1]}` : String(r[0]));
  return (pages.length === 1 ? "Slide " : "Slides ") + (items.length > 1 ? items.slice(0, -1).join(", ") + " and " + items[items.length - 1] : items[0]);
}

/* Each section's label. A page counts for the section that has most of its points (each of them, on a tie), so a point
   that looks ahead or back to another topic's page does not stretch a label over pages it is not about (test of
   2026-11-18: a section about slide 1, with one point on slide 3, was "Slides 1 to 3"). A section whose pages all count
   elsewhere keeps its own. The points keep their page either way. */
export function slideLabels(sections: { points: { slide?: number | null }[] }[]): (string | undefined)[] {
  const per = sections.map(s => { const m = new Map<number, number>(); for (const p of s.points) if (p.slide != null) m.set(p.slide, (m.get(p.slide) || 0) + 1); return m; });
  const most = new Map<number, number>();
  for (const m of per) for (const [n, k] of m) most.set(n, Math.max(most.get(n) || 0, k));
  return per.map(m => { const all = [...m.keys()], own = all.filter(n => m.get(n) === most.get(n)); return slideLabel(own.length ? own : all); });
}

/* detail.slides: one per page, titled by the model, else by the first line of the page. */
export function slideList(pages: { n: number; text: string }[], titled: { n: number; title: string }[]): Slide[] {
  const have = new Set(pages.map(p => p.n));
  const titles = new Map(titled.filter(s => have.has(s.n) && s.title).map(s => [s.n, s.title.slice(0, 120)]));
  return pages.map(p => ({ n: p.n, title: titles.get(p.n) || p.text.split("\n").map(x => x.trim()).find(Boolean)?.slice(0, 80) || `Slide ${p.n}`, image: null }));
}

/* title: the model's title for the lecture, a single line of at most 120 characters, or null. */
export function buildDetail(m: ModelNotes, ctx: BuildContext): { detail: Detail; dated: Dated[]; title: string | null } {
  const end = Math.max(1, Math.round(ctx.duration));
  const at = (x: number) => Math.min(end, Math.max(0, Math.round(x)));
  const pages = new Set(ctx.slidePages.map(p => p.n)), hasSlides = pages.size > 0;

  const slides = slideList(ctx.slidePages, m.slides);

  const sections: Section[] = m.sections
    .map(s => {
      const points: Point[] = s.points.filter(p => p.text).map(p => {
        const slide = hasSlides && p.slide != null && pages.has(Math.round(p.slide)) ? Math.round(p.slide) : null;
        const zh = ctx.zh ? zhForms(p) : {};
        return { t: at(p.t), text: p.text, ...zh, off: hasSlides ? !!p.off : false, slide };
      }).sort((a, b) => (a.t as number) - (b.t as number));
      /* A section with no start begins at its first point; one with no end is closed below. */
      return { title: s.title || "Notes", start: at(s.start ?? Math.min(...s.points.map(p => p.t))), end: s.end === null ? -1 : at(s.end), points };
    })
    .filter(s => s.points.length)
    .sort((a, b) => a.start - b.start);
  if (!sections.length) throw new Error("the notes have no points");
  /* Sections follow one another: each ends where the next starts; the last ends where the model said, or at the end. */
  const labels = slideLabels(sections);
  sections.forEach((s, i) => {
    const next = sections[i + 1];
    s.end = next ? next.start : Math.max(s.start, s.end > s.start ? s.end : end);
    if (labels[i]) s.slides = labels[i];
  });

  const dated: Dated[] = [];
  const alerts: Alert[] = m.alerts.filter(a => a.text).map(a => {
    const kind = KINDS[a.kind.toLowerCase()] || a.kind || "Exam hint", t = at(a.t), date = realDate(a.date);
    if (date) dated.push({ date, kind, text: a.text, t });
    return { t, kind, text: a.text };
  }).sort((a, b) => a.t - b.t);

  const most = studyCounts(ctx.duration);
  const quiz: QuizQuestion[] = m.quiz
    .filter(q => q.q && q.opts.length >= 2 && q.opts.every(Boolean) && q.a !== null && Number.isInteger(q.a) && q.a >= 0 && q.a < q.opts.length)
    .map(q => ({ q: q.q, opts: q.opts, a: q.a!, ...(q.why ? { why: q.why } : {}), t: q.t === null ? null : at(q.t) }));

  const transcript = ctx.lines.filter(l => l.text.trim()).map(l => ({ t: at(l.t), text: l.text.trim() })).sort((a, b) => a.t - b.t);

  return {
    detail: { ...(m.summary.length ? { summary: m.summary.slice(0, 5) } : {}), alerts, sections, slides: hasSlides ? slides : [], transcript,
      flashcards: m.flashcards.slice(0, most.cards), quiz: quiz.slice(0, most.quiz) },
    dated,
    title: m.title.replace(/\s+/g, " ").trim().slice(0, 120) || null
  };
}
