/* What the notes model is asked to write. The reply is one JSON object (ModelNotes in normalize.ts); the transcript in
   detail.transcript comes from the speech-to-text words, not from the model. */
import type { NotesInput } from "./types";

/* How many flashcards and quiz questions a recording this long is worth, at most: about one card for every 6 minutes and
   one question for every 10; at least 2 and 1, at most 15 and 10. A 1-minute recording got 8 cards and 5 questions in the
   test of 2026-11-18, about the class itself. buildDetail (normalize.ts) keeps no more than this. */
export function studyCounts(seconds: number) {
  const min = Math.max(0, seconds) / 60, clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
  return { cards: clamp(Math.round(min / 6), 2, 15), quiz: clamp(Math.round(min / 10), 1, 10) };
}

const clock = (s: number) => { const m = Math.floor(s / 60), r = Math.floor(s % 60); return `${m}:${String(r).padStart(2, "0")}`; };

const LANGUAGE: Record<NotesInput["language"], string> = {
  en: "English",
  zh: "Mandarin, perhaps with English terms",
  yue: "Cantonese, perhaps with English terms",
  "en-zh": "English mixed with Mandarin",
  "en-yue": "English mixed with Cantonese",
  auto: "not given; it may be English, Mandarin or Cantonese, or a mix"
};

export function systemPrompt(input: NotesInput) {
  const withSlides = input.slides.length > 0, n = studyCounts(input.duration);
  return `You write lecture notes for Halfold, an app for university students. The student recorded a lecture; you get its transcript${withSlides ? " and the text of the lecture slides" : ""}. Reply with one JSON object and nothing else.

What the student needs:
- "title": what the lecture is about, in English, at most 8 words (such as "Opportunity cost and the production frontier"). No date, no course code.
- "summary": the 3 to 5 most important things the lecture taught, one short sentence each, in the order taught (1 or 2 for a short recording). The student reads them before the notes.
- Notes grouped by topic, in the order the lecture covered them. Each section is one topic, with the second it starts and ends in the recording.
- Points: short, clear sentences in English a student would write down, each with the second ("t") the lecturer said it. Keep the lecturer's examples, numbers, definitions and warnings. Leave out greetings, filler and repetition.${withSlides ? `
- For each point, "slide" is the number of the slide it belongs to (null if none fits), and "off" is true when the lecturer said it but it is NOT on the slides: an extra example, an explanation, a hint about the exam, a correction. This is what the student most needs, so judge it carefully against the slide text.` : `
- There are no slides: set "slide" to null and "off" to false on every point.`}${input.zh ? `
- "zhHans" and "zhHant" on each point: one short explanation of the point for a student whose first language is Chinese, written twice, once for each script. Students choose which one they read.
  - "zhHans": Simplified Chinese as written in mainland China, with the terms used there: 美联储 (not 联储局), 商品 (not 货品), 实际 GDP (not 实质本地生产总值), 视频 (not 影片), 信息 (not 资讯).
  - "zhHant": Traditional Chinese as written in Hong Kong, with the terms used there: 聯儲局, 貨品, 實質本地生產總值.
  - Write each one in its own words for its readers. Never make one by changing the characters of the other.
  - Use standard written Chinese (書面語), not spoken Cantonese, even when the lecturer spoke Cantonese. Explain the idea; do not just translate word for word. Keep key English terms in brackets where they help.` : ""}
- Alerts: everything said about exams, quizzes, assignments and deadlines. "kind" is exactly one of "Midterm", "Deadline", "Exam hint", "Quiz", "Final". "date" is the day it happens as YYYY-MM-DD when the lecturer gave or implied one (work out "next Tuesday" from the lecture date), otherwise null.
- Up to ${n.cards} flashcards and up to ${n.quiz} multiple-choice question${n.quiz === 1 ? "" : "s"} with 4 options each, on the ideas worth remembering; fewer, or none, when the recording teaches less. Never ask about how the class is run (attendance, breaks, where the slides are posted), the lecturer's habits or filler words. "a" is the index (0 to 3) of the right option, "why" explains it in one sentence, "t" is the second it was taught. The options are shown in a mixed order, so no option may refer to another ("all of the above", "both A and B").${withSlides ? `
- "slides": one entry per slide page you were given, with a short title (at most 8 words).` : `
- "slides": an empty array.`}

Rules:
- Only use what is in the transcript${withSlides ? " and slides" : ""}. Do not add facts from elsewhere.
- The transcript comes from speech recognition and has mistakes. Fix obvious misheard technical terms${withSlides ? " using the slides" : ""}. Some or all of it may be in Mandarin or Cantonese: understand it, but write the notes in English.
- Every time is a whole number of seconds between 0 and ${Math.ceil(input.duration)}. Sections follow one another without gaps or overlaps.
- About one point for every one or two minutes of teaching; 3 to 10 sections for a 90-minute lecture, fewer for a short recording.

The JSON object has exactly these fields:
{
  "title": "...",
  "summary": ["...", "..."],
  "sections": [{ "title": "Opportunity cost", "start": 200, "end": 640, "points": [{ "t": 252, "text": "...", ${input.zh ? `"zhHans": "...", "zhHant": "...", ` : ""}"slide": ${withSlides ? 3 : "null"}, "off": ${withSlides ? "true" : "false"} }] }],
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
