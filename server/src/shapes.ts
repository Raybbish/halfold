/* The reply shapes of reference/INTEGRATION.md section 3, as zod schemas. Each schema is declared with the front end's
   own type from src/types.ts (z.ZodType<Home> and so on), so a schema that drifts from the front end fails to compile.
   The pipeline checks every Detail against DetailSchema before a lecture is marked ready, and the contract tests check
   every reply. Objects are strict: a misspelt field is an error, not something the front end silently ignores. */
import { z } from "zod";
import type {
  Alert, AskReply, Audio, CatchUpReply, ChunkReply, Course, Detail, Flashcard, Home, Lecture, LectureReply, Line, Mark, NoteHit, PackHint, PackPoint,
  PackQuestion, PackTopic, Plan, Plans, Point, Profile, ProfileReply, QuizQuestion, ReviewCard, ReviewPack, ReviewReply, SchoolGuess, SearchReply,
  Section, SessionReply, Settings, SharedReply, Slide, StatusReply, Upcoming, UrlReply, Usage, User, Week
} from "../../src/types";

const seconds = z.number().finite().nonnegative();
const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const id = z.string().regex(/^[A-Za-z0-9_-]+$/);   // INTEGRATION.md section 1
export const StatusSchema = z.enum(["recording", "processing", "ready", "failed"]);

export const SourceSchema = z.enum(["record", "tab", "upload", "link"]);
/* The profile and consents (API-CHANGES.md 14), in GET /home's user. */
const instant = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
export const ProfileSchema: z.ZodType<Profile> = z.strictObject({
  school: z.string().max(80), major: z.string().max(80), yearOfStudy: z.enum(["", "y1", "y2", "y3", "y4", "tpg", "rpg", "other"]),
  gradYear: z.number().int().min(1000).max(9999).nullable(), origin: z.enum(["", "hk", "cn", "tw", "mo", "other"]),
  consentMarketing: z.boolean(), consentSurvey: z.boolean(), consentMarketingAt: instant.nullable(), consentSurveyAt: instant.nullable()
});
export const ProfileReplySchema: z.ZodType<ProfileReply> = z.strictObject({ profile: ProfileSchema });
export const UserSchema: z.ZodType<User> = z.strictObject({ name: z.string(), profile: ProfileSchema.nullable().optional(), profileSkipped: z.literal(true).optional() });
export const CourseSchema: z.ZodType<Course> = z.strictObject({ id, code: z.string().min(1), name: z.string().optional(), color: z.string().optional() });
export const LectureSchema: z.ZodType<Lecture> = z.strictObject({
  id, course: id, title: z.string(), week: z.number().int().optional(), date: z.string(), duration: seconds.optional(),
  status: StatusSchema.optional(), shareUrl: z.string().nullable().optional(), link: z.string().nullable().optional(), source: SourceSchema.optional(), error: z.string().min(1).optional()
});
export const UpcomingSchema: z.ZodType<Upcoming> = z.strictObject({ date: ymd, kind: z.string(), text: z.string(), course: z.string(), lecture: id, t: seconds });
export const WeekSchema: z.ZodType<Week> = z.strictObject({ lectures: z.number(), known: z.number(), quiz: z.number(), days: z.array(z.number()).optional() });
export const SettingsSchema: z.ZodType<Settings> = z.strictObject({ classLanguage: z.string(), zhDefault: z.boolean(), zhScript: z.enum(["hant", "hans"]).optional() });
export const UsageSchema: z.ZodType<Usage> = z.strictObject({ minutesToday: z.number().nonnegative(), minutesLimit: z.number().nonnegative(), audioDays: z.number().optional(),
  lecturesThisMonth: z.number().int().nonnegative().optional(), lecturesLimit: z.number().int().positive().optional() });
export const SchoolGuessSchema: z.ZodType<SchoolGuess> = z.strictObject({ en: z.string().min(1), zhHant: z.string().min(1), zhHans: z.string().min(1) });
export const HomeSchema: z.ZodType<Home> = z.strictObject({
  user: UserSchema, courses: z.array(CourseSchema), lectures: z.array(LectureSchema), upcoming: z.array(UpcomingSchema),
  week: WeekSchema.optional(), settings: SettingsSchema.optional(), usage: UsageSchema.optional(), today: ymd.optional(),
  reviewCount: z.number().int().nonnegative().optional(),
  schoolGuess: SchoolGuessSchema.optional()
});

export const AudioSchema: z.ZodType<Audio> = z.strictObject({ url: z.string().nullable().optional(), keptUntil: ymd.optional(), expired: z.boolean().optional() });
export const AlertSchema: z.ZodType<Alert> = z.strictObject({ t: seconds, kind: z.string().min(1), text: z.string().min(1) });
export const PointSchema: z.ZodType<Point> = z.strictObject({
  t: seconds.nullable(), text: z.string().min(1), zhHant: z.string().optional(), zhHans: z.string().optional(), zh: z.string().optional(),
  off: z.boolean().optional(), slide: z.number().int().positive().nullable().optional(), mine: z.boolean().optional()
});
/* A section can lose all its points when the student deletes them (phase 3); it stays, so the places of the other
   sections do not move (the edit endpoints find a point by its section and place). New notes never have one. */
export const SectionSchema: z.ZodType<Section> = z.strictObject({ title: z.string().min(1), slides: z.string().optional(), start: seconds, end: seconds, points: z.array(PointSchema) });
export const SlideSchema: z.ZodType<Slide> = z.strictObject({ n: z.number().int().positive(), title: z.string(), image: z.string().nullable().optional() });
export const LineSchema: z.ZodType<Line> = z.strictObject({ t: seconds, text: z.string().min(1) });
export const FlashcardSchema: z.ZodType<Flashcard> = z.strictObject({ q: z.string().min(1), a: z.string().min(1) });
const quizFields = {
  q: z.string().min(1), opts: z.array(z.string().min(1)).min(2), a: z.number().int().nonnegative(), why: z.string().optional(), t: seconds.nullable().optional()
};
export const MarkSchema: z.ZodType<Mark> = z.strictObject({ t: seconds, kind: z.enum(["important", "lost"]) });
const answerIsAnOption = (q: { a: number; opts: string[] }) => q.a < q.opts.length;
export const QuizSchema: z.ZodType<QuizQuestion> = z.strictObject(quizFields).refine(answerIsAnOption, "the answer index is not one of the options");
export const DetailSchema: z.ZodType<Detail> = z.strictObject({
  summary: z.array(z.string().min(1)).min(1).max(5).optional(), marks: z.array(MarkSchema).optional(),
  audio: AudioSchema.nullable().optional(), progress: z.strictObject({ known: z.array(z.number().int().nonnegative()) }).optional(),
  alerts: z.array(AlertSchema), sections: z.array(SectionSchema).min(1), slides: z.array(SlideSchema), transcript: z.array(LineSchema),
  flashcards: z.array(FlashcardSchema), quiz: z.array(QuizSchema)
}).superRefine((d, ctx) => {
  /* INTEGRATION.md 3.2: the transcript is sorted by t; sections follow one another; a point's slide is one of the slides. */
  for (let i = 1; i < d.transcript.length; i++) if (d.transcript[i].t < d.transcript[i - 1].t) { ctx.addIssue({ code: "custom", message: "transcript is not sorted by t", path: ["transcript", i] }); break; }
  d.sections.forEach((s, i) => {
    if (s.end < s.start) ctx.addIssue({ code: "custom", message: "section ends before it starts", path: ["sections", i] });
    if (i > 0 && s.start !== d.sections[i - 1].end) ctx.addIssue({ code: "custom", message: "sections do not follow one another", path: ["sections", i] });
  });
  const pages = new Set(d.slides.map(s => s.n));
  d.sections.forEach((s, i) => s.points.forEach((p, j) => {
    if (p.slide != null && !pages.has(p.slide)) ctx.addIssue({ code: "custom", message: "point refers to a slide that is not there", path: ["sections", i, "points", j] });
  }));
});

export const SessionReplySchema: z.ZodType<SessionReply> = z.strictObject({ token: z.string().min(16), user: UserSchema });
export const LectureReplySchema: z.ZodType<LectureReply> = z.strictObject({ lecture: LectureSchema, detail: DetailSchema.nullable() });
export const StatusReplySchema: z.ZodType<StatusReply> = z.strictObject({ status: StatusSchema });
export const ErrorReplySchema = z.strictObject({ message: z.string().min(1) });
/* Phase 2: live recording. */
export const ChunkReplySchema: z.ZodType<ChunkReply> = z.strictObject({ segments: z.array(LineSchema), alerts: z.array(AlertSchema) });
export const CatchUpReplySchema: z.ZodType<CatchUpReply> = z.strictObject({ points: z.array(z.string().min(1)).min(1) });
/* Phase 3: sharing, review packs, search. */
export const UrlReplySchema: z.ZodType<UrlReply> = z.strictObject({ url: z.string().nullable() });
export const SharedReplySchema: z.ZodType<SharedReply> = z.strictObject({ lecture: LectureSchema, course: CourseSchema.optional(), detail: DetailSchema, sharedBy: z.string().min(1) });
export const PackHintSchema: z.ZodType<PackHint> = z.strictObject({ t: seconds, kind: z.string().min(1), text: z.string().min(1), lecture: z.string(), lectureId: id });
export const PackPointSchema: z.ZodType<PackPoint> = z.strictObject({ text: z.string().min(1), off: z.boolean(), t: seconds.nullable(), lecture: z.string(), lectureId: id });
export const PackTopicSchema: z.ZodType<PackTopic> = z.strictObject({ topic: z.string().min(1), points: z.array(PackPointSchema).min(1) });
export const PackQuestionSchema: z.ZodType<PackQuestion> = z.strictObject({ ...quizFields, lectureId: id }).refine(answerIsAnOption, "the answer index is not one of the options");
export const ReviewPackSchema: z.ZodType<ReviewPack> = z.union([
  z.strictObject({ status: z.enum(["none", "processing"]) }),
  z.strictObject({ status: z.literal("ready"), hints: z.array(PackHintSchema), sheet: z.array(PackTopicSchema), exam: z.array(PackQuestionSchema) })
]);
/* Marks, questions and review across lectures (API-CHANGES.md section 15). */
export const AskReplySchema: z.ZodType<AskReply> = z.strictObject({ answer: z.string().min(1), refs: z.array(LineSchema).max(4) });
export const ReviewCardSchema: z.ZodType<ReviewCard> = z.strictObject({ lectureId: id, lecture: z.string(), index: z.number().int().nonnegative(), q: z.string().min(1), a: z.string().min(1) });
export const ReviewReplySchema: z.ZodType<ReviewReply> = z.strictObject({ cards: z.array(ReviewCardSchema) });
export const NoteHitSchema: z.ZodType<NoteHit> = z.strictObject({ lecture: id, text: z.string().min(1), t: seconds.nullable() });
export const SearchReplySchema: z.ZodType<SearchReply> = z.strictObject({ results: z.array(NoteHitSchema).max(20) });
/* Phase 4: plans (INTEGRATION.md 3.4). */
export const PlanSchema: z.ZodType<Plan> = z.strictObject({ id, name: z.string().min(1), priceText: z.string().min(1), features: z.array(z.string().min(1)).optional() });
export const PlansSchema: z.ZodType<Plans> = z.strictObject({ plans: z.array(PlanSchema), current: id.nullable() })
  .refine(p => p.current === null || p.plans.some(x => x.id === p.current), "current is not one of the plans");
