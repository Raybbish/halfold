/* Data shapes exchanged with the backend. Each one follows reference/INTEGRATION.md section 3 (and section 2 for replies). */

export type LectureStatus = "recording" | "processing" | "ready" | "failed";
export type ZhScript = "hant" | "hans";
export type Source = "record" | "tab" | "upload" | "link";   // language is "en" | "en-yue" | "en-zh" | "auto" (state/app.ts LANGS)

/* 3.1 GET /home */
export interface User { name: string }
export interface Course { id: string; code: string; name?: string; color?: string }
export interface Lecture {
  id: string;
  course: string;
  title: string;
  week?: number;
  date: string;              // shown as it is; the backend decides the format
  duration?: number;         // seconds
  status?: LectureStatus;
  shareUrl?: string | null;
  link?: string | null;      // the video link a "link" lecture was made from ("Open the original video")
  source?: Source;           // how the lecture was made; not on the shared page (API-CHANGES.md 10)
  error?: string;            // why a failed lecture failed, in a sentence for the student, when the backend knows (API-CHANGES.md 9)
}
export interface Upcoming { date: string; kind: string; text: string; course: string; lecture: string; t: number }
export interface Week { lectures: number; known: number; quiz: number; days?: number[] }
export interface Settings { classLanguage: string; zhDefault: boolean; zhScript?: ZhScript }
export interface Usage { minutesToday: number; minutesLimit: number; audioDays?: number }
export interface Home {
  user: User;
  courses: Course[];
  lectures: Lecture[];
  upcoming: Upcoming[];
  week?: Week;
  settings?: Settings;
  usage?: Usage;
  today?: string;
}

/* 3.2 detail: everything about one lecture */
export interface Audio { url?: string | null; keptUntil?: string; expired?: boolean }
export interface Alert { t: number; kind: string; text: string }
export interface Point {
  t: number | null;          // null = a point the student added
  text: string;
  zhHant?: string;
  zhHans?: string;
  zh?: string;               // older backends send one form only
  off?: boolean;             // said in class but not on the slides
  slide?: number | null;
  mine?: boolean;
}
export interface Section { title: string; slides?: string; start: number; end: number; points: Point[] }
export interface Slide { n: number; title: string; image?: string | null }
export interface Line { t: number; text: string }
export interface Flashcard { q: string; a: string }
export interface QuizQuestion { q: string; opts: string[]; a: number; why?: string; t?: number | null }
export interface Detail {
  audio?: Audio | null;
  progress?: { known: number[] };
  alerts: Alert[];
  sections: Section[];
  slides: Slide[];
  transcript: Line[];
  flashcards: Flashcard[];
  quiz: QuizQuestion[];
}

/* 3.3 GET /courses/:id/review-pack */
export interface PackHint extends Alert { lecture: string; lectureId: string }
export interface PackPoint { text: string; off: boolean; t: number | null; lecture: string; lectureId: string }
export interface PackTopic { topic: string; points: PackPoint[] }
export interface PackQuestion extends QuizQuestion { lectureId: string }
export type ReviewPack =
  | { status: "none" | "processing" }
  | { status: "ready"; hints: PackHint[]; sheet: PackTopic[]; exam: PackQuestion[] };

/* 3.4 GET /plans */
export interface Plan { id: string; name: string; priceText: string; features?: string[] }
export interface Plans { plans: Plan[]; current: string | null }

/* Replies listed in section 2 */
export interface SessionReply { token: string; user: User }
export interface LectureReply { lecture: Lecture; detail: Detail | null }
export interface SharedReply { lecture: Lecture; course?: Course; detail: Detail; sharedBy: string }
export interface ChunkReply { segments: Line[]; alerts: Alert[] }
export interface StatusReply { status: LectureStatus }
export interface CatchUpReply { points: string[] }
export interface UrlReply { url: string | null }
/* GET /search?q= (added after the migration): points in the notes of every lecture that match */
export interface NoteHit { lecture: string; text: string; t: number | null }
export interface SearchReply { results: NoteHit[] }
export interface NewLecture { courseId: string; title: string; language: string; source: Source; autoTitle?: boolean }
export interface SettingsUpdate { name: string; classLanguage: string; zhDefault: boolean; zhScript?: ZhScript }
export interface ProgressUpdate { known: number[]; quizScore: number | null }
