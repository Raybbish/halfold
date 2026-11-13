/* The requests sent to ElevenLabs, Deepgram and DeepSeek, and how their replies are read, against a local fake server. */
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { ElevenLabsScribe } from "../src/stt/elevenlabs";
import { DeepgramNova } from "../src/stt/deepgram";
import { DeepSeekWriter, isPeak } from "../src/notes/deepseek";
import type { NotesInput } from "../src/notes/types";

interface Seen { method: string; url: string; headers: http.IncomingHttpHeaders; body: Buffer }
async function fakeServer(reply: (req: Seen, n: number) => { status?: number; type?: string; body: string }) {
  const seen: Seen[] = [];
  const server = http.createServer((req, res) => {
    const parts: Buffer[] = [];
    req.on("data", d => parts.push(d));
    req.on("end", () => {
      const s = { method: req.method!, url: req.url!, headers: req.headers, body: Buffer.concat(parts) };
      seen.push(s);
      const r = reply(s, seen.length);
      res.writeHead(r.status || 200, { "Content-Type": r.type || "application/json" }); res.end(r.body);
    });
  });
  await new Promise<void>(r => server.listen(0, "127.0.0.1", r));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, seen, close: () => new Promise(r => server.close(r)) };
}
const audioFile = () => { const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "sn-")), "audio.m4a"); fs.writeFileSync(f, "m4a-bytes"); return f; };
const formOf = (s: Seen) => new Request("http://x/", { method: "POST", headers: { "content-type": String(s.headers["content-type"]) }, body: s.body }).formData();

test("ElevenLabs: scribe_v3 gets the main and the mixed-in language; spacing tokens are dropped", async t => {
  const srv = await fakeServer(() => ({ body: JSON.stringify({ language_code: "yue", audio_duration_secs: 12.5, words: [
    { text: "機會", type: "word", start: 0.1, end: 0.5 }, { text: " ", type: "spacing", start: 0.5, end: 0.6 },
    { text: "cost.", type: "word", start: 0.6, end: 1 }, { text: "(laughter)", type: "audio_event", start: 2, end: 3 }] }) }));
  t.after(srv.close);
  const el = new ElevenLabsScribe("el-key", "scribe_v3", 0.2, srv.url);
  const r = await el.transcribe(audioFile(), "en-yue");
  assert.deepEqual(r.words, [{ text: "機會", start: 0.1, end: 0.5 }, { text: "cost.", start: 0.6, end: 1 }]);
  assert.equal(r.durationSec, 12.5); assert.equal(r.detectedLanguage, "yue");
  const req = srv.seen[0];
  assert.equal(req.url, "/v1/speech-to-text"); assert.equal(req.headers["xi-api-key"], "el-key");
  const form = await formOf(req);
  assert.equal(form.get("model_id"), "scribe_v3"); assert.equal(form.get("language_code"), "yue");
  assert.deepEqual(form.getAll("secondary_language_codes"), ["en"]);
  assert.equal(form.get("timestamps_granularity"), "word");
  assert.equal(await (form.get("file") as Blob).text(), "m4a-bytes");
  assert.ok(Math.abs(el.usd(3600) - 0.2) < 1e-12);
});

test("ElevenLabs: a model without secondary languages gets no language for a mixed class (detected instead)", () => {
  const v2 = new ElevenLabsScribe("k", "scribe_v2", 0.2);
  assert.deepEqual(v2.languageFields("en-yue"), []);
  assert.deepEqual(v2.languageFields("en"), [["language_code", "en"]]);
  assert.deepEqual(new ElevenLabsScribe("k", "scribe_v3", 0.2).languageFields("en-zh"), [["language_code", "zho"], ["secondary_language_codes", "en"]]);
  assert.deepEqual(v2.languageFields("auto"), []);
});

test("ElevenLabs: a 4xx is final and names the provider", async t => {
  const srv = await fakeServer(() => ({ status: 422, body: JSON.stringify({ detail: [{ msg: "bad model" }] }) }));
  t.after(srv.close);
  await assert.rejects(new ElevenLabsScribe("k", "scribe_v9", 0.2, srv.url).transcribe(audioFile(), "en"), /elevenlabs replied 422: .*bad model/);
  assert.equal(srv.seen.length, 1);
});

test("Deepgram: the class language maps to a Deepgram language; punctuated words are used", async t => {
  const srv = await fakeServer(() => ({ body: JSON.stringify({ metadata: { duration: 9 }, results: { channels: [{ alternatives: [{ words: [
    { word: "hello", punctuated_word: "Hello,", start: 0, end: 0.4, language: "en" }, { word: "機會", start: 0.5, end: 1, language: "zh-HK" }] }] }] } }) }));
  t.after(srv.close);
  const dg = new DeepgramNova("dg-key", "nova-3", { en: "en", "en-yue": "zh-HK", "en-zh": "multi", auto: "multi" }, 0.258, 0.312, srv.url);
  const r = await dg.transcribe(audioFile(), "en-yue");
  assert.deepEqual(r.words, [{ text: "Hello,", start: 0, end: 0.4, language: "en" }, { text: "機會", start: 0.5, end: 1, language: "zh-HK" }]);
  const u = new URL(srv.url + srv.seen[0].url);
  assert.equal(u.pathname, "/v1/listen");
  assert.deepEqual(Object.fromEntries(u.searchParams), { model: "nova-3", language: "zh-HK", smart_format: "true", punctuate: "true" });
  assert.equal(srv.seen[0].headers.authorization, "Token dg-key"); assert.equal(srv.seen[0].headers["content-type"], "audio/mp4");
  assert.equal(srv.seen[0].body.toString(), "m4a-bytes");
  assert.ok(Math.abs(dg.usd(3600, "en-zh") - 0.312) < 1e-12); assert.ok(Math.abs(dg.usd(3600, "en") - 0.258) < 1e-12);
});

const input: NotesInput = { courseCode: "ECON 1001", courseName: "Micro", title: "W9", date: "Tuesday 2026-11-10", language: "en-yue", duration: 600,
  lines: [{ t: 1, text: "Hello" }], slides: [], zh: "hant" };
const sse = (chunks: object[]) => chunks.map(c => `data: ${JSON.stringify(c)}\n\n`).join("") + "data: [DONE]\n\n";
const opts = (url: string) => ({ apiKey: "ds-key", baseUrl: url, model: "deepseek-v4-pro", reasoningEffort: "high", maxTokens: 1000, prices: { inputCacheHit: 0.044, inputCacheMiss: 1.32, output: 3.96 } });

test("DeepSeek: a streamed JSON reply with usage; JSON mode, thinking and the prompt are sent", async t => {
  const srv = await fakeServer(() => ({ type: "text/event-stream", body: sse([
    { choices: [{ delta: { reasoning_content: "thinking..." } }] },
    { choices: [{ delta: { content: '{"sections":' } }] },
    { choices: [{ delta: { content: "[]}" }, finish_reason: "stop" }], usage: { prompt_tokens: 1000, completion_tokens: 300, prompt_cache_hit_tokens: 200, prompt_cache_miss_tokens: 800, completion_tokens_details: { reasoning_tokens: 120 } } }
  ]) }));
  t.after(srv.close);
  const ds = new DeepSeekWriter(opts(srv.url));
  const r = await ds.write(input);
  assert.equal(r.text, '{"sections":[]}');
  assert.deepEqual(r.usage, { inputTokens: 1000, cachedInputTokens: 200, outputTokens: 300, reasoningTokens: 120 });
  const req = srv.seen[0], body = JSON.parse(req.body.toString());
  assert.equal(req.url, "/chat/completions"); assert.equal(req.headers.authorization, "Bearer ds-key");
  assert.deepEqual(body.response_format, { type: "json_object" });
  assert.equal(body.model, "deepseek-v4-pro"); assert.equal(body.stream, true); assert.deepEqual(body.stream_options, { include_usage: true });
  assert.equal(body.reasoning_effort, "high"); assert.equal(body.max_tokens, 1000);
  assert.equal(body.messages.length, 2);
  assert.match(body.messages[0].content, /JSON/); assert.match(body.messages[0].content, /Traditional Chinese \(as used in Hong Kong\)/);
  assert.match(body.messages[1].content, /\[1\] Hello/); assert.match(body.messages[1].content, /Lecture date: Tuesday 2026-11-10/);
  /* A repair call shows the model its reply and the problem. */
  await ds.write(input, undefined, { reply: "{bad", problem: "it is not valid JSON" });
  const again = JSON.parse(srv.seen[1].body.toString()).messages;
  assert.deepEqual(again.slice(2).map((m: { role: string }) => m.role), ["assistant", "user"]);
  assert.equal(again[2].content, "{bad"); assert.match(again[3].content, /it is not valid JSON/);
});

test("DeepSeek: cut off at max_tokens is an error that still carries the usage", async t => {
  const srv = await fakeServer(() => ({ type: "text/event-stream", body: sse([{ choices: [{ delta: { content: '{"sec' }, finish_reason: "length" }], usage: { prompt_tokens: 10, completion_tokens: 1000 } }]) }));
  t.after(srv.close);
  await assert.rejects(new DeepSeekWriter(opts(srv.url)).write(input), (e: Error & { usage?: { outputTokens: number } }) => /max_tokens/.test(e.message) && e.usage?.outputTokens === 1000);
});

test("DeepSeek: a 503 is retried; a 401 is not", async t => {
  const srv = await fakeServer((_r, n) => n === 1 ? { status: 503, body: "busy" } : { type: "text/event-stream", body: sse([{ choices: [{ delta: { content: "{}" }, finish_reason: "stop" }] }]) });
  t.after(srv.close);
  assert.equal((await new DeepSeekWriter(opts(srv.url)).write(input)).text, "{}");
  assert.equal(srv.seen.length, 2);
  const denied = await fakeServer(() => ({ status: 401, body: JSON.stringify({ error: { message: "Authentication Fails" } }) }));
  t.after(denied.close);
  await assert.rejects(new DeepSeekWriter(opts(denied.url)).write(input), /deepseek replied 401/);
  assert.equal(denied.seen.length, 1);
});

test("DeepSeek prices: peak hours in UTC on weekdays, half price off-peak", () => {
  assert.equal(isPeak(new Date("2026-11-10T02:30:00Z")), true);    // Tuesday 02:30
  assert.equal(isPeak(new Date("2026-11-10T05:00:00Z")), false);
  assert.equal(isPeak(new Date("2026-11-10T09:59:00Z")), true);
  assert.equal(isPeak(new Date("2026-11-14T02:30:00Z")), false);   // Saturday
  const ds = new DeepSeekWriter(opts("http://x"));
  const u = { inputTokens: 1_000_000, cachedInputTokens: 0, outputTokens: 1_000_000, reasoningTokens: 0 };
  assert.ok(Math.abs(ds.usd(u, new Date("2026-11-10T02:30:00Z")).usd - (1.32 + 3.96)) < 1e-9);
  assert.ok(Math.abs(ds.usd(u, new Date("2026-11-14T02:30:00Z")).usd - (1.32 + 3.96) / 2) < 1e-9);
});
