/* Sign-ups a day and the share of students who ticked each consent (handoff of 2026-11-23, item 8; src/signups.ts).
     npm run signups                 the last 30 days
     npm run signups -- --days=90    another number of days
     npm run signups -- --json       the same as JSON
   Days are in APP_TIMEZONE. */
import fs from "node:fs";
import path from "node:path";
import { loadConfig } from "../src/config";
import { Store } from "../src/db";
import { signUpReport } from "../src/signups";

const config = loadConfig();
const file = path.join(config.dataDir, "sidenote.db");
if (!fs.existsSync(file)) { console.log("No database yet: nobody has signed up."); process.exit(0); }
const days = Number(/^--days=(\d+)$/.exec(process.argv.find(a => a.startsWith("--days=")) || "")?.[1] ?? 30);
const store = new Store(file);
const r = signUpReport(store, config.timezone, { days });
store.close();
if (process.argv.includes("--json")) { console.log(JSON.stringify(r, null, 2)); process.exit(0); }

const pct = (x: number | null) => x === null ? "-" : (x * 100).toFixed(1) + "%";
console.log(`每天注册数（${config.timezone}，最近 ${r.days.length} 天）\n`);
for (const d of r.days) console.log(`${d.date}\t${d.signUps}`);
console.log(`\n共 ${r.days.reduce((n, d) => n + d.signUps, 0)} 个；用邮箱登录过的账户一共 ${r.accounts} 个，其中 ${r.undated} 个是 2026-11-24 之前注册的，没有注册日期。`);
console.log(`\n资料：填了 ${r.profiles.filledIn} 个，选了“暂时不要”${r.profiles.putOff} 个，还没问到 ${r.profiles.notAskedYet} 个。`);
console.log(`\n同意（占回答过的人）`);
for (const [name, c] of [["接收招聘、升学和学生优惠信息", r.marketing], ["参加有偿问卷调研", r.survey]] as const)
  console.log(`${name}：${c.ticked} / ${c.answered}，${pct(c.share)}；同意后又取消的 ${c.withdrawn} 个`);
