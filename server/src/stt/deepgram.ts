/* Deepgram Nova-3, pre-recorded (POST https://api.deepgram.com/v1/listen). The class language maps to a Deepgram language
   code (DEEPGRAM_LANGUAGES): Cantonese classes go to zh-HK, mixed or unknown ones to "multi" (code-switching). */
import fs from "node:fs";
import { fetch } from "undici";
import type { ClassLanguage } from "../config";
import { ProviderError, slowAgent, withRetry, type Transcriber, type Transcript, type Word } from "./types";

interface DgWord { word: string; punctuated_word?: string; start: number; end: number; language?: string }
interface DgReply {
  metadata?: { duration?: number };
  results?: { channels?: { detected_language?: string; alternatives?: { transcript?: string; words?: DgWord[]; languages?: string[] }[] }[] };
}

export class DeepgramNova implements Transcriber {
  readonly provider = "deepgram";
  constructor(private readonly apiKey: string, readonly model: string, private readonly languages: Record<ClassLanguage, string>,
    private readonly usdPerHourMono: number, private readonly usdPerHourMulti: number, private readonly baseUrl = "https://api.deepgram.com") {}

  url(language: ClassLanguage) {
    const q = new URLSearchParams({ model: this.model, language: this.languages[language], smart_format: "true", punctuate: "true" });
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
    return { words, durationSec: reply.metadata?.duration ?? null, detectedLanguage: ch?.detected_language ?? alt?.languages?.[0], raw: reply };
  }

  usd(audioSeconds: number, language: ClassLanguage) {
    return audioSeconds / 3600 * (this.languages[language] === "multi" ? this.usdPerHourMulti : this.usdPerHourMono);
  }
}
