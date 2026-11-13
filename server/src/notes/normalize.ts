/* The model's JSON -> Detail. The reply is read leniently (numbers as strings, extra fields, missing lists) and then
   tidied to the rules of INTEGRATION.md 3.2: times are whole seconds within the recording, sections follow one another,
   slide numbers exist, alert kinds use the words the front end translates, quiz answers point at an option. What cannot
   be repaired is dropped; no notes at all is an error. The result is checked against DetailSchema by the pipeline. */
import { z } from "zod";
import type { Alert, Detail, Line, Point, QuizQuestion, Section, Slide } from "../../../src/types";
import { bothScripts } from "./zh";

const n = z.coerce.number().finite();
const text = z.string().transform(s => s.trim());
const ModelPoint = z.object({ t: n, text, zh: z.string().nullish(), slide: n.nullish(), off: z.boolean().nullish() });
const ModelSection = z.object({ title: text, start: n, end: n, points: z.array(ModelPoint) });
export const ModelNotesSchema = z.object({
  sections: z.array(ModelSection),
  slides: z.array(z.object({ n, title: text })).nullish(),
  alerts: z.array(z.object({ t: n, kind: text, text, date: z.string().nullish() })).nullish(),
  flashcards: z.array(z.object({ q: text, a: text })).nullish(),
  quiz: z.array(z.object({ q: text, opts: z.array(z.string()), a: n, why: z.string().nullish(), t: n.nullish() })).nullish()
});
export type ModelNotes = z.infer<typeof ModelNotesSchema>;

/* Parses the model's reply. Throws an Error whose message can be shown to the model to correct itself. */
export function parseModelNotes(reply: string): ModelNotes {
  let json: unknown;
  try { json = JSON.parse(reply.trim().replace(/^```(?:json)?\s*|\s*```$/g, "")); }
  catch (e) { throw new Error("it is not valid JSON (" + (e as Error).message + ")"); }
  const r = ModelNotesSchema.safeParse(json);
  if (!r.success) throw new Error("it does not have the fields asked for: " + r.error.issues.slice(0, 8).map(i => `${i.path.join(".") || "(top)"}: ${i.message}`).join("; "));
  if (!r.data.sections.some(s => s.points.some(p => p.text))) throw new Error("it has no sections with points");
  return r.data;
}

export interface BuildContext { duration: number; lines: Line[]; slidePages: { n: number; text: string }[]; zh: "hant" | "hans" | null }
export interface Dated { date: string; kind: string; text: string; t: number }

const KINDS: Record<string, string> = { midterm: "Midterm", "mid-term": "Midterm", deadline: "Deadline", "exam hint": "Exam hint", exam: "Exam hint", quiz: "Quiz", final: "Final", "final exam": "Final" };
const realDate = (s: string | null | undefined) => {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(s + "T00:00:00Z");
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s ? s : null;
};
export function slideLabel(nums: number[]) {
  if (!nums.length) return undefined;
  const lo = Math.min(...nums), hi = Math.max(...nums);
  return lo === hi ? `Slide ${lo}` : `Slides ${lo} to ${hi}`;
}

export function buildDetail(m: ModelNotes, ctx: BuildContext): { detail: Detail; dated: Dated[] } {
  const end = Math.max(1, Math.round(ctx.duration));
  const at = (x: number) => Math.min(end, Math.max(0, Math.round(x)));
  const pages = new Set(ctx.slidePages.map(p => p.n)), hasSlides = pages.size > 0;

  const titles = new Map((m.slides || []).filter(s => pages.has(s.n) && s.title).map(s => [s.n, s.title.slice(0, 120)]));
  const slides: Slide[] = ctx.slidePages.map(p => ({ n: p.n, title: titles.get(p.n) || p.text.split("\n").map(x => x.trim()).find(Boolean)?.slice(0, 80) || `Slide ${p.n}`, image: null }));

  const sections: Section[] = m.sections
    .map(s => {
      const points: Point[] = s.points.filter(p => p.text).map(p => {
        const slide = hasSlides && p.slide != null && pages.has(Math.round(p.slide)) ? Math.round(p.slide) : null;
        const zh = ctx.zh && p.zh && p.zh.trim() ? bothScripts(p.zh.trim(), ctx.zh) : {};
        return { t: at(p.t), text: p.text, ...zh, off: hasSlides ? !!p.off : false, slide };
      }).sort((a, b) => (a.t as number) - (b.t as number));
      return { title: s.title || "Notes", start: at(s.start), end: at(s.end), points };
    })
    .filter(s => s.points.length)
    .sort((a, b) => a.start - b.start);
  if (!sections.length) throw new Error("the notes have no points");
  /* Sections follow one another: each ends where the next starts; the last ends where the model said, or at the end. */
  sections.forEach((s, i) => {
    const next = sections[i + 1];
    s.end = next ? next.start : Math.max(s.start, s.end > s.start ? s.end : end);
    const label = slideLabel(s.points.map(p => p.slide).filter((x): x is number => x != null));
    if (label) s.slides = label;
  });

  const dated: Dated[] = [];
  const alerts: Alert[] = (m.alerts || []).filter(a => a.text).map(a => {
    const kind = KINDS[a.kind.toLowerCase()] || a.kind || "Exam hint", t = at(a.t), date = realDate(a.date);
    if (date) dated.push({ date, kind, text: a.text, t });
    return { t, kind, text: a.text };
  }).sort((a, b) => a.t - b.t);

  const quiz: QuizQuestion[] = (m.quiz || []).map(q => ({ ...q, opts: q.opts.map(o => String(o).trim()) }))
    .filter(q => q.q && q.opts.length >= 2 && q.opts.every(Boolean) && Number.isInteger(q.a) && q.a >= 0 && q.a < q.opts.length)
    .map(q => ({ q: q.q, opts: q.opts, a: q.a, ...(q.why && q.why.trim() ? { why: q.why.trim() } : {}), t: q.t == null ? null : at(q.t) }));

  const transcript = ctx.lines.filter(l => l.text.trim()).map(l => ({ t: at(l.t), text: l.text.trim() })).sort((a, b) => a.t - b.t);

  return {
    detail: { alerts, sections, slides: hasSlides ? slides : [], transcript, flashcards: (m.flashcards || []).filter(f => f.q && f.a), quiz },
    dated
  };
}
