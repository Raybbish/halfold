/* One interface for every speech-to-text service, so they can be swapped (STT_PROVIDER) and compared (scripts/compare-stt.ts). */
import { Agent } from "undici";
import type { ClassLanguage } from "../config";

/* A recognised word (or Chinese character run) with its time in seconds from the start of the audio. */
export interface Word { text: string; start: number; end: number; language?: string }
export interface Transcript { words: Word[]; durationSec: number | null; detectedLanguage?: string; raw: unknown }

export interface Transcriber {
  readonly provider: string;
  readonly model: string;
  transcribe(file: string, language: ClassLanguage, signal?: AbortSignal): Promise<Transcript>;
  /* List-price estimate in US dollars for this much audio, for the cost log. */
  usd(audioSeconds: number, language: ClassLanguage): number;
}

/* A 90-minute file can take minutes to transcribe before the reply starts: Node's fetch gives up after 5 minutes by default. */
export const slowAgent = new Agent({ headersTimeout: 30 * 60_000, bodyTimeout: 30 * 60_000, connectTimeout: 30_000 });

export class ProviderError extends Error {
  constructor(readonly provider: string, readonly status: number, detail: string) { super(`${provider} replied ${status}: ${detail.slice(0, 500)}`); }
}

/* Retries a request on 429 and 5xx (and network errors) with backoff; other errors are final. */
export async function withRetry<T>(fn: () => Promise<T>, signal?: AbortSignal, tries = 3): Promise<T> {
  for (let i = 1; ; i++) {
    try { return await fn(); }
    catch (e) {
      const status = e instanceof ProviderError ? e.status : 0;
      const retryable = !signal?.aborted && (status === 0 || status === 429 || status >= 500) && !(e instanceof Error && e.name === "AbortError");
      if (!retryable || i >= tries) throw e;
      await new Promise(r => setTimeout(r, 2000 * 2 ** (i - 1)));
    }
  }
}
