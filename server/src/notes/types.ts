/* The notes model behind one interface (NOTES: DeepSeek in phase 1), so it can be swapped or stubbed in tests. */
import type { Line } from "../../../src/types";
import type { ClassLanguage } from "../config";
import type { SlidesInput } from "./slides";
import type { PackInput } from "./pack";
import type { SlidesPackInput } from "./slidesPack";

export interface NotesInput {
  courseCode: string;
  courseName: string;
  title: string;
  date: string;                       // "Thursday 2026-11-12": lets the model turn "next Tuesday" into a date
  language: ClassLanguage;
  duration: number;                   // seconds
  lines: Line[];
  slides: { n: number; text: string }[];   // empty when no slides were sent
  zh: boolean;                        // Chinese explanations wanted: the model writes each one in Simplified and in Traditional
}

export interface TokenUsage { inputTokens: number; cachedInputTokens: number; outputTokens: number; reasoningTokens: number }

/* One call to the model. `repair` asks again after a reply that was not usable, showing the model its reply and what was wrong. */
export interface NotesCall { text: string; usage: TokenUsage; startedAt: Date }
export interface Repair { reply: string; problem: string }
export interface NotesWriter {
  readonly provider: string;
  readonly model: string;
  write(input: NotesInput, signal?: AbortSignal, repair?: Repair): Promise<NotesCall>;
  /* Phase 3: which slide each point of notes written before the slides belongs to (notes/slides.ts). */
  fileSlides(input: SlidesInput, signal?: AbortSignal, repair?: Repair): Promise<NotesCall>;
  /* Phase 3: a course's review pack (notes/pack.ts). */
  reviewPack(input: PackInput, signal?: AbortSignal, repair?: Repair): Promise<NotesCall>;
  /* A study pack from a slide deck alone, with no recording (notes/slidesPack.ts). */
  slidesPack(input: SlidesPackInput, signal?: AbortSignal, repair?: Repair): Promise<NotesCall>;
  /* List-price estimate in US dollars, for the cost log. */
  usd(usage: TokenUsage, at: Date): { usd: number; meta: Record<string, unknown> };
}
