/* DeepSeek chat completions (OpenAI-style API at https://api.deepseek.com): JSON output mode, streamed so a long reply
   does not hit a request timeout. Prices are per million tokens; off-peak hours cost half (see isPeak).
   deepseekJson() is one call; DeepSeekWriter writes the notes with it, and notes/catchup.ts sums up the last minutes. */
import { fetch } from "undici";
import type { DeepSeekSettings } from "../config";
import { ProviderError, slowAgent, withRetry } from "../stt/types";
import { systemPrompt, userPrompt } from "./prompt";
import type { NotesCall, NotesInput, NotesWriter, TokenUsage } from "./types";

export type DeepSeekOptions = DeepSeekSettings;
export interface ChatMessage { role: "system" | "user" | "assistant"; content: string }

/* Peak hours: Monday to Friday, 01:00-04:00 and 06:00-10:00 UTC (api-docs.deepseek.com/quick_start/pricing). Chinese public holidays are off-peak too; not counted here. */
export function isPeak(at: Date) {
  const day = at.getUTCDay(), h = at.getUTCHours();
  return day >= 1 && day <= 5 && ((h >= 1 && h < 4) || (h >= 6 && h < 10));
}

/* List-price estimate of one call. */
export function deepseekUsd(o: DeepSeekOptions, u: TokenUsage, at: Date) {
  const p = o.prices, peak = isPeak(at), f = peak ? 1 : 0.5;
  const miss = Math.max(0, u.inputTokens - u.cachedInputTokens);
  return { usd: (u.cachedInputTokens * p.inputCacheHit + miss * p.inputCacheMiss + u.outputTokens * p.output) / 1e6 * f, meta: { peak, prices: p } };
}

interface Chunk {
  choices?: { delta?: { content?: string | null; reasoning_content?: string | null }; finish_reason?: string | null }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_cache_hit_tokens?: number; prompt_cache_miss_tokens?: number; completion_tokens_details?: { reasoning_tokens?: number } };
  error?: { message?: string };
}

/* One streamed call that answers with a JSON object. A reply cut off at max_tokens, or stopped for another reason,
   is an error that carries the tokens used (they are paid for). */
export async function deepseekJson(o: DeepSeekOptions, messages: ChatMessage[], signal?: AbortSignal): Promise<NotesCall> {
  if (!o.apiKey) throw new Error("DEEPSEEK_API_KEY is not set in server/.env");
  const startedAt = new Date();
  const res = await withRetry(async () => {
    const r = await fetch(o.baseUrl + "/chat/completions", {
      method: "POST", signal, dispatcher: slowAgent,
      headers: { Authorization: "Bearer " + o.apiKey, "Content-Type": "application/json", Accept: "text/event-stream" },
      body: JSON.stringify({
        model: o.model, messages, response_format: { type: "json_object" }, max_tokens: o.maxTokens,
        reasoning_effort: o.reasoningEffort, stream: true, stream_options: { include_usage: true }
      })
    });
    if (!r.ok || !r.body) throw new ProviderError("deepseek", r.status, await r.text());
    return r;
  }, signal);

  let text = "", finish: string | null = null, usage: Chunk["usage"] | undefined, buf = "";
  const decoder = new TextDecoder();
  const take = (line: string) => {
    if (!line.startsWith("data:")) return;
    const data = line.slice(5).trim(); if (!data || data === "[DONE]") return;
    const c = JSON.parse(data) as Chunk;
    if (c.error) throw new ProviderError("deepseek", 200, c.error.message || "error in stream");
    for (const ch of c.choices || []) { if (ch.delta?.content) text += ch.delta.content; if (ch.finish_reason) finish = ch.finish_reason; }
    if (c.usage) usage = c.usage;
  };
  for await (const part of res.body!) {
    buf += decoder.decode(part as Uint8Array, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) { take(buf.slice(0, nl).replace(/\r$/, "")); buf = buf.slice(nl + 1); }
  }
  take(buf);
  const u: TokenUsage = {
    inputTokens: usage?.prompt_tokens ?? 0, cachedInputTokens: usage?.prompt_cache_hit_tokens ?? 0,
    outputTokens: usage?.completion_tokens ?? 0, reasoningTokens: usage?.completion_tokens_details?.reasoning_tokens ?? 0
  };
  if (finish === "length") throw Object.assign(new Error(`DeepSeek stopped at max_tokens (${o.maxTokens}); the reply was cut off`), { usage: u, startedAt });
  if (finish && finish !== "stop") throw Object.assign(new Error(`DeepSeek stopped early: ${finish}`), { usage: u, startedAt });
  return { text, usage: u, startedAt };
}

export class DeepSeekWriter implements NotesWriter {
  readonly provider = "deepseek";
  readonly model: string;
  constructor(private readonly o: DeepSeekOptions) { this.model = o.model; }

  async write(input: NotesInput, signal?: AbortSignal, repair?: { reply: string; problem: string }): Promise<NotesCall> {
    const messages: ChatMessage[] = [{ role: "system", content: systemPrompt(input) }, { role: "user", content: userPrompt(input) }];
    if (repair) messages.push({ role: "assistant", content: repair.reply },
      { role: "user", content: `That reply could not be used: ${repair.problem}\nSend the whole JSON object again, corrected.` });
    return deepseekJson(this.o, messages, signal);
  }

  usd(u: TokenUsage, at: Date) { return deepseekUsd(this.o, u, at); }
}
