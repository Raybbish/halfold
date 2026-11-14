/* What students said is wrong in their notes ("What is wrong in these notes?" on the lecture page), newest first.
     npm run feedback              the last 50
     npm run feedback -- --all     everything kept
   Feedback is deleted with its lecture. */
import fs from "node:fs";
import path from "node:path";
import { loadConfig } from "../src/config";
import { Store } from "../src/db";

const config = loadConfig();
const file = path.join(config.dataDir, "sidenote.db");
if (!fs.existsSync(file)) { console.log("No database yet."); process.exit(0); }
const store = new Store(file);
const rows = store.feedback(process.argv.includes("--all") ? 1_000_000 : 50);
store.close();
if (!rows.length) { console.log("No feedback yet."); process.exit(0); }
for (const f of rows) console.log(`${f.created_at.slice(0, 16).replace("T", " ")}  ${f.course_code} · ${f.title} (${f.lecture_id})  ${f.user_name || f.user_id}\n  ${f.text.replace(/\n/g, "\n  ")}\n`);
