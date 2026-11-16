/* What the notes model is asked to write. The reply is one JSON object (ModelNotes in normalize.ts); the transcript in
   detail.transcript comes from the speech-to-text words, not from the model. */
import type { NotesInput } from "./types";

const clock = (s: number) => { const m = Math.floor(s / 60), r = Math.floor(s % 60); return `${m}:${String(r).padStart(2, "0")}`; };

const LANGUAGE: Record<NotesInput["language"], string> = {
  en: "English",
  "en-yue": "English mixed with Cantonese",
  "en-zh": "English mixed with Mandarin",
  auto: "not given; it may mix English with Cantonese or Mandarin"
};

export function systemPrompt(input: NotesInput) {
  const zh = input.zh === "hans" ? "Simplified Chinese (as used in mainland China)" : "Traditional Chinese (as used in Hong Kong)";
  const withSlides = input.slides.length > 0;
  return `You write lecture notes for Halfnote, an app for university students. The student recorded a lecture; you get its transcript${withSlides ? " and the text of the lecture slides" : ""}. Reply with one JSON object and nothing else.

What the student needs:
- Notes grouped by topic, in the order the lecture covered them. Each section is one topic, with the second it starts and ends in the recording.
- Points: short, clear sentences in English a student would write down, each with the second ("t") the lecturer said it. Keep the lecturer's examples, numbers, definitions and warnings. Leave out greetings, filler and repetition.${withSlides ? `
- For each point, "slide" is the number of the slide it belongs to (null if none fits), and "off" is true when the lecturer said it but it is NOT on the slides: an extra example, an explanation, a hint about the exam, a correction. This is what the student most needs, so judge it carefully against the slide text.` : `
- There are no slides: set "slide" to null and "off" to false on every point.`}${input.zh ? `
- "zh" on each point: one short explanation of the point in ${zh}, written for a student whose first language is Chinese. Use standard written Chinese (書面語), not spoken Cantonese, even when the lecturer spoke Cantonese. Explain the idea; do not just translate word for word. Keep key English terms in brackets where they help.` : ""}
- Alerts: everything said about exams, quizzes, assignments and deadlines. "kind" is exactly one of "Midterm", "Deadline", "Exam hint", "Quiz", "Final". "date" is the day it happens as YYYY-MM-DD when the lecturer gave or implied one (work out "next Tuesday" from the lecture date), otherwise null.
- 8 to 15 flashcards on the key ideas, and 5 to 10 multiple-choice questions with 4 options each. "a" is the index (0 to 3) of the right option, "why" explains it in one sentence, "t" is the second it was taught.${withSlides ? `
- "slides": one entry per slide page you were given, with a short title (at most 8 words).` : `
- "slides": an empty array.`}

Rules:
- Only use what is in the transcript${withSlides ? " and slides" : ""}. Do not add facts from elsewhere.
- The transcript comes from speech recognition and has mistakes. Fix obvious misheard technical terms${withSlides ? " using the slides" : ""}. Parts may be in Cantonese or Mandarin: understand them, but write the notes in English.
- Every time is a whole number of seconds between 0 and ${Math.ceil(input.duration)}. Sections follow one another without gaps or overlaps.
- About one point for every one or two minutes of teaching; 3 to 10 sections for a 90-minute lecture, fewer for a short recording.

The JSON object has exactly these fields:
{
  "sections": [{ "title": "Opportunity cost", "start": 200, "end": 640, "points": [{ "t": 252, "text": "...", ${input.zh ? `"zh": "...", ` : ""}"slide": ${withSlides ? 3 : "null"}, "off": ${withSlides ? "true" : "false"} }] }],
  "slides": [${withSlides ? `{ "n": 3, "title": "Opportunity cost" }` : ""}],
  "alerts": [{ "t": 18, "kind": "Midterm", "text": "Midterm is in week 12 and covers chapters 1 to 5.", "date": "2026-11-26" }],
  "flashcards": [{ "q": "...", "a": "..." }],
  "quiz": [{ "q": "...", "opts": ["...", "...", "...", "..."], "a": 1, "why": "...", "t": 860 }]
}`;
}

export function userPrompt(input: NotesInput) {
  const head = [
    `Course: ${input.courseCode}${input.courseName ? " " + input.courseName : ""}`,
    `Lecture title: ${input.title}`,
    `Lecture date: ${input.date}`,
    `Language spoken: ${LANGUAGE[input.language]}`,
    `Length of the recording: ${Math.ceil(input.duration)} seconds (${clock(input.duration)})`
  ].join("\n");
  const slides = input.slides.length ? `\n\nSLIDES (text of each page)\n${input.slides.map(s => `--- Slide ${s.n} ---\n${s.text || "(no text)"}`).join("\n")}` : "";
  const transcript = input.lines.map(l => `[${l.t}] ${l.text}`).join("\n");
  return `${head}${slides}\n\nTRANSCRIPT (each line starts with the second it was said)\n${transcript}\n\nWrite the notes as the JSON object described.`;
}
