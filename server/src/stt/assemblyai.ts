/* AssemblyAI, pre-recorded (https://api.assemblyai.com/v2): upload the file, start a transcript, wait for it, then delete
   it (AssemblyAI would keep it). Two models (assemblyai.com/pricing and docs, 2026-11-23):
     universal-2          US$0.15 an hour. "Chinese" with English mixed in (code switching, two languages, one of them
                          English); no Cantonese of its own.
     assemblyai-stt-3-7   US$0.21 an hour. Cantonese and Mandarin listed separately, languages mixed within a sentence.
   The default is 3.7: on the 2026-11-24 comparison (README.md "对比转写服务") it kept Chinese words said inside English
   sentences, even with the language set to English, where universal-2 dropped them. The class language is sent as "en"
   for English classes and detected for the others. Uploads are deleted by AssemblyAI within 48 hours (there is no call
   to delete one); by its terms it may train on customer audio unless that is turned off for the account. */
import fs from "node:fs";
import { fetch } from "undici";
import type { ClassLanguage } from "../config";
import { ProviderError, slowAgent, withRetry, type Transcriber, type Transcript, type Word } from "./types";

/* List prices in US dollars an hour; ASSEMBLYAI_USD_PER_HOUR overrides for the model in use. */
export const ASSEMBLYAI_PRICES: Record<string, number> = { "universal-2": 0.15, "assemblyai-stt-3-7": 0.21 };

interface AaiWord { text: string; start: number; end: number }
interface AaiTranscript { id: string; status: "queued" | "processing" | "completed" | "error"; error?: string; language_code?: string; audio_duration?: number; words?: AaiWord[] }

export class AssemblyAi implements Transcriber {
  readonly provider = "assemblyai";
  constructor(private readonly apiKey: string, readonly model: string, private readonly usdPerHour: number,
    private readonly baseUrl = "https://api.assemblyai.com", private readonly pollMs = 1000) {}

  /* The transcript request for a class language (exported for the tests). */
  request(audioUrl: string, language: ClassLanguage) {
    const base = { audio_url: audioUrl, speech_models: [this.model], punctuate: true, format_text: true };
    if (language === "en") return { ...base, language_code: "en" };
    /* universal-2 mixes in English only when asked to; 3.7 does it on its own. */
    return { ...base, language_detection: true, ...(this.model === "universal-2" ? { language_detection_options: { code_switching: true } } : {}) };
  }

  private async call<T>(method: string, route: string, body?: Buffer | object, signal?: AbortSignal): Promise<T> {
    const raw = body instanceof Buffer;
    const r = await fetch(this.baseUrl + route, {
      method, signal, dispatcher: slowAgent,
      headers: { authorization: this.apiKey, "content-type": raw ? "application/octet-stream" : "application/json" },
      body: body === undefined ? undefined : raw ? body : JSON.stringify(body)
    });
    if (!r.ok) throw new ProviderError(this.provider, r.status, await r.text());
    return await r.json() as T;
  }

  async transcribe(file: string, language: ClassLanguage, signal?: AbortSignal): Promise<Transcript> {
    if (!this.apiKey) throw new Error("ASSEMBLYAI_API_KEY is not set in server/.env");
    const bytes = await fs.promises.readFile(file);
    const { upload_url } = await withRetry(() => this.call<{ upload_url: string }>("POST", "/v2/upload", bytes, signal), signal);
    let id: string | null = null;
    try {
      let t = await withRetry(() => this.call<AaiTranscript>("POST", "/v2/transcript", this.request(upload_url, language), signal), signal);
      id = t.id;
      while (t.status === "queued" || t.status === "processing") {
        await new Promise((res, rej) => {
          const timer = setTimeout(res, this.pollMs);
          signal?.addEventListener("abort", () => { clearTimeout(timer); rej(signal.reason); }, { once: true });
        });
        t = await withRetry(() => this.call<AaiTranscript>("GET", `/v2/transcript/${id}`, undefined, signal), signal);
      }
      if (t.status !== "completed") throw new ProviderError(this.provider, 200, `transcript ${t.status}: ${t.error || "no reason given"}`);
      const words: Word[] = (t.words || []).map(w => ({ text: w.text, start: w.start / 1000, end: w.end / 1000 }));
      return { words, durationSec: t.audio_duration ?? null, detectedLanguage: t.language_code, raw: t };
    } finally {
      /* The transcript is not kept at AssemblyAI; the upload is deleted by AssemblyAI within 48 hours. */
      if (id) await this.call("DELETE", `/v2/transcript/${id}`).catch(e => console.warn(`[assemblyai] transcript ${id} not deleted: ${(e as Error).message}`));
    }
  }

  usd(audioSeconds: number) { return audioSeconds / 3600 * this.usdPerHour; }
}
