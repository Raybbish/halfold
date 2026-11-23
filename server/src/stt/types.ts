/* One interface for every speech-to-text service, so they can be swapped (STT_PROVIDER) and compared (scripts/compare-stt.ts). */
import { Agent } from "undici";
import type { ClassLanguage } from "../config";

/* A recognised word (or Chinese character run) with its time in seconds from the start of the audio. endsSentence: the
   service marked a sentence end here without a punctuation mark (Deepgram utterances, stt/deepgram.ts). */
export interface Word { text: string; start: number; end: number; language?: string; endsSentence?: boolean }
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

/* Never reached the service, so nothing was charged: retrying is safe. */
const NOT_SENT = new Set(["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "UND_ERR_CONNECT_TIMEOUT"]);
export function retryable(e: unknown) {
  if (e instanceof ProviderError) return e.status === 429 || e.status >= 500;
  const code = (e as { code?: string; cause?: { code?: string } })?.cause?.code ?? (e as { code?: string })?.code;
  return !!code && NOT_SENT.has(code);
}

/* Retries a request the service refused (429, 5xx) or never received, with backoff. Anything else is final: a timeout or
   a broken reply after the audio was sent may already have been charged, and a second try would be charged again. */
export async function withRetry<T>(fn: () => Promise<T>, signal?: AbortSignal, tries = 3): Promise<T> {
  for (let i = 1; ; i++) {
    try { return await fn(); }
    catch (e) {
      if (signal?.aborted || !retryable(e) || i >= tries) throw e;
      await new Promise(r => setTimeout(r, 2000 * 2 ** (i - 1)));
    }
  }
}
