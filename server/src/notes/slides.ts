/* Slides sent after the notes were written (API-CHANGES.md section 3). The notes are not written again: the model only
   says which slide each point belongs to and whether it is "off" (said in class, not on the slides), and gives each
   page a title. The text and order of the points, the student's edits and the student's own points (t null) stay as
   they are. Points are numbered 1, 2, 3... across the lecture in the prompt, so the reply refers to them unambiguously. */
import type { Detail, Point } from "../../../src/types";
import { slideLabel, slideList } from "./normalize";

export interface SlidesInput {
  courseCode: string;
  title: string;
  slides: { n: number; text: string }[];
  sections: { title: string; points: { id: number; text: string }[] }[];
}

/* The points the model is asked about: every point the lecturer said (t set), numbered from 1. The student's own
   points are left out and left alone. */
export function slidesInput(detail: Detail, head: { courseCode: string; title: string }, slides: SlidesInput["slides"]) {
  let id = 0;
  const where = new Map<number, [number, number]>();
  const sections = detail.sections.map((s, si) => ({
    title: s.title,
    points: s.points.flatMap((p, pi) => {
      if (p.t == null || p.mine) return [];
      where.set(++id, [si, pi]);
      return [{ id, text: p.text }];
    })
  }));
  return { input: { ...head, slides, sections } as SlidesInput, where };
}

export function slidesPrompt(input: SlidesInput) {
  const system = `You match lecture notes to the lecture slides for Sidenote, an app for university students. The notes were written from a recording of the lecture before the slides were available. You get the text of each slide page and the numbered points of the notes. Reply with one JSON object and nothing else.

- For each point: "slide" is the number of the slide page it belongs to (null if none fits), and "off" is true when the lecturer said it but it is NOT on the slides: an extra example, an explanation, a hint about the exam, a correction. This is what the student most needs, so judge it carefully against the slide text.
- "slides": one entry per slide page, with a short title (at most 8 words).
- Do not rewrite, merge or leave out points. Give every point once, by its number.

The JSON object has exactly these fields:
{
  "slides": [{ "n": 3, "title": "Opportunity cost" }],
  "points": [{ "id": 1, "slide": 3, "off": false }]
}`;
  const pages = input.slides.map(s => `--- Slide ${s.n} ---\n${s.text || "(no text)"}`).join("\n");
  const notes = input.sections.filter(s => s.points.length).map(s => `## ${s.title}\n` + s.points.map(p => `[${p.id}] ${p.text}`).join("\n")).join("\n\n");
  const user = `Course: ${input.courseCode || "-"}\nLecture title: ${input.title}\n\nSLIDES (text of each page)\n${pages}\n\nPOINTS OF THE NOTES (number in brackets)\n${notes}\n\nReply with the JSON object described.`;
  return { system, user };
}

export interface Filing { slides: { n: number; title: string }[]; points: Map<number, { slide: number | null; off: boolean }> }

type Obj = Record<string, unknown>;
const num = (v: unknown) => typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : null;
const list = (v: unknown) => (Array.isArray(v) ? v : []).filter((x): x is Obj => !!x && typeof x === "object" && !Array.isArray(x));

/* The model's reply. Throws an Error whose message can be shown to the model to correct itself. */
export function readFiling(reply: string, pointCount: number): Filing {
  let j: unknown;
  try { j = JSON.parse(reply.trim().replace(/^```(?:json)?\s*|\s*```$/g, "")); } catch (e) { throw new Error("it is not valid JSON (" + (e as Error).message + ")"); }
  const top = j && typeof j === "object" && !Array.isArray(j) ? j as Obj : null;
  if (!top || !Array.isArray(top.points)) throw new Error('it does not have the fields asked for: "points" must be a list');
  const points = new Map<number, { slide: number | null; off: boolean }>();
  for (const p of list(top.points)) {
    const id = num(p.id);
    if (id === null || !Number.isInteger(id) || id < 1 || id > pointCount || points.has(id)) continue;
    const slide = num(p.slide);
    points.set(id, { slide: slide === null ? null : Math.round(slide), off: p.off === true || String(p.off).toLowerCase() === "true" });
  }
  if (pointCount && !points.size) throw new Error(`it gives no points with a number from 1 to ${pointCount}`);
  const slides = list(top.slides).flatMap(s => { const n = num(s.n); return n === null ? [] : [{ n: Math.round(n), title: typeof s.title === "string" ? s.title.trim() : "" }]; });
  return { slides, points };
}

/* The notes with every point the model placed under its slide. A point it did not mention gets no slide and is not
   marked off. Section labels ("Slides 3 to 6") follow from the points. */
export function fileUnder(detail: Detail, pages: { n: number; text: string }[], filing: Filing, where: Map<number, [number, number]>): Detail {
  const valid = new Set(pages.map(p => p.n)), placed = new Map<string, { slide: number | null; off: boolean }>();
  for (const [id, f] of filing.points) { const at = where.get(id); if (at) placed.set(at.join("."), f); }
  const sections = detail.sections.map((s, si) => {
    const points: Point[] = s.points.map((p, pi) => {
      if (!where.size || p.t == null || p.mine) return p;
      const f = placed.get(`${si}.${pi}`);
      return { ...p, slide: f && f.slide !== null && valid.has(f.slide) ? f.slide : null, off: !!f?.off };
    });
    const { slides: _old, ...rest } = s;
    const label = slideLabel(points.map(p => p.slide).filter((x): x is number => x != null));
    return { ...rest, ...(label ? { slides: label } : {}), points };
  });
  return { ...detail, sections, slides: slideList(pages, filing.slides) };
}
