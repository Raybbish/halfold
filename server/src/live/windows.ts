/* The live transcript is written in windows: each round transcribes the audio from where the last round stopped to the
   end of what has arrived. A word that the end of the audio cuts in half would be misheard, so the last HOLD seconds
   are not kept: they are transcribed again, with what follows, in the next round. The round stops between two words.
   Pure logic, shared by the live transcriber (live/transcriber.ts) and scripts/compare-stt.ts --chunks. */
import type { Word } from "../stt/types";

export const HOLD = 2;            // seconds at the end of a window that are transcribed again next round
export const MIN_WINDOW = 5;      // a round waits until this much new audio has arrived
export const MAX_WINDOW = 120;    // past this, a round keeps everything but the last HOLD seconds, even with no gap between words

export interface WindowCut {
  keep: Word[];     // words to add to the live transcript, in absolute time
  next: number;     // where the next round starts, in seconds from the start of the recording
}

/* words: recognised in the window [start, end], already in absolute time. final: no more audio will come. */
export function cutWindow(words: Word[], start: number, end: number, final: boolean, hold = HOLD): WindowCut {
  const sorted = words.filter(w => w.text.trim() && Number.isFinite(w.start)).map(w => ({ ...w, end: Number.isFinite(w.end) ? Math.max(w.end, w.start) : w.start }))
    .sort((a, b) => a.start - b.start);
  if (final) return { keep: sorted, next: end };
  const limit = end - hold;
  if (limit <= start) return { keep: [], next: start };
  let n = 0;
  while (n < sorted.length && sorted[n].end <= limit) n++;
  const keep = sorted.slice(0, n), after = sorted[n];
  if (!keep.length) {
    /* Nothing finished before the held tail: silence (move on, still holding the tail), or one word running into it. */
    if (!after) return { keep, next: limit };
    if (end - start > MAX_WINDOW) return { keep: sorted.filter(w => w.start < limit), next: limit };
    return { keep, next: Math.max(start, Math.min(after.start, limit)) };
  }
  const last = keep[keep.length - 1];
  if (!after) return { keep, next: limit };
  /* Stop halfway through the gap before the first word that is not kept, so the next round hears all of it. */
  const next = after.start >= limit ? limit : Math.max(last.end, (last.end + after.start) / 2);
  return { keep, next: Math.max(start, next) };
}

/* Words of a window file (times from 0) placed at `offset` seconds in the recording. */
export const shift = (words: Word[], offset: number): Word[] => words.map(w => ({ ...w, start: w.start + offset, end: w.end + offset }));

/* The end of a word can still be heard at the start of the next window, and is heard again as the same word (seen with
   Cantonese, one character per word: "嗰樣你放" then "放棄..."). A first word that repeats the last word kept, starting
   within a second of it, is dropped. */
const bare = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
export function dropRepeat(keep: Word[], last: Word | undefined): Word[] {
  if (!last || !keep.length) return keep;
  const k = keep[0];
  return bare(k.text) && bare(k.text) === bare(last.text) && k.start < last.end + 1 ? keep.slice(1) : keep;
}

/* A round usually stops in the middle of a sentence. Sent as it is, the live transcript shows half a sentence, then the
   rest as a new line in the next round. So the words after the last sentence end are held back and sent at the start of
   the next round, whole. A sentence that never ends (MAX_HELD seconds) is sent anyway. */
const ENDS_SENTENCE = /[.?!。？！…]["'”’)）]*$/;
export const MAX_HELD = 30;
export function holdUnfinished(words: Word[], now: number): { send: Word[]; held: Word[] } {
  let i = words.length - 1;
  while (i >= 0 && !ENDS_SENTENCE.test(words[i].text.trim())) i--;
  const held = words.slice(i + 1);
  if (held.length && now - held[0].start > MAX_HELD) return { send: words, held: [] };
  return { send: words.slice(0, i + 1), held };
}
