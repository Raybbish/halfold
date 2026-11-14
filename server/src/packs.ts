/* Making review packs (GET and POST /courses/:id/review-pack, INTEGRATION.md 3.3), in this process, one run per course
   at a time. A pack the server was making when it stopped is made again at start (resume). The pack keeps the list of
   lectures it was made from; once the course's lectures with notes are no longer those (a lecture added, moved or
   deleted), GET reports "none" and the student makes it again (API-CHANGES.md section 1, moveLecture). */
import type { Detail } from "../../src/types";
import type { Config } from "./config";
import type { CourseRow, LectureRow, Store } from "./db";
import type { NotesCall, NotesWriter, Repair, TokenUsage } from "./notes/types";
import { packHints, packInput, quizExam, readPack, type PackInput, type PackLecture, type StoredPack } from "./notes/pack";
import { promptDate } from "./time";

export interface PackDeps { config: Config; store: Store; notes: NotesWriter }
const ATTEMPTS = 2;

/* The lectures of a course that have notes, in the order they were taught. */
export function notedLectures(store: Store, courseId: string): (LectureRow & { detail: Detail })[] {
  return store.courseLectures(courseId).flatMap(l => { const detail = store.detail(l.id); return detail ? [{ ...l, detail }] : []; });
}
export const lectureKey = (ids: string[]) => [...ids].sort().join(" ");

export class ReviewPacks {
  private running = new Map<string, AbortController>();
  private waiters: (() => void)[] = [];
  constructor(private readonly d: PackDeps) {}

  /* Marks the pack as being made and starts making it, unless that is already happening. */
  start(courseId: string) {
    if (this.running.has(courseId)) return;
    this.d.store.setPackProcessing(courseId);
    const ctl = new AbortController();
    this.running.set(courseId, ctl);
    void this.run(courseId, ctl.signal).finally(() => {
      this.running.delete(courseId);
      if (!this.running.size) this.waiters.splice(0).forEach(w => w());
    });
  }
  cancel(courseId: string) { this.running.get(courseId)?.abort(); }
  resume() { for (const p of this.d.store.packsWithStatus("processing")) this.start(p.course_id); }
  /* Resolves when no pack is being made (tests, shutdown). */
  idle() { return this.running.size ? new Promise<void>(r => this.waiters.push(r)) : Promise.resolve(); }
  stopAll() { for (const c of this.running.values()) c.abort(); }

  private async run(courseId: string, signal: AbortSignal) {
    const { store, config } = this.d;
    const gone = () => signal.aborted || !store.courseById(courseId);
    try {
      const course = store.courseById(courseId);
      if (!course) return;
      const lectures: PackLecture[] = notedLectures(store, courseId).map(l => ({
        id: l.id, title: l.title, date: promptDate(new Date(l.created_at), config.timezone), detail: l.detail,
        duration: l.duration ?? l.client_duration ?? Math.max(0, ...l.detail.sections.map(s => s.end))
      }));
      const ids = lectures.map(l => l.id);
      /* Nothing to revise yet: an empty pack, which the front end explains. */
      if (!lectures.length) { store.savePack(courseId, [], { hints: [], sheet: [], exam: [] } satisfies StoredPack); return; }

      const { input, ctx } = packInput(course, lectures);
      let made: ReturnType<typeof readPack> | null = null, repair: Repair | undefined, problem = "";
      for (let attempt = 1; attempt <= ATTEMPTS && !made; attempt++) {
        const call = await this.call(course, input, attempt, signal, repair);
        if (gone()) return;
        try { made = readPack(call.text, ctx); }
        catch (e) {
          problem = (e as Error).message; repair = { reply: call.text, problem };
          console.warn(`[review-pack] ${courseId} attempt ${attempt} unusable: ${problem}`);
        }
      }
      if (!made) throw new Error("the notes model did not write a usable review pack: " + problem);
      const pack: StoredPack = { hints: packHints(lectures), sheet: made.sheet, exam: made.exam.length ? made.exam : quizExam(lectures) };
      if (!gone()) store.savePack(courseId, ids, pack);
    } catch (e) {
      if (gone()) return;
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[review-pack] ${courseId} failed: ${msg}`);
      store.packFailed(courseId, msg);
    }
  }

  /* One model call, logged in the cost table (with the course id where a lecture id goes) whether or not it is usable. */
  private async call(course: CourseRow, input: PackInput, attempt: number, signal: AbortSignal, repair?: Repair): Promise<NotesCall> {
    const { notes, store } = this.d;
    const log = (u: TokenUsage, at: Date, ok: boolean) => {
      const price = notes.usd(u, at);
      store.logCost({ lectureId: course.id, userId: course.user_id, stage: "pack", provider: notes.provider, model: notes.model, inputTokens: u.inputTokens,
        cachedInputTokens: u.cachedInputTokens, outputTokens: u.outputTokens, reasoningTokens: u.reasoningTokens, usd: price.usd,
        meta: { ...price.meta, attempt, completed: ok, course: true, lectures: input.lectures.length, points: input.lectures.reduce((n, l) => n + l.sections.reduce((m, s) => m + s.points.length, 0), 0) } });
    };
    try {
      const call = await notes.reviewPack(input, signal, repair);
      log(call.usage, call.startedAt, true);
      return call;
    } catch (e) {
      const u = (e as { usage?: TokenUsage; startedAt?: Date }).usage;
      if (u) log(u, (e as { startedAt?: Date }).startedAt || new Date(), false);
      throw e;
    }
  }
}
