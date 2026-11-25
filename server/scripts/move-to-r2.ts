/* Moves the recordings (audio.m4a) and slides of lectures with notes from this server's disk to R2, once, after the R2
   settings are in server/.env.
     npm run move-to-r2 -- --dry-run    what would move, and how much
     npm run move-to-r2                 moves it
   Each file is uploaded, then read back from R2 (size, and MD5 against the ETag) before it is deleted here; a file that
   does not check out stays here and is still played from here. Safe to run again: what has moved is skipped, what
   failed is tried again. Safe while the server runs (it does the same every six hours, one lecture at a time). Lectures
   without notes keep their files here: the notes still need them. */
import path from "node:path";
import { loadConfig } from "../src/config";
import { Store } from "../src/db";
import { createFileStore } from "../src/files";
import { sweepKept } from "../src/audio";

const config = loadConfig();
if (!config.r2) {
  console.log("R2 is not set up: add R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY and R2_BUCKET to server/.env first (see .env.example).");
  process.exit(1);
}
const dry = process.argv.includes("--dry-run");
const store = new Store(path.join(config.dataDir, "sidenote.db"));
const files = createFileStore(config, store, { clearTemp: false });
const mb = (n: number) => (n / 1048576).toFixed(1) + " MB";

if (dry) {
  let n = 0, bytes = 0;
  for (const l of store.lecturesWithStatus("ready")) for (const f of files.pending(l.id)) { console.log(`${l.id}  ${f.name}  ${mb(f.bytes)}`); n++; bytes += f.bytes; }
  console.log(`${n} file(s), ${mb(bytes)}, would move to ${files.bucket}. Already there: ${store.remoteTotals().files} file(s).`);
} else {
  let bytes = 0;
  const r = await sweepKept({ store, files }, {
    all: true,
    report: (id, got) => {
      if (got instanceof Error) console.log(`${id}  NOT MOVED (kept here): ${got.message}`);
      else for (const f of got) { bytes += f.bytes; console.log(`${id}  ${f.name}  ${mb(f.bytes)}  moved`); }
    }
  });
  const there = store.remoteTotals();
  console.log(`Moved ${r.moved} file(s), ${mb(bytes)}, to ${files.bucket}.${r.failed ? ` ${r.failed} lecture(s) could not be moved: run this again later.` : ""}` +
    `${r.deleted ? ` Deleted ${r.deleted} object(s) left from deleted lectures.` : ""} In R2 now: ${there.files} file(s), ${mb(there.bytes)}.`);
  if (r.failed) process.exitCode = 1;
}
const waiting = (["recording", "processing", "failed"] as const).reduce((n, st) => n + store.lecturesWithStatus(st).length, 0);
if (waiting) console.log(`${waiting} lecture(s) without notes yet keep their files on this disk until their notes are written.`);
store.close();
