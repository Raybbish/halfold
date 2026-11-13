/* Runs the same recordings through several speech-to-text services, to choose one with real lectures.
     npm run compare-stt -- --language en-yue lecture1.m4a lecture2.mp3
     npm run compare-stt -- --language en-zh --providers elevenlabs:scribe_v3,deepgram:nova-3 lecture.mp4
   Defaults to elevenlabs:scribe_v3, elevenlabs:scribe_v2 and deepgram:nova-3 (keys from server/.env).
   A reference transcript typed by a person, next to the recording as <name>.ref.txt, adds an error rate
   (English by word, Chinese by character). Output: compare-out/<name>/<provider>.txt (lines with times), the raw
   replies, and compare-out/summary.md. Each run is paid for at the providers' prices. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { CLASS_LANGUAGES, loadConfig, SERVER_DIR, type ClassLanguage, type SttProviderName } from "../src/config";
import { Ffmpeg } from "../src/media";
import { createTranscriber } from "../src/providers";
import { wordsToLines } from "../src/stt/lines";
import { mix, mixedErrorRate } from "../src/stt/compare";

const args = process.argv.slice(2);
const opt = (name: string) => { const i = args.indexOf(name); if (i < 0) return undefined; const v = args[i + 1]; args.splice(i, 2); return v; };
const language = (opt("--language") || "en-yue") as ClassLanguage;
const providers = (opt("--providers") || "elevenlabs:scribe_v3,elevenlabs:scribe_v2,deepgram:nova-3").split(",").map(s => s.trim()).filter(Boolean);
const outRoot = path.resolve(opt("--out") || path.join(SERVER_DIR, "compare-out"));
if (!CLASS_LANGUAGES.includes(language) || !args.length) {
  console.log("npm run compare-stt -- --language en|en-yue|en-zh|auto [--providers elevenlabs:scribe_v3,deepgram:nova-3] file ...");
  process.exit(1);
}

const config = loadConfig(), media = new Ffmpeg();
const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const rows: string[] = ["| 录音 | 服务 | 用时(秒) | 估算$ | 识别出的语言 | 中文字 / 英文词 | 最后一个词(分:秒) | 错误率 |", "|---|---|---|---|---|---|---|---|"];

for (const input of args) {
  const name = path.basename(input).replace(/\.[^.]+$/, ""), dir = path.join(outRoot, name);
  fs.mkdirSync(dir, { recursive: true });
  const audio = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "sn-compare-")), "audio.m4a");
  await media.toSpeechAudio(path.resolve(input), audio);
  const info = await media.probe(audio);
  const refFile = path.resolve(input).replace(/\.[^.]+$/, ".ref.txt");
  const reference = fs.existsSync(refFile) ? fs.readFileSync(refFile, "utf8") : null;
  console.log(`\n${input}: ${clock(info?.duration ?? 0)}${reference ? ", with a reference transcript" : ""}`);
  for (const spec of providers) {
    const [prov, model] = spec.split(":") as [SttProviderName, string | undefined];
    const stt = createTranscriber(config, prov, model), label = `${stt.provider}-${stt.model}`;
    const started = Date.now();
    try {
      const t = await stt.transcribe(audio, language);
      const secs = (Date.now() - started) / 1000, lines = wordsToLines(t.words), text = lines.map(l => l.text).join("\n");
      fs.writeFileSync(path.join(dir, `${label}.txt`), lines.map(l => `[${clock(l.t)}] ${l.text}`).join("\n") + "\n");
      fs.writeFileSync(path.join(dir, `${label}.raw.json`), JSON.stringify(t.raw, null, 1));
      const m = mix(text), last = t.words.length ? t.words[t.words.length - 1].end : 0;
      const er = reference ? (mixedErrorRate(reference, text) * 100).toFixed(1) + "%" : "-";
      rows.push(`| ${name} | ${label} | ${secs.toFixed(0)} | ${stt.usd(info?.duration ?? 0, language).toFixed(4)} | ${t.detectedLanguage ?? "-"} | ${m.chinese} / ${m.other} | ${clock(last)} | ${er} |`);
      console.log(`  ${label}: ${secs.toFixed(0)} s, ${lines.length} lines, ${m.chinese} Chinese characters, ${m.other} other words${reference ? ", error rate " + er : ""}`);
    } catch (e) {
      rows.push(`| ${name} | ${label} | - | - | - | - | - | ${(e as Error).message.slice(0, 80).replace(/\|/g, "/")} |`);
      console.log(`  ${label}: failed: ${(e as Error).message}`);
    }
  }
}
fs.mkdirSync(outRoot, { recursive: true });
fs.writeFileSync(path.join(outRoot, "summary.md"), `# 转写对比（${language}）\n\n${rows.join("\n")}\n`);
console.log(`\n${path.join(outRoot, "summary.md")}`);
