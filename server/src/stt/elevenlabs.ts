/* ElevenLabs Scribe (POST https://api.elevenlabs.io/v1/speech-to-text). scribe_v3 takes secondary languages for mixed-language
   audio; for a model that does not, mixed classes are sent without a language so Scribe detects it, rather than forcing one. */
import fs from "node:fs";
import path from "node:path";
import { fetch, FormData } from "undici";
import type { ClassLanguage } from "../config";
import { ProviderError, slowAgent, withRetry, type Transcriber, type Transcript, type Word } from "./types";

/* Primary language and the languages mixed into it. ISO 639-1 or 639-3 codes (zho = Mandarin, yue = Cantonese). */
const LANGUAGES: Record<ClassLanguage, { primary?: string; also: string[] }> = {
  en: { primary: "en", also: [] },
  zh: { primary: "zho", also: ["en"] },
  yue: { primary: "yue", also: ["en"] },
  "en-yue": { primary: "yue", also: ["en"] },
  "en-zh": { primary: "zho", also: ["en"] },
  auto: { also: [] }
};

interface ElevenWord { text: string; type?: string; start?: number | null; end?: number | null }
interface ElevenReply { language_code?: string; text?: string; words?: ElevenWord[]; audio_duration_secs?: number }

export class ElevenLabsScribe implements Transcriber {
  readonly provider = "elevenlabs";
  constructor(private readonly apiKey: string, readonly model: string, private readonly usdPerHour: number, private readonly baseUrl = "https://api.elevenlabs.io") {}

  private get takesSecondary() { return /^scribe_v[3-9]/.test(this.model); }

  /* The form fields for a class language, exported for the tests. */
  languageFields(language: ClassLanguage): [string, string][] {
    const l = LANGUAGES[language];
    if (!l.primary) return [];
    if (!l.also.length) return [["language_code", l.primary]];
    return this.takesSecondary ? [["language_code", l.primary], ...l.also.map(c => ["secondary_language_codes", c] as [string, string])] : [];
  }

  async transcribe(file: string, language: ClassLanguage, signal?: AbortSignal): Promise<Transcript> {
    if (!this.apiKey) throw new Error("ELEVENLABS_API_KEY is not set in server/.env");
    const reply = await withRetry(async () => {
      const form = new FormData();
      form.append("model_id", this.model);
      form.append("file", await fs.openAsBlob(file, { type: "audio/mp4" }), path.basename(file));
      form.append("timestamps_granularity", "word");
      form.append("tag_audio_events", "false");
      form.append("diarize", "false");
      for (const [k, v] of this.languageFields(language)) form.append(k, v);
      const r = await fetch(this.baseUrl + "/v1/speech-to-text", { method: "POST", headers: { "xi-api-key": this.apiKey }, body: form, signal, dispatcher: slowAgent });
      if (!r.ok) throw new ProviderError(this.provider, r.status, await r.text());
      return await r.json() as ElevenReply;
    }, signal);
    const words: Word[] = (reply.words || []).filter(w => (w.type ?? "word") === "word" && w.start != null)
      .map(w => ({ text: w.text, start: w.start!, end: w.end ?? w.start! }));
    return { words, durationSec: reply.audio_duration_secs ?? null, detectedLanguage: reply.language_code, raw: reply };
  }

  usd(audioSeconds: number) { return audioSeconds / 3600 * this.usdPerHour; }
}
