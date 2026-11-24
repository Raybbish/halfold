/* Marks made in class, questions about a lecture, and flashcard review across lectures (API-CHANGES.md section 15, the
   designer's INTEGRATION.md 2026-11-19 section 0.1). Paths are under /api; every one needs a token. */
import { Hono, type Context } from "hono";
import type { AskReply, Line, MarkKind, ReviewReply } from "../../src/types";
import { fail, jsonBody } from "./http/errors";
import { str, type AppEnv, type Deps } from "./routes";
import { MAX_QUESTION, type AskCall } from "./notes/ask";

const KINDS: MarkKind[] = ["important", "lost"];
const MAX_MARKS = 500, MAX_MARK_SECONDS = 12 * 3600, MAX_REVIEW = 1000;
const NO_CARD = "This flashcard is no longer there. Open the lecture again to see its cards.";

export function studyRoutes(deps: Deps) {
  const { store, ask } = deps;
  const r = new Hono<AppEnv>();
  const mine = (c: Context<AppEnv>) => store.userLecture(c.get("user").id, c.req.param("id")!) ?? fail(404, "This lecture does not exist.");

  /* ---------- marks: {t, kind} ----------
     Sent while recording ("Important", "Lost me"); they come back in detail.marks with the notes. Any lecture of the
     student's takes them. A mark sent twice is kept once. */
  r.post("/lectures/:id/marks", async c => {
    const l = mine(c), b = await jsonBody(c), kind = str(b.kind) as MarkKind, t = b.t;
    if (!KINDS.includes(kind)) fail(400, "A mark is either important or lost.");
    if (typeof t !== "number" || !Number.isFinite(t) || t < 0 || t > MAX_MARK_SECONDS) fail(400, "The time of the mark could not be read.");
    if (store.markCount(l.id) >= MAX_MARKS) fail(409, `A lecture can keep at most ${MAX_MARKS} marks.`);
    store.addMark(l.id, Math.round((t as number) * 10) / 10, kind);
    return c.body(null, 204);
  });

  /* ---------- a question about one lecture: {question} -> {answer, refs} ----------
     Answered from the transcript (notes/ask.ts). refs are lines of it, with their times. Every call is logged in costs
     (stage "ask"), also one whose reply could not be used. Not the question itself: only its length. */
  r.post("/lectures/:id/ask", async c => {
    const user = c.get("user"), l = mine(c), question = str((await jsonBody(c)).question);
    if (!question) fail(400, "Write a question first.");
    if (question.length > MAX_QUESTION) fail(400, `A question can be at most ${MAX_QUESTION} characters.`);
    const d = store.detail(l.id) ?? fail(409, "Ask about this lecture once its notes are ready.");
    /* The transcript; a lecture without one (none so far) is asked about from its timed notes. */
    const lines: Line[] = d.transcript.length ? d.transcript : d.sections.flatMap(s => s.points).filter(p => p.t != null).map(p => ({ t: p.t as number, text: p.text }));
    if (!lines.length) fail(409, "This lecture has nothing to ask about yet.");
    const course = store.course(user.id, l.course_id);
    const log = (u: AskCall["usage"], at: Date, ok: boolean, refs: number | null) => {
      const price = ask.usd(u, at);
      store.logCost({ lectureId: l.id, userId: user.id, stage: "ask", provider: ask.provider, model: ask.model, inputTokens: u.inputTokens,
        cachedInputTokens: u.cachedInputTokens, outputTokens: u.outputTokens, reasoningTokens: u.reasoningTokens, usd: price.usd,
        meta: { ...price.meta, completed: ok, lines: lines.length, questionChars: question.length, refs } });
    };
    try {
      const call = await ask.answer({ courseCode: course?.code || "", title: l.title, language: l.language, question, lines }, c.req.raw.signal);
      log(call.usage, call.startedAt, true, call.refs.length);
      return c.json<AskReply>({ answer: call.answer, refs: call.refs.map(i => ({ t: lines[i].t, text: lines[i].text })) });
    } catch (e) {
      const u = (e as { usage?: AskCall["usage"] }).usage;
      if (u) log(u, (e as { startedAt?: Date }).startedAt || new Date(), false, null);
      console.warn(`[ask] ${l.id}: ${(e as Error).message}`);
      fail(502, "Hal could not answer that just now. Try again in a moment.");
    }
  });

  /* ---------- review across lectures ---------- */
  /* Every flashcard not marked as known, newest lecture first, at most 1000. */
  r.get("/review", c => c.json<ReviewReply>({ cards: store.reviewCards(c.get("user").id).slice(0, MAX_REVIEW) }));
  /* {index, known}: one card known (or not) from the Review page. The lecture's other cards and its quiz score stay. */
  r.put("/lectures/:id/cards/known", async c => {
    const l = mine(c), b = await jsonBody(c), index = b.index;
    if (typeof index !== "number" || !Number.isInteger(index) || index < 0) fail(400, "The flashcard was not given.");
    if (typeof b.known !== "boolean") fail(400, "Say whether the flashcard is known.");
    const d = store.detail(l.id);
    if (!d || !d.flashcards[index as number]) fail(404, NO_CARD);
    store.setCardKnown(l.id, index as number, b.known as boolean);
    return c.body(null, 204);
  });

  return r;
}
