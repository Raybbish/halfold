/* Scoring a transcript against a reference written by a person, for scripts/compare-stt.ts. English is compared word by
   word and Chinese character by character ("mixed error rate", as used for code-switching speech), after lower-casing,
   dropping punctuation and writing all Chinese in one script (so 繁 vs 简 is not counted as an error). */
import * as OpenCC from "opencc-js";

let toHans: ((s: string) => string) | null = null;
const CJK = /[㐀-䶿一-鿿豈-﫿]/u;

export function tokens(text: string) {
  toHans ??= OpenCC.Converter({ from: "hk", to: "cn" });
  const out: string[] = [];
  for (const m of toHans(text.toLowerCase()).matchAll(/[㐀-䶿一-鿿豈-﫿]|[\p{L}\p{N}']+/gu)) out.push(m[0].replace(/^'+|'+$/g, ""));
  return out.filter(Boolean);
}

/* Edit distance over tokens, two rows at a time (a 90-minute lecture is about 15 000 tokens). */
export function editDistance(a: string[], b: string[]) {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j), cur = new Array<number>(b.length + 1);
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    [prev, cur] = [cur, prev];
  }
  return prev[b.length];
}

export function mixedErrorRate(reference: string, hypothesis: string) {
  const ref = tokens(reference), hyp = tokens(hypothesis);
  return ref.length ? editDistance(ref, hyp) / ref.length : NaN;
}

/* How much of a transcript is Chinese characters and how much English words. */
export function mix(text: string) {
  const t = tokens(text), zh = t.filter(x => CJK.test(x)).length;
  return { tokens: t.length, chinese: zh, other: t.length - zh };
}
