/* Recognised words -> transcript lines ({t, text}), the shape of detail.transcript and of the notes prompt.
   A line ends at a sentence end (a mark, or Word.endsSentence) once it is at least MIN_LEN seconds long, at a pause, or
   when it gets too long. */
import type { Line } from "../../../src/types";
import type { Word } from "./types";

const PAUSE = 1.2, MIN_LEN = 3, MAX_LEN = 25;
const CJK = /[　-ヿ㐀-䶿一-鿿豈-﫿＀-￯]/;
const ENDS_SENTENCE = /[.?!。？！…]["'”’)）]*$/;
const OPENS_TIGHT = /^[,.;:!?%)\]}'’”、，。；：！？）」』》〉…]/;

/* Joins tokens the way they are written: no space between Chinese characters, none before punctuation. */
export function joinTokens(tokens: string[]) {
  let out = "";
  for (const raw of tokens) {
    const w = raw.trim(); if (!w) continue;
    const last = out.slice(-1);
    const tight = !out || OPENS_TIGHT.test(w) || /[(\[{‘“（「『《〈]$/.test(out) || (CJK.test(last) && CJK.test(w[0]));
    out += (tight ? "" : " ") + w;
  }
  return out;
}

export function wordsToLines(words: Word[]): Line[] {
  const sorted = words.filter(w => w.text.trim() && Number.isFinite(w.start)).sort((a, b) => a.start - b.start);
  const lines: Line[] = [];
  let cur: Word[] = [];
  const close = () => { if (cur.length) { const text = joinTokens(cur.map(w => w.text)); if (text) lines.push({ t: Math.max(0, Math.floor(cur[0].start)), text }); } cur = []; };
  for (const w of sorted) {
    if (cur.length) {
      const first = cur[0], last = cur[cur.length - 1];
      const end = Number.isFinite(last.end) ? last.end : last.start;
      if (w.start - end > PAUSE || w.start - first.start > MAX_LEN) close();
    }
    cur.push(w);
    if ((w.endsSentence || ENDS_SENTENCE.test(w.text.trim())) && (Number.isFinite(w.end) ? w.end : w.start) - cur[0].start >= MIN_LEN) close();
  }
  close();
  return lines;
}
