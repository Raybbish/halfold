/* Deepgram Nova-3, pre-recorded (POST https://api.deepgram.com/v1/listen). The class language maps to a Deepgram language
   code (DEEPGRAM_LANGUAGES): English classes go to "en", mixed or unknown ones to "multi" (code-switching across 55
   languages, Cantonese as zh-HK and Mandarin as zh).
   Deepgram punctuates English but not "multi" or Chinese, and then gives one paragraph for the whole reply. Its utterances
   (split on silence in the audio) stand in for sentences: when a reply has no sentence punctuation, the last word of each
   utterance is marked endsSentence, so transcript lines (stt/lines.ts) and the live transcript (live/windows.ts) still
   break between sentences. Tried on 2026-11-23, see README.md "对比转写服务". */
import fs from "node:fs";
import { fetch } from "undici";
import type { ClassLanguage } from "../config";
import { ProviderError, slowAgent, withRetry, type Transcriber, type Transcript, type Word } from "./types";

interface DgWord { word: string; punctuated_word?: string; start: number; end: number; language?: string }
interface DgReply {
  metadata?: { duration?: number };
  results?: {
    channels?: { detected_language?: string; alternatives?: { transcript?: string; words?: DgWord[]; languages?: string[] }[] }[];
    utterances?: { start: number; end: number }[];
  };
}

const ENDS_SENTENCE = /[.?!。？！…]["'”’)）]*$/;
/* Silence, in seconds, that ends an utterance. Deepgram's default is 0.8; at 0.6 a 3-minute Mandarin and English stretch
   gave utterances of 3.4 seconds on average. */
const UTTERANCE_SPLIT = "0.6";

/* Deepgram names Cantonese zh-HK; the rest of the server, like ElevenLabs, calls it yue. */
const detected = (code: string | undefined) => code === "zh-HK" ? "yue" : code;

export class DeepgramNova implements Transcriber {
  readonly provider = "deepgram";
  constructor(private readonly apiKey: string, readonly model: string, private readonly languages: Record<ClassLanguage, string>,
    private readonly usdPerHourMono: number, private readonly usdPerHourMulti: number, private readonly baseUrl = "https://api.deepgram.com") {}

  url(language: ClassLanguage) {
    const q = new URLSearchParams({ model: this.model, language: this.languages[language], smart_format: "true", punctuate: "true", utterances: "true", utt_split: UTTERANCE_SPLIT });
    return `${this.baseUrl}/v1/listen?${q}`;
  }

  async transcribe(file: string, language: ClassLanguage, signal?: AbortSignal): Promise<Transcript> {
    if (!this.apiKey) throw new Error("DEEPGRAM_API_KEY is not set in server/.env");
    const reply = await withRetry(async () => {
      const body = await fs.openAsBlob(file, { type: "audio/mp4" });
      const r = await fetch(this.url(language), { method: "POST", headers: { Authorization: "Token " + this.apiKey, "Content-Type": "audio/mp4" }, body, signal, dispatcher: slowAgent });
      if (!r.ok) throw new ProviderError(this.provider, r.status, await r.text());
      return await r.json() as DgReply;
    }, signal);
    const ch = reply.results?.channels?.[0], alt = ch?.alternatives?.[0];
    const words: Word[] = (alt?.words || []).map(w => ({ text: w.punctuated_word || w.word, start: w.start, end: w.end, language: w.language }));
    if (!words.some(w => ENDS_SENTENCE.test(w.text))) markUtteranceEnds(words, reply.results?.utterances || []);
    return { words, durationSec: reply.metadata?.duration ?? null, detectedLanguage: detected(ch?.detected_language ?? alt?.languages?.[0]), raw: reply };
  }

  usd(audioSeconds: number, language: ClassLanguage) {
    return audioSeconds / 3600 * (this.languages[language] === "multi" ? this.usdPerHourMulti : this.usdPerHourMono);
  }
}

/* The last word that ends by each utterance's end (words and utterances are both in time order). */
function markUtteranceEnds(words: Word[], utterances: { end: number }[]) {
  let i = 0;
  for (const u of utterances) {
    while (i < words.length && words[i].end <= u.end + 0.01) i++;
    if (i > 0) words[i - 1].endsSentence = true;
  }
}
