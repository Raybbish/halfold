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
import { SonioxAsync, tokensToWords } from "../src/stt/soniox";
import { AssemblyAi } from "../src/stt/assemblyai";
import { joinTokens } from "../src/stt/lines";
import { createTranscriber, missingKeys } from "../src/providers";
import { DeepSeekWriter, isPeak } from "../src/notes/deepseek";
import { DeepSeekCatchUp, readPoints } from "../src/notes/catchup";
import { loadConfig } from "../src/config";
import { ProviderError, retryable } from "../src/stt/types";
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
  const dg = new DeepgramNova("dg-key", "nova-3", { en: "en", zh: "multi", yue: "multi", "en-yue": "zh-HK", "en-zh": "multi", auto: "multi" }, 0.258, 0.312, srv.url);
  const r = await dg.transcribe(audioFile(), "en-yue");
  assert.deepEqual(r.words, [{ text: "Hello,", start: 0, end: 0.4, language: "en" }, { text: "機會", start: 0.5, end: 1, language: "zh-HK" }]);
  const u = new URL(srv.url + srv.seen[0].url);
  assert.equal(u.pathname, "/v1/listen");
  assert.deepEqual(Object.fromEntries(u.searchParams), { model: "nova-3", language: "zh-HK", smart_format: "true", punctuate: "true", utterances: "true", utt_split: "0.6" });
  assert.equal(srv.seen[0].headers.authorization, "Token dg-key"); assert.equal(srv.seen[0].headers["content-type"], "audio/mp4");
  assert.equal(srv.seen[0].body.toString(), "m4a-bytes");
  assert.ok(Math.abs(dg.usd(3600, "en-zh") - 0.312) < 1e-12); assert.ok(Math.abs(dg.usd(3600, "en") - 0.258) < 1e-12);
});

test("Deepgram: without punctuation (multi, Chinese), each utterance's last word ends a sentence; Cantonese is reported as yue", async t => {
  const word = (w: string, start: number, end: number, language = "zh-HK") => ({ word: w, punctuated_word: w, start, end, language });
  const replies = [
    { results: { channels: [{ alternatives: [{ languages: ["zh-HK", "en"], words: [word("首先", 0, 0.5), word("我哋", 0.5, 1), word("remember", 1.6, 2, "en"), word("concept", 3, 3.5, "en")] }] }],
      utterances: [{ start: 0, end: 1 }, { start: 1.6, end: 2.02 }, { start: 3, end: 3.5 }] } },
    { results: { channels: [{ alternatives: [{ languages: ["en"], words: [{ word: "hi", punctuated_word: "Hi.", start: 0, end: 0.4 }, { word: "so", punctuated_word: "So", start: 1, end: 1.3 }] }] }],
      utterances: [{ start: 0, end: 0.4 }, { start: 1, end: 1.3 }] } }
  ];
  const srv = await fakeServer((_, n) => ({ body: JSON.stringify(replies[n - 1]) }));
  t.after(srv.close);
  const dg = new DeepgramNova("k", "nova-3", { en: "en", zh: "multi", yue: "multi", "en-yue": "multi", "en-zh": "multi", auto: "multi" }, 0.258, 0.312, srv.url);
  const mixed = await dg.transcribe(audioFile(), "auto");
  assert.deepEqual(mixed.words.map(w => [w.text, !!w.endsSentence]), [["首先", false], ["我哋", true], ["remember", true], ["concept", true]]);
  assert.equal(mixed.detectedLanguage, "yue");
  /* Punctuated (English): the marks decide, utterances are not used. */
  const english = await dg.transcribe(audioFile(), "en");
  assert.deepEqual(english.words.map(w => !!w.endsSentence), [false, false]);
  assert.equal(english.detectedLanguage, "en");
});

test("Soniox: tokens become words: pieces of a word join, a space starts a word, each Chinese character is a word, punctuation joins", () => {
  const tok = (text: string, s: number, language = "en") => ({ text, start_ms: s * 1000, end_ms: s * 1000 + 100, language });
  const words = tokensToWords([tok("Op", 0), tok("port", 0.1), tok("unity", 0.2), tok(" cost", 0.4), tok(" is", 0.6), tok(" 3", 0.8), tok(".", 0.9), tok("5", 1), tok(",", 1.1),
    tok(" 即", 1.5, "zh"), tok("係", 1.6, "zh"), tok("。", 1.7, "zh"), tok("So", 2, "en"), { text: "[laughter]", start_ms: 2500, end_ms: 2600, is_audio_event: true }, tok(" yes", 3), tok(".", 3.1)]);
  assert.deepEqual(words.map(w => [w.text, w.start, w.end, w.language]), [
    ["Opportunity", 0, 0.3, "en"], ["cost", 0.4, 0.5, "en"], ["is", 0.6, 0.7, "en"], ["3.5,", 0.8, 1.2, "en"],
    ["即", 1.5, 1.6, "zh"], ["係。", 1.6, 1.8, "zh"], ["So", 2, 2.1, "en"], ["yes.", 3, 3.2, "en"]]);
  assert.equal(joinTokens(words.map(w => w.text)), "Opportunity cost is 3.5, 即係。 So yes.");
});

test("Soniox: upload, transcribe with the class's hints, wait, read the tokens, then delete the transcription and the file", async t => {
  let polls = 0;
  const srv = await fakeServer(req => {
    if (req.method === "POST" && req.url === "/v1/files") return { status: 201, body: JSON.stringify({ id: "file-1" }) };
    if (req.method === "POST" && req.url === "/v1/transcriptions") return { status: 201, body: JSON.stringify({ id: "tr-1", status: "queued" }) };
    if (req.method === "GET" && req.url === "/v1/transcriptions/tr-1") return { body: JSON.stringify({ id: "tr-1", status: ++polls < 2 ? "processing" : "completed", audio_duration_ms: 9000 }) };
    if (req.method === "GET" && req.url === "/v1/transcriptions/tr-1/transcript") return { body: JSON.stringify({ text: "機會 cost", tokens: [
      { text: "機", start_ms: 0, end_ms: 200, language: "zh" }, { text: "會", start_ms: 200, end_ms: 400, language: "zh" }, { text: " cost", start_ms: 500, end_ms: 900, language: "en" }] }) };
    if (req.method === "DELETE") return { status: 204, body: "" };
    return { status: 404, body: "no route" };
  });
  t.after(srv.close);
  const sx = new SonioxAsync("sx-key", "stt-async-v6", 0.1, srv.url, 5);
  const r = await sx.transcribe(audioFile(), "en-yue");
  assert.deepEqual(r.words, [{ text: "機", start: 0, end: 0.2, language: "zh" }, { text: "會", start: 0.2, end: 0.4, language: "zh" }, { text: "cost", start: 0.5, end: 0.9, language: "en" }]);
  assert.equal(r.durationSec, 9); assert.equal(r.detectedLanguage, "zh");
  assert.deepEqual(srv.seen.map(s => `${s.method} ${s.url}`), ["POST /v1/files", "POST /v1/transcriptions", "GET /v1/transcriptions/tr-1", "GET /v1/transcriptions/tr-1",
    "GET /v1/transcriptions/tr-1/transcript", "DELETE /v1/transcriptions/tr-1", "DELETE /v1/files/file-1"]);
  assert.ok(srv.seen.every(s => s.headers.authorization === "Bearer sx-key"));
  const form = await formOf(srv.seen[0]);
  assert.equal(await (form.get("file") as Blob).text(), "m4a-bytes");
  assert.deepEqual(JSON.parse(srv.seen[1].body.toString()), { model: "stt-async-v6", file_id: "file-1", language_hints: ["zh", "en"], enable_language_identification: true });
  assert.deepEqual(sx.request("f", "en").language_hints, ["en"]);
  assert.ok(Math.abs(sx.usd(3600) - 0.1) < 1e-12);
});

test("Soniox: a failed transcription is an error naming the reason, and is still deleted", async t => {
  const srv = await fakeServer(req => req.url === "/v1/files" ? { status: 201, body: JSON.stringify({ id: "f" }) }
    : req.method === "POST" ? { status: 201, body: JSON.stringify({ id: "x", status: "error", error_message: "audio is empty" }) } : { status: 204, body: "" });
  t.after(srv.close);
  await assert.rejects(new SonioxAsync("k", "stt-async-v6", 0.1, srv.url, 5).transcribe(audioFile(), "en"), /soniox.*audio is empty/);
  assert.deepEqual(srv.seen.filter(s => s.method === "DELETE").map(s => s.url), ["/v1/transcriptions/x", "/v1/files/f"]);
});

test("AssemblyAI: upload the bytes, start the transcript for the class language, wait, words in seconds, then delete it", async t => {
  let polls = 0;
  const srv = await fakeServer(req => {
    if (req.url === "/v2/upload") return { body: JSON.stringify({ upload_url: "https://cdn.example/up-1" }) };
    if (req.method === "POST" && req.url === "/v2/transcript") return { body: JSON.stringify({ id: "t1", status: "queued" }) };
    if (req.method === "GET" && req.url === "/v2/transcript/t1") return { body: JSON.stringify(++polls < 2 ? { id: "t1", status: "processing" }
      : { id: "t1", status: "completed", language_code: "zh", audio_duration: 9, words: [{ text: "機會", start: 0, end: 400 }, { text: "cost.", start: 500, end: 900 }] }) };
    if (req.method === "DELETE") return { body: JSON.stringify({ id: "t1", status: "completed" }) };
    return { status: 404, body: "no route" };
  });
  t.after(srv.close);
  const aai = new AssemblyAi("aai-key", "universal-2", 0.15, srv.url, 5);
  const r = await aai.transcribe(audioFile(), "en-zh");
  assert.deepEqual(r.words, [{ text: "機會", start: 0, end: 0.4 }, { text: "cost.", start: 0.5, end: 0.9 }]);
  assert.equal(r.detectedLanguage, "zh"); assert.equal(r.durationSec, 9);
  assert.deepEqual(srv.seen.map(s => `${s.method} ${s.url}`), ["POST /v2/upload", "POST /v2/transcript", "GET /v2/transcript/t1", "GET /v2/transcript/t1", "DELETE /v2/transcript/t1"]);
  assert.ok(srv.seen.every(s => s.headers.authorization === "aai-key"));
  assert.equal(srv.seen[0].body.toString(), "m4a-bytes");
  assert.deepEqual(JSON.parse(srv.seen[1].body.toString()), { audio_url: "https://cdn.example/up-1", speech_models: ["universal-2"], punctuate: true, format_text: true,
    language_detection: true, language_detection_options: { code_switching: true } });
  /* English classes name the language; 3.7 mixes languages without being asked. */
  assert.equal((aai.request("u", "en") as { language_code?: string }).language_code, "en");
  assert.deepEqual(new AssemblyAi("k", "assemblyai-stt-3-7", 0.21).request("u", "en-yue"), { audio_url: "u", speech_models: ["assemblyai-stt-3-7"], punctuate: true, format_text: true, language_detection: true });
});

test("config: Soniox and AssemblyAI settings; another AssemblyAI model is priced at its own list price", () => {
  const c = loadConfig({ STT_PROVIDER: "soniox", SONIOX_API_KEY: "s", ASSEMBLYAI_API_KEY: "a" });
  assert.equal(c.stt.provider, "soniox");
  assert.deepEqual(c.stt.soniox, { apiKey: "s", model: "stt-async-v6", usdPerHour: 0.1 });
  assert.deepEqual(c.stt.assemblyai, { apiKey: "a", model: "assemblyai-stt-3-7", usdPerHour: 0.21 });
  assert.equal(loadConfig({ ASSEMBLYAI_MODEL: "universal-2" }).stt.assemblyai.usdPerHour, 0.15);
  assert.ok(Math.abs(createTranscriber(c, "assemblyai", "universal-2").usd(3600, "en-yue") - 0.15) < 1e-12);
  assert.ok(Math.abs(createTranscriber(c, "assemblyai").usd(3600, "en-yue") - 0.21) < 1e-12);
  assert.throws(() => loadConfig({ STT_PROVIDER: "whisper" }), /must be one of elevenlabs, deepgram, soniox, assemblyai/);
  assert.deepEqual(missingKeys(loadConfig({ STT_PROVIDER: "assemblyai", DEEPSEEK_API_KEY: "d" })), ["ASSEMBLYAI_API_KEY"]);
});

test("config: Deepgram is the default speech-to-text service, mixed classes on multi", () => {
  const c = loadConfig({});
  assert.equal(c.stt.provider, "deepgram");
  assert.deepEqual(c.stt.deepgram.languages, { en: "en", zh: "multi", yue: "multi", "en-zh": "multi", "en-yue": "multi", auto: "multi" });
  assert.equal(loadConfig({ STT_PROVIDER: "elevenlabs" }).stt.provider, "elevenlabs");
});

const input: NotesInput = { courseCode: "ECON 1001", courseName: "Micro", title: "W9", date: "Tuesday 2026-11-10", language: "en-yue", duration: 600,
  lines: [{ t: 1, text: "Hello" }], slides: [], zh: true };
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
  assert.match(body.messages[0].content, /JSON/); assert.match(body.messages[0].content, /Traditional Chinese as written in Hong Kong/);
  assert.match(body.messages[0].content, /standard written Chinese \(書面語\), not spoken Cantonese/);
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

test("retries only what was not charged: 429, 5xx, or a request that never reached the service", () => {
  assert.equal(retryable(new ProviderError("x", 429, "")), true);
  assert.equal(retryable(new ProviderError("x", 502, "")), true);
  assert.equal(retryable(new ProviderError("x", 400, "")), false);
  assert.equal(retryable(Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } })), true);
  assert.equal(retryable(Object.assign(new TypeError("fetch failed"), { cause: { code: "UND_ERR_BODY_TIMEOUT" } })), false);   // the audio was sent
  assert.equal(retryable(new SyntaxError("Unexpected end of JSON input")), false);
});

test("Catch me up: deepseek-flash without thinking, the transcript with times; the points read; an unusable reply is an error with usage", async t => {
  const srv = await fakeServer((_r, n) => ({ type: "text/event-stream", body: sse([
    { choices: [{ delta: { content: n === 1 ? '{"points": ["Elasticity is the response of demand to price.", " ", 3, "Problem set 2 is due Friday."]}' : '{"summary": "x"}' }, finish_reason: "stop" }],
      usage: { prompt_tokens: 900, completion_tokens: 40 } }
  ]) }));
  t.after(srv.close);
  const config = loadConfig({ DEEPSEEK_API_KEY: "ds-key" });
  assert.equal(config.catchUp.model, "deepseek-flash"); assert.equal(config.catchUp.reasoningEffort, "none");
  assert.deepEqual(config.catchUp.prices, { inputCacheHit: 0.006, inputCacheMiss: 0.3, output: 1.2 });
  const cu = new DeepSeekCatchUp({ ...config.catchUp, baseUrl: srv.url });
  const lines = [{ t: 61, text: "Elasticity measures how demand responds to price." }, { t: 125, text: "下星期五交 problem set 2。" }];
  const r = await cu.sumUp({ courseCode: "ECON 1001", title: "Week 10", language: "en-yue", lines });
  assert.deepEqual(r.points, ["Elasticity is the response of demand to price.", "Problem set 2 is due Friday."]);
  assert.deepEqual(r.usage, { inputTokens: 900, cachedInputTokens: 0, outputTokens: 40, reasoningTokens: 0 });
  const body = JSON.parse(srv.seen[0].body.toString());
  assert.equal(body.model, "deepseek-flash"); assert.equal(body.reasoning_effort, "none"); assert.deepEqual(body.response_format, { type: "json_object" });
  assert.match(body.messages[0].content, /English and Cantonese/);
  assert.match(body.messages[1].content, /\[1:01\] Elasticity measures/); assert.match(body.messages[1].content, /\[2:05\] 下星期五交 problem set 2。/);
  await assert.rejects(cu.sumUp({ courseCode: "", title: "W", language: "en", lines }), (e: Error & { usage?: unknown }) => /no points/.test(e.message) && !!e.usage);
  assert.deepEqual(readPoints('["a", "b", "c", "d", "e"]'), ["a", "b", "c", "d"]);
  assert.throws(() => readPoints("not json"), /not JSON/);
});
