/* What each lecture cost, and the per-hour and per-lecture figures asked for in reference/INTEGRATION.md section 10.
     npm run costs              all lectures
     npm run costs -- --json    the same as JSON
   Dollar amounts are list-price estimates made when each step ran (prices in server/.env, defaults in src/config.ts). */
import fs from "node:fs";
import path from "node:path";
import { loadConfig } from "../src/config";
import { Store, type CostRow } from "../src/db";

const config = loadConfig();
const file = path.join(config.dataDir, "sidenote.db");
if (!fs.existsSync(file)) { console.log("No database yet: nothing has been processed."); process.exit(0); }
const store = new Store(file);
const rows = store.costs();
store.close();

interface Lecture {
  id: string; when: string; audioSeconds: number; stt: string; sttUsd: number; notesModel: string; attempts: number; inTok: number; cachedTok: number; outTok: number;
  reasoningTok: number; notesUsd: number; slidePages: number; zh: string | null; audioBytesPerHour: number | null;
  liveSent: number; liveUsd: number; liveRounds: number; catchUps: number; catchUpUsd: number;   // live recording (phase 2)
  slidesUsd: number;   // slides sent after the notes (phase 3)
}
const meta = (r: CostRow) => (r.meta_json ? JSON.parse(r.meta_json) : {}) as Record<string, any>;
const lectures = new Map<string, Lecture>();
/* Review packs are per course: their rows carry the course id where a lecture id goes. */
const packRows = rows.filter(r => r.stage === "pack");
for (const r of rows) {
  if (r.stage === "pack") continue;
  const l = lectures.get(r.lecture_id) ?? { id: r.lecture_id, when: r.created_at.slice(0, 16).replace("T", " "), audioSeconds: 0, stt: "", sttUsd: 0, notesModel: "", attempts: 0, inTok: 0, cachedTok: 0, outTok: 0, reasoningTok: 0, notesUsd: 0, slidePages: 0, zh: null, audioBytesPerHour: null,
    liveSent: 0, liveUsd: 0, liveRounds: 0, catchUps: 0, catchUpUsd: 0, slidesUsd: 0 };
  const m = meta(r);
  if (r.stage === "slides") l.slidesUsd += r.usd ?? 0;
  else if (r.stage === "live") { l.liveSent += r.audio_seconds ?? 0; l.liveUsd += r.usd ?? 0; l.liveRounds++; }
  else if (r.stage === "catchup") { l.catchUps++; l.catchUpUsd += r.usd ?? 0; }
  else if (r.stage === "stt") { l.audioSeconds = r.audio_seconds ?? l.audioSeconds; l.stt = `${r.provider} ${r.model}`; l.sttUsd += r.usd ?? 0; l.audioBytesPerHour = m.audioBytesPerHour ?? null; }
  else {
    l.notesModel = `${r.provider} ${r.model}`; l.attempts++; l.inTok += r.input_tokens ?? 0; l.cachedTok += r.cached_input_tokens ?? 0; l.outTok += r.output_tokens ?? 0;
    l.reasoningTok += r.reasoning_tokens ?? 0; l.notesUsd += r.usd ?? 0; l.slidePages = m.slidePages ?? 0; l.zh = m.zh ?? null;
    if (!l.audioSeconds && m.audioSeconds) l.audioSeconds = m.audioSeconds;
  }
  lectures.set(r.lecture_id, l);
}
const list = [...lectures.values()];
if (process.argv.includes("--json")) { console.log(JSON.stringify(list, null, 2)); process.exit(0); }
if (!list.length && !packRows.length) { console.log("No costs logged yet."); process.exit(0); }

const usd = (n: number) => "$" + n.toFixed(n < 0.1 ? 4 : 3);
const k = (n: number) => (n / 1000).toFixed(1) + "k";
console.log("每堂课\n");
console.log(["时间", "课堂", "录音(分)", "转写", "转写$", "实时转写$", "Catch me up 次数/$", "笔记模型", "次数", "输入tok(缓存)", "输出tok(思考)", "笔记$", "课件页", "中文", "补传课件$", "合计$"].join("\t"));
for (const l of list) console.log([l.when, l.id, (l.audioSeconds / 60).toFixed(1), l.stt, usd(l.sttUsd), l.liveRounds ? usd(l.liveUsd) : "-", l.catchUps ? `${l.catchUps}/${usd(l.catchUpUsd)}` : "-",
  l.notesModel, l.attempts, `${k(l.inTok)}(${k(l.cachedTok)})`, `${k(l.outTok)}(${k(l.reasoningTok)})`, usd(l.notesUsd), l.attempts ? l.slidePages : "-", l.attempts ? l.zh ?? "off" : "-",
  l.slidesUsd ? usd(l.slidesUsd) : "-", usd(l.sttUsd + l.notesUsd + l.liveUsd + l.catchUpUsd + l.slidesUsd)].join("\t"));

/* Section 10 of INTEGRATION.md. Per-lecture figures are scaled to a 90-minute lecture, from recordings of at least 20
   minutes only: part of a notes call does not grow with the length (the instructions, the model's thinking), so scaling
   up a one-minute test would overstate it many times. */
const LONG_ENOUGH = 20 * 60;
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const per90 = (ls: Lecture[]) => { const min = sum(ls.map(l => l.audioSeconds)) / 60; return min ? sum(ls.map(l => l.notesUsd)) / min * 90 : NaN; };
const withAudio = list.filter(l => l.audioSeconds > 0 && l.sttUsd > 0);
const byStt = new Map<string, Lecture[]>(); for (const l of withAudio) byStt.set(l.stt, [...(byStt.get(l.stt) || []), l]);
const written = list.filter(l => l.attempts > 0 && l.audioSeconds >= LONG_ENOUGH);
const short = list.filter(l => l.attempts > 0 && l.audioSeconds > 0 && l.audioSeconds < LONG_ENOUGH);
const slides = written.filter(l => l.slidePages > 0), noSlides = written.filter(l => !l.slidePages);
const zhOn = written.filter(l => l.zh), zhOff = written.filter(l => !l.zh);
const sizes = list.map(l => l.audioBytesPerHour).filter((x): x is number => x != null);
const show = (n: number) => Number.isFinite(n) ? usd(n) : "(还没有 20 分钟以上的课)";
console.log("\n第 10 节需要的数字\n");
for (const [name, ls] of byStt) console.log(`转写成本（${name}）：每小时录音 ${usd(sum(ls.map(l => l.sttUsd)) / (sum(ls.map(l => l.audioSeconds)) / 3600))}，共 ${(sum(ls.map(l => l.audioSeconds)) / 3600).toFixed(2)} 小时`);
console.log(`生成笔记、闪卡、测验：每堂 90 分钟的课 ${show(per90(written))}（${written.length} 堂 20 分钟以上的课）`);
if (short.length) console.log(`  不到 20 分钟的课不算在内（${short.length} 堂，平均每堂笔记 ${usd(sum(short.map(l => l.notesUsd)) / short.length)}）`);
console.log(`有课件 vs 没课件：${show(per90(slides))}（${slides.length} 堂） vs ${show(per90(noSlides))}（${noSlides.length} 堂）`);
console.log(`有中文解释 vs 没有：${show(per90(zhOn))}（${zhOn.length} 堂） vs ${show(per90(zhOff))}（${zhOff.length} 堂）`);
console.log(`转码后的回放文件：每小时 ${sizes.length ? (sum(sizes) / sizes.length / 1048576).toFixed(1) + " MB" : "(还没有数据)"}`);
/* Live recordings pay for speech-to-text twice: the live rounds (with the held tail sent again) and the whole recording after. */
const lives = list.filter(l => l.liveRounds > 0 && l.audioSeconds > 0 && l.sttUsd > 0);
if (lives.length) {
  const liveUsd = sum(lives.map(l => l.liveUsd)), finalUsd = sum(lives.map(l => l.sttUsd)), hours = sum(lives.map(l => l.audioSeconds)) / 3600;
  console.log(`实时转写：每小时录音 ${usd(liveUsd / hours)}，送出的音频是录音长度的 ${(sum(lives.map(l => l.liveSent)) / (hours * 3600)).toFixed(2)} 倍；` +
    `现场录音的转写共 ${usd((liveUsd + finalUsd) / hours)}/小时，是上传录音（只转写一次）的 ${((liveUsd + finalUsd) / finalUsd).toFixed(2)} 倍（${lives.length} 堂）`);
}
const catchUps = list.filter(l => l.catchUps > 0);
if (catchUps.length) console.log(`Catch me up：每点一次 ${usd(sum(catchUps.map(l => l.catchUpUsd)) / sum(catchUps.map(l => l.catchUps)))}（${sum(catchUps.map(l => l.catchUps))} 次）`);
console.log(`重写次数：${written.filter(l => l.attempts > 1).length} 堂课的笔记要了不止一次`);
const slideAdds = list.filter(l => l.slidesUsd > 0);
if (slideAdds.length) console.log(`课后补传课件：每堂 ${usd(sum(slideAdds.map(l => l.slidesUsd)) / slideAdds.length)}（${slideAdds.length} 堂）`);
/* One pack is one or two calls (a second when the first reply could not be used); attempt 1 starts a pack. */
if (packRows.length) {
  const made = packRows.filter(r => meta(r).attempt === 1), total = sum(packRows.map(r => r.usd ?? 0));
  const lectures = sum(made.map(r => meta(r).lectures ?? 0)) / (made.length || 1);
  console.log(`复习包：每次 ${usd(total / (made.length || 1))}（${made.length} 次，平均每次 ${lectures.toFixed(1)} 堂课，共 ${usd(total)}）`);
}
