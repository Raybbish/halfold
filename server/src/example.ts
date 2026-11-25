/* The built-in example notes: ECON 1001 week 9 from the sample data the front end's sample build uses (src/api/sample.ts).
   "Example notes" on the public pages opens #/s/econ-w9 (EXAMPLE_SHARE_ID, by default this one), and GET /shared/econ-w9
   answers with these notes when no lecture in the database is shared under that id. Before (retest of 2026-11-23) the
   link was a 404 on a server without such a shared lecture.
   The sample gives one explanation per point, in Simplified; OpenCC writes the Traditional one. Slides are filed the way
   the sample build does it (mock.ts prep): each section's "Slides 3 to 6" become those pages, its points spread over them. */
import type { Detail, Point, SharedReply, Slide } from "../../src/types";
import { SAMPLE } from "../../src/api/sample";
import { zhForms } from "./notes/zh";

export const EXAMPLE_ID = "econ-w9";
/* Saving the example to one's own lectures (POST /shared/econ-w9/save) is refused with this; the front end does not offer it. */
export const EXAMPLE_NOT_SAVED = "These are example notes, so they cannot be saved. Record or upload a lecture to get notes like these.";

let made: SharedReply | null = null;

function build(): SharedReply {
  const src = structuredClone(SAMPLE), l = src.lectures.find(x => x.id === EXAMPLE_ID)!, course = src.courses.find(c => c.id === l.course)!;
  const slides: Slide[] = [];
  const sections = src.detail.sections.map(s => {
    const m = /(\d+)\D+(\d+)/.exec(s.slides)!, a = +m[1], b = +m[2];
    for (let n = a; n <= b; n++) slides.push({ n, title: s.title, image: null });
    const points: Point[] = s.points.map((p, k) => {
      const { zh, off, ...rest } = p as typeof p & { zh?: string; off?: boolean };
      return { ...rest, ...zhForms({ zh }), off: !!off, slide: a + Math.floor(k * (b - a + 1) / s.points.length) };
    });
    return { title: s.title, slides: s.slides, start: s.start, end: s.end, points };
  });
  const detail: Detail = { alerts: src.detail.alerts, sections, slides, transcript: src.detail.transcript, flashcards: src.detail.flashcards, quiz: src.detail.quiz };
  return {
    lecture: { id: EXAMPLE_ID, course: course.id, title: l.title, week: l.week, date: l.date, duration: l.duration, status: "ready", shareUrl: null },
    course: { id: course.id, code: course.code, name: course.name },
    detail, sharedBy: "Halfold", example: true
  };
}

/* A fresh copy each time: the reply is not shared between requests. */
export function exampleNotes(): SharedReply { made ??= build(); return structuredClone(made); }
