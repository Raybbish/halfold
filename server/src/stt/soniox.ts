/* Soniox, async (https://api.soniox.com/v1): upload the file, start a transcription, wait for it, read the tokens, then
   delete both (Soniox would keep them 30 days). List price about US$0.10 an hour (2026-11, soniox.com/pricing).
   Soniox documents one Chinese language, "zh", with no Cantonese of its own (docs.soniox.com, supported languages,
   2026-11-23): a Cantonese class is sent with the hints zh and en, and the comparison (scripts/compare-stt.ts) shows
   how well that works. Tokens are pieces of words: a token that starts with a space begins a new word, each Chinese
   character is a word of its own, and punctuation joins the word before it. */
import fs from "node:fs";
import path from "node:path";
import { fetch, FormData } from "undici";
import type { ClassLanguage } from "../config";
import { ProviderError, slowAgent, withRetry, type Transcriber, type Transcript, type Word } from "./types";

/* Hints, not limits: Soniox still hears a language not listed. */
const HINTS: Record<ClassLanguage, string[]> = { en: ["en"], zh: ["zh", "en"], yue: ["zh", "en"], "en-yue": ["zh", "en"], "en-zh": ["zh", "en"], auto: ["en", "zh"] };

interface SonioxToken { text: string; start_ms?: number; end_ms?: number; language?: string; is_audio_event?: boolean }
interface SonioxJob { id: string; status: "queued" | "processing" | "completed" | "error"; audio_duration_ms?: number | null; error_message?: string | null }

/* Chinese characters and full-width punctuation: no word runs across one. */
const WIDE = /[　-〿㐀-䶿一-鿿豈-﫿＀-￯]/;
const WORDISH = /[\p{L}\p{N}]/u;

/* Soniox tokens -> words (exported for the tests). "Hel" + "lo" + "," is one word, as is "3" + "." + "5"; " world"
   starts a new one; 機 and 會 are two. */
export function tokensToWords(tokens: SonioxToken[]): Word[] {
  const words: Word[] = [];
  for (const t of tokens) {
    if (t.is_audio_event || t.start_ms == null) continue;
    const text = t.text.trim(); if (!text) continue;
    const last = words[words.length - 1];
    const start = t.start_ms / 1000, end = (t.end_ms ?? t.start_ms) / 1000;
    const joins = last && !/^\s/.test(t.text) && !WIDE.test(text[0]) && !WIDE.test(last.text.slice(-1));
    if (last && (joins || !WORDISH.test(text))) { last.text += text; last.end = Math.max(last.end, end); continue; }
    words.push({ text, start, end, ...(t.language ? { language: t.language } : {}) });
  }
  return words;
}

/* The language most of the words are in. */
function mostWords(words: Word[]) {
  const n = new Map<string, number>();
  for (const w of words) if (w.language) n.set(w.language, (n.get(w.language) || 0) + 1);
  return [...n].sort((a, b) => b[1] - a[1])[0]?.[0];
}

export class SonioxAsync implements Transcriber {
  readonly provider = "soniox";
  constructor(private readonly apiKey: string, readonly model: string, private readonly usdPerHour: number,
    private readonly baseUrl = "https://api.soniox.com", private readonly pollMs = 1000) {}

  /* The transcription request for a class language (exported for the tests). */
  request(fileId: string, language: ClassLanguage) {
    return { model: this.model, file_id: fileId, language_hints: HINTS[language], enable_language_identification: true };
  }

  private async call<T>(method: string, route: string, body?: FormData | object, signal?: AbortSignal): Promise<T> {
    const json = body && !(body instanceof FormData);
    const r = await fetch(this.baseUrl + route, {
      method, signal, dispatcher: slowAgent,
      headers: { authorization: `Bearer ${this.apiKey}`, ...(json ? { "content-type": "application/json" } : {}) },
      body: json ? JSON.stringify(body) : body as FormData | undefined
    });
    if (!r.ok) throw new ProviderError(this.provider, r.status, await r.text());
    return (r.status === 204 ? null : await r.json()) as T;
  }

  async transcribe(file: string, language: ClassLanguage, signal?: AbortSignal): Promise<Transcript> {
    if (!this.apiKey) throw new Error("SONIOX_API_KEY is not set in server/.env");
    const uploaded = await withRetry(async () => {
      const form = new FormData();
      form.append("file", await fs.openAsBlob(file, { type: "audio/mp4" }), path.basename(file));
      return this.call<{ id: string }>("POST", "/v1/files", form, signal);
    }, signal);
    let jobId: string | null = null;
    try {
      let job = await withRetry(() => this.call<SonioxJob>("POST", "/v1/transcriptions", this.request(uploaded.id, language), signal), signal);
      jobId = job.id;
      while (job.status === "queued" || job.status === "processing") {
        await new Promise((res, rej) => {
          const timer = setTimeout(res, this.pollMs);
          signal?.addEventListener("abort", () => { clearTimeout(timer); rej(signal.reason); }, { once: true });
        });
        job = await withRetry(() => this.call<SonioxJob>("GET", `/v1/transcriptions/${jobId}`, undefined, signal), signal);
      }
      if (job.status !== "completed") throw new ProviderError(this.provider, 200, `transcription ${job.status}: ${job.error_message || "no reason given"}`);
      const reply = await withRetry(() => this.call<{ text?: string; tokens?: SonioxToken[] }>("GET", `/v1/transcriptions/${jobId}/transcript`, undefined, signal), signal);
      const words = tokensToWords(reply.tokens || []);
      return { words, durationSec: job.audio_duration_ms != null ? job.audio_duration_ms / 1000 : null, detectedLanguage: mostWords(words), raw: { job, ...reply } };
    } finally {
      /* Not kept at Soniox: the transcription first (deleting the file first would fail one still running), then the file. */
      if (jobId) await this.call("DELETE", `/v1/transcriptions/${jobId}`).catch(e => console.warn(`[soniox] transcription ${jobId} not deleted: ${(e as Error).message}`));
      await this.call("DELETE", `/v1/files/${uploaded.id}`).catch(e => console.warn(`[soniox] file ${uploaded.id} not deleted: ${(e as Error).message}`));
    }
  }

  usd(audioSeconds: number) { return audioSeconds / 3600 * this.usdPerHour; }
}
