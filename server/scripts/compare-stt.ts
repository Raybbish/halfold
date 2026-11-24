/* Runs the same recordings through several speech-to-text services, to choose one with real lectures.
     npm run compare-stt -- --language en-yue lecture1.m4a lecture2.mp3
     npm run compare-stt -- --language en-zh --providers elevenlabs:scribe_v3,deepgram:nova-3 lecture.mp4
   Defaults to deepgram:nova-3, soniox:stt-async-v6, assemblyai:universal-2 and assemblyai:assemblyai-stt-3-7 (keys from
   server/.env; elevenlabs:scribe_v3 by name). A reference transcript typed by a person, next to the recording as
   <name>.ref.txt, adds an error rate (English by word, Chinese by character). Output: compare-out/<name>/<provider>.txt
   (lines with times), the raw replies, and compare-out/summary.md. Each run is paid for at the providers' prices.
     npm run compare-stt -- --language en-yue --chunks 15 lecture.m4a
   also transcribes the recording the way a live recording is: a round every 15 seconds of audio, from where the last
   round stopped (src/live/windows.ts). That row is <provider>+live15; its cost counts the audio sent again.
     npm run compare-stt -- --notes lec-BVH3u3HUg81s
   A lecture id instead of a file: its recording (DATA_DIR/lectures/<id>/audio.m4a) and its class language, plus a row
   "stored" with the transcript and notes the app made for it then, to compare against without paying for that service
   again. --notes also writes notes from each transcript with the app's notes prompt (<provider>.notes.md), the way a
   lecture without slides gets them, so what each transcript does to the notes can be read side by side. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { CLASS_LANGUAGES, loadConfig, SERVER_DIR, type ClassLanguage, type SttProviderName } from "../src/config";
import { Ffmpeg } from "../src/media";
import { createNotesWriter, createTranscriber } from "../src/providers";
import { wordsToLines } from "../src/stt/lines";
import { mix, mixedErrorRate } from "../src/stt/compare";
import { cutWindow, MIN_WINDOW, shift } from "../src/live/windows";
import { buildDetail, parseModelNotes } from "../src/notes/normalize";
import { promptDate } from "../src/time";
import type { Transcriber, Word } from "../src/stt/types";
import type { NotesInput } from "../src/notes/types";
import type { Detail, Line } from "../../src/types";

const args = process.argv.slice(2);
const opt = (name: string) => { const i = args.indexOf(name); if (i < 0) return undefined; const v = args[i + 1]; args.splice(i, 2); return v; };
const flag = (name: string) => { const i = args.indexOf(name); if (i >= 0) args.splice(i, 1); return i >= 0; };
const language = (opt("--language") || "en-yue") as ClassLanguage;
const providers = (opt("--providers") || "deepgram:nova-3,soniox:stt-async-v6,assemblyai:universal-2,assemblyai:assemblyai-stt-3-7").split(",").map(s => s.trim()).filter(Boolean);
const outRoot = path.resolve(opt("--out") || path.join(SERVER_DIR, "compare-out"));
const chunkSeconds = Number(opt("--chunks") || 0);
const withNotes = flag("--notes");
if (!CLASS_LANGUAGES.includes(language) || !args.length) {
  console.log("npm run compare-stt -- [--language en|en-yue|en-zh|auto] [--providers soniox,assemblyai:universal-2] [--chunks 15] [--notes] file|lecture-id ...");
  process.exit(1);
}

const config = loadConfig(), media = new Ffmpeg(), notesWriter = withNotes ? createNotesWriter(config) : null;
const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const rows: string[] = [
  "| 录音 | 服务 | 用时(秒) | 转写$ | 识别出的语言 | 中文字 / 英文词 | 最后一个词(分:秒) | 错误率 | 笔记要点 | 考试提醒 |",
  "|---|---|---|---|---|---|---|---|---|---|"];

/* The app's database, read only (no migrations): a lecture's language, its stored transcript and notes, and which service
   transcribed it. */
const db = args.some(a => /^lec-/.test(a)) ? new DatabaseSync(path.join(config.dataDir, "sidenote.db"), { readOnly: true }) : null;
function storedLecture(id: string) {
  const l = db!.prepare("SELECT language FROM lectures WHERE id = ?").get(id) as { language: ClassLanguage } | undefined;
  if (!l) throw new Error(`no lecture ${id} in ${config.dataDir}`);
  const d = db!.prepare("SELECT detail_json FROM details WHERE lecture_id = ?").get(id) as { detail_json: string } | undefined;
  const stt = db!.prepare("SELECT provider, model FROM costs WHERE lecture_id = ? AND stage = 'stt' ORDER BY id LIMIT 1").get(id) as { provider: string; model: string } | undefined;
  return { language: l.language, detail: d ? JSON.parse(d.detail_json) as Detail : null, by: stt ? `${stt.provider}-${stt.model}` : "unknown" };
}

/* A live recording: every chunkSeconds of audio, transcribe from where the last round stopped to the end of what has
   arrived. Returns the words in recording time, the audio seconds sent (paid for) and the seconds each round took. */
async function liveRounds(stt: Transcriber, audio: string, duration: number, lang: ClassLanguage) {
  const dir = path.dirname(audio), words: Word[] = [], waits: number[] = [];
  let from = 0, sent = 0;
  for (let r = 1; from < duration; r++) {
    const until = Math.min(duration, r * chunkSeconds), final = until >= duration;
    if (!final && until - from < MIN_WINDOW) continue;
    const out = path.join(dir, `window-${r}.m4a`), started = Date.now();
    const len = await media.cutSpeech(dir, [path.basename(audio)], out, { from, to: until });
    const t = await stt.transcribe(out, lang);
    waits.push((Date.now() - started) / 1000); sent += len;
    const cut = cutWindow(shift(t.words, from), from, from + len, final);
    words.push(...cut.keep); from = cut.next;
    if (final) break;
  }
  return { words, sent, waits };
}

function notesMarkdown(d: Pick<Detail, "summary" | "alerts" | "sections">) {
  const out: string[] = [];
  if (d.summary?.length) out.push("## 摘要", ...d.summary.map(s => `- ${s}`), "");
  if (d.alerts?.length) out.push("## 考试提醒", ...d.alerts.map(a => `- [${clock(a.t)}] ${a.kind}: ${a.text}`), "");
  for (const s of d.sections || []) out.push(`## ${s.title}`, ...s.points.map(p => `- ${p.t != null ? `[${clock(p.t)}] ` : ""}${p.text}`), "");
  return out.join("\n");
}
const counts = (d: Pick<Detail, "alerts" | "sections">) => ({ points: (d.sections || []).reduce((n, s) => n + s.points.length, 0), alerts: (d.alerts || []).length });

/* Notes from these lines with the app's prompt, as for a lecture without slides: like the app (pipeline.ts), an unusable
   reply is shown back to the model once. */
async function writeNotes(dir: string, label: string, title: string, lines: Line[], duration: number, lang: ClassLanguage) {
  const zh = config.zhExplanations ? (lang === "en-zh" ? "hans" : "hant") : null;
  const input: NotesInput = { courseCode: "", courseName: "", title, date: promptDate(new Date(), config.timezone), language: lang, duration, lines, slides: [], zh };
  let usd = 0, repair: { reply: string; problem: string } | undefined;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const call = await notesWriter!.write(input, undefined, repair);
    usd += notesWriter!.usd(call.usage, call.startedAt).usd;
    try {
      const { detail } = buildDetail(parseModelNotes(call.text), { duration, lines, slidePages: [], zh });
      fs.writeFileSync(path.join(dir, `${label}.notes.md`), notesMarkdown(detail));
      return { ...counts(detail), usd };
    } catch (e) {
      repair = { reply: call.text, problem: (e as Error).message };
      fs.writeFileSync(path.join(dir, `${label}.notes.raw.txt`), call.text);
    }
  }
  throw new Error(`notes not usable: ${repair!.problem}`);
}

const writeLines = (file: string, lines: Line[]) => fs.writeFileSync(file, lines.map(l => `[${clock(l.t)}] ${l.text}`).join("\n") + "\n");
const cell = (e: unknown) => (e as Error).message.slice(0, 80).replace(/\|/g, "/");

for (const input of args) {
  const fromDb = /^lec-[A-Za-z0-9_-]+$/.test(input) ? storedLecture(input) : null;
  const lang = fromDb?.language ?? language;
  const source = fromDb ? path.join(config.dataDir, "lectures", input, "audio.m4a") : path.resolve(input);
  const name = path.basename(input).replace(/\.[^.]+$/, ""), dir = path.join(outRoot, name);
  fs.mkdirSync(dir, { recursive: true });
  const audio = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "sn-compare-")), "audio.m4a");
  await media.toSpeechAudio(source, audio);
  const info = await media.probe(audio), duration = info?.duration ?? 0;
  const refFile = source.replace(/\.[^.]+$/, ".ref.txt");
  const reference = fs.existsSync(refFile) ? fs.readFileSync(refFile, "utf8") : null;
  const errorRate = (text: string) => reference ? (mixedErrorRate(reference, text) * 100).toFixed(1) + "%" : "-";
  console.log(`\n${input}: ${clock(duration)}, ${lang}${reference ? ", with a reference transcript" : ""}`);

  /* What the app made for this lecture when it was processed: the transcript, and the notes it showed (stored.app-notes.md).
     The prompt may have changed since, so with --notes the stored transcript also gets notes from today's prompt
     (stored.notes.md, the counts in the table), to compare like with like. */
  if (fromDb?.detail) {
    const lines = fromDb.detail.transcript || [], text = lines.map(l => l.text).join("\n"), m = mix(text), c = counts(fromDb.detail);
    writeLines(path.join(dir, "stored.txt"), lines);
    fs.writeFileSync(path.join(dir, "stored.app-notes.md"), notesMarkdown(fromDb.detail));
    let notes = `${c.points} (app) | ${c.alerts} (app)`;
    if (notesWriter) {
      try { const n = await writeNotes(dir, "stored", name, lines, duration, lang); notes = `${n.points} | ${n.alerts}`; }
      catch (e) { notes = `${cell(e)} | -`; }
    }
    rows.push(`| ${name} | stored (${fromDb.by}) | - | - | - | ${m.chinese} / ${m.other} | ${clock(lines.length ? lines[lines.length - 1].t : 0)} | ${errorRate(text)} | ${notes} |`);
    console.log(`  stored (${fromDb.by}): ${lines.length} lines, ${notes.replace(" | ", " points, ")} exam alerts`);
  }

  for (const spec of providers) {
    const [prov, model] = spec.split(":") as [SttProviderName, string | undefined];
    const stt = createTranscriber(config, prov, model), label = `${stt.provider}-${stt.model}`;
    const started = Date.now();
    try {
      const t = await stt.transcribe(audio, lang);
      const secs = (Date.now() - started) / 1000, lines = wordsToLines(t.words), text = lines.map(l => l.text).join("\n");
      writeLines(path.join(dir, `${label}.txt`), lines);
      fs.writeFileSync(path.join(dir, `${label}.raw.json`), JSON.stringify(t.raw, null, 1));
      const m = mix(text), last = t.words.length ? t.words[t.words.length - 1].end : 0;
      let notes = "- | -";
      if (notesWriter) {
        try { const n = await writeNotes(dir, label, name, lines, duration, lang); notes = `${n.points} | ${n.alerts}`; console.log(`  ${label}: notes with ${n.points} points ($${n.usd.toFixed(4)})`); }
        catch (e) { notes = `${cell(e)} | -`; console.log(`  ${label}: notes failed: ${(e as Error).message}`); }
      }
      rows.push(`| ${name} | ${label} | ${secs.toFixed(0)} | ${stt.usd(duration, lang).toFixed(4)} | ${t.detectedLanguage ?? "-"} | ${m.chinese} / ${m.other} | ${clock(last)} | ${errorRate(text)} | ${notes} |`);
      console.log(`  ${label}: ${secs.toFixed(0)} s, ${lines.length} lines, ${m.chinese} Chinese characters, ${m.other} other words${reference ? ", error rate " + errorRate(text) : ""}`);
    } catch (e) {
      rows.push(`| ${name} | ${label} | - | - | - | - | - | ${cell(e)} | - | - |`);
      console.log(`  ${label}: failed: ${(e as Error).message}`);
    }
    if (!chunkSeconds) continue;
    const liveLabel = `${label}+live${chunkSeconds}`;
    try {
      const live = await liveRounds(stt, audio, duration, lang);
      const lines = wordsToLines(live.words), text = lines.map(l => l.text).join("\n"), m = mix(text);
      writeLines(path.join(dir, `${liveLabel}.txt`), lines);
      const slowest = Math.max(...live.waits), mean = live.waits.reduce((a, b) => a + b, 0) / live.waits.length;
      rows.push(`| ${name} | ${liveLabel} | 每轮 ${mean.toFixed(1)}，最慢 ${slowest.toFixed(1)} | ${stt.usd(live.sent, lang).toFixed(4)} | - | ${m.chinese} / ${m.other} | - | ${errorRate(text)} | - | - |`);
      console.log(`  ${liveLabel}: ${live.waits.length} rounds, ${live.sent.toFixed(0)} s of audio sent for ${duration.toFixed(0)} s, ${mean.toFixed(1)} s a round${reference ? ", error rate " + errorRate(text) : ""}`);
    } catch (e) {
      rows.push(`| ${name} | ${liveLabel} | - | - | - | - | - | ${cell(e)} | - | - |`);
      console.log(`  ${liveLabel}: failed: ${(e as Error).message}`);
    }
  }
}
fs.mkdirSync(outRoot, { recursive: true });
fs.writeFileSync(path.join(outRoot, "summary.md"), `# 转写对比\n\n${rows.join("\n")}\n`);
console.log(`\n${path.join(outRoot, "summary.md")}`);
