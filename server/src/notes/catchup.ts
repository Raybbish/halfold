/* "Catch me up" on the recording screen: the last five minutes of the live transcript, summed up in a few sentences so a
   student who drifted off can rejoin the class. One small, fast call (CATCHUP_MODEL, default deepseek-flash, no thinking). */
import type { Line } from "../../../src/types";
import type { ClassLanguage, DeepSeekSettings } from "../config";
import { deepseekJson, deepseekUsd } from "./deepseek";
import type { TokenUsage } from "./types";

export interface CatchUpInput { courseCode: string; title: string; language: ClassLanguage; lines: Line[] }
export interface CatchUpCall { points: string[]; usage: TokenUsage; startedAt: Date }
export interface CatchUpWriter {
  readonly provider: string;
  readonly model: string;
  sumUp(input: CatchUpInput, signal?: AbortSignal): Promise<CatchUpCall>;
  usd(usage: TokenUsage, at: Date): { usd: number; meta: Record<string, unknown> };
}

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const SPOKEN: Record<ClassLanguage, string> = { en: "English", "en-yue": "English and Cantonese", "en-zh": "English and Mandarin", auto: "English, perhaps mixed with Cantonese or Mandarin" };

export function catchUpPrompt(input: CatchUpInput) {
  const system = `A university lecture is happening right now and a student has lost the thread. You get the transcript of the last few minutes (spoken in ${SPOKEN[input.language]}; speech recognition makes mistakes). Reply with one JSON object and nothing else: {"points": ["...", "..."]}.

- 2 to 4 points, in the order the lecturer said them. Each is one short, plain English sentence the student can read in a few seconds.
- Say what was covered: the idea, definitions, numbers and examples, and anything about exams, quizzes or deadlines.
- Only what the transcript says. No advice, no greetings, no "the lecturer said".
- If the transcript has nothing of substance (small talk, admin, silence), reply with one point that says so.`;
  const user = `Course: ${input.courseCode || "-"}\nLecture: ${input.title}\n\nTranscript, with minutes:seconds from the start of the recording:\n` +
    input.lines.map(l => `[${clock(l.t)}] ${l.text}`).join("\n");
  return { system, user };
}

/* The model's reply -> at most 4 sentences. Throws when there is nothing usable. */
export function readPoints(text: string): string[] {
  let j: unknown;
  try { j = JSON.parse(text); } catch { throw new Error("the reply was not JSON"); }
  const raw = Array.isArray(j) ? j : (j as { points?: unknown })?.points;
  const points = (Array.isArray(raw) ? raw : []).map(p => typeof p === "string" ? p.trim() : "").filter(Boolean).map(p => p.slice(0, 400)).slice(0, 4);
  if (!points.length) throw new Error("the reply had no points");
  return points;
}

export class DeepSeekCatchUp implements CatchUpWriter {
  readonly provider = "deepseek";
  readonly model: string;
  constructor(private readonly o: DeepSeekSettings) { this.model = o.model; }
  async sumUp(input: CatchUpInput, signal?: AbortSignal): Promise<CatchUpCall> {
    const p = catchUpPrompt(input);
    const call = await deepseekJson(this.o, [{ role: "system", content: p.system }, { role: "user", content: p.user }], signal);
    try { return { points: readPoints(call.text), usage: call.usage, startedAt: call.startedAt }; }
    catch (e) { throw Object.assign(e as Error, { usage: call.usage, startedAt: call.startedAt }); }
  }
  usd(u: TokenUsage, at: Date) { return deepseekUsd(this.o, u, at); }
}
