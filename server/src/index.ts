/* Starts the server: `npm start` in server/ (settings in server/.env, see .env.example). */
import fs from "node:fs";
import path from "node:path";
import { serve } from "@hono/node-server";
import { loadConfig } from "./config";
import { Store } from "./db";
import { LocalFileStore } from "./files";
import { Ffmpeg } from "./media";
import { Pipeline } from "./pipeline";
import { createApp } from "./app";
import { createNotesWriter, createTranscriber, missingKeys } from "./providers";
import { LiveTranscriber } from "./live/transcriber";
import { DeepSeekCatchUp } from "./notes/catchup";
import { sweepAudio } from "./audio";

const config = loadConfig();
fs.mkdirSync(config.dataDir, { recursive: true });
const store = new Store(path.join(config.dataDir, "sidenote.db"));
for (const code of config.inviteCodes) store.addInviteCode(code);
const files = new LocalFileStore(config.dataDir);
const media = new Ffmpeg();
const stt = createTranscriber(config), notes = createNotesWriter(config);
const pipeline = new Pipeline({ config, store, files, media, stt, notes });
const live = new LiveTranscriber({ config, store, files, media, stt });
const app = createApp({ config, store, files, media, jobs: pipeline, live, catchUp: new DeepSeekCatchUp(config.catchUp) });

/* AUDIO_KEEP_DAYS: recordings past their keep date are deleted at start and every six hours. */
const sweep = () => sweepAudio(config, store, files).then(n => { if (n) console.log(`[sidenote] deleted ${n} recording(s) past AUDIO_KEEP_DAYS`); }, e => console.error("[sidenote] sweep:", e));
if (config.audioKeepDays > 0) { void sweep(); setInterval(sweep, 6 * 3600_000).unref(); }

const missing = missingKeys(config);
if (missing.length) console.warn(`[sidenote] not set in server/.env: ${missing.join(", ")}. Notes cannot be written until they are.`);
if (!store.listUsers().length) console.warn("[sidenote] no invite codes yet: set INVITE_CODES in server/.env, or run npm run invite -- add <code>");

/* Node ends a request after 5 minutes by default, which cuts off a 500 MB upload on a slow connection. */
const server = serve({ fetch: app.fetch, port: config.port, serverOptions: { requestTimeout: 3 * 3600_000 } }, info => {
  console.log(`[sidenote] http://localhost:${info.port}  speech-to-text: ${stt.provider} ${stt.model}  notes: ${notes.provider} ${notes.model}` +
    `  live: ${!config.liveRecording ? "off" : config.live.transcript ? "on, with transcript and Catch me up (" + config.catchUp.model + ")" : "on, no live transcript"}` +
    (config.webDir && fs.existsSync(path.join(config.webDir, "index.html")) ? `  web: ${config.webDir}` : "  (API only: no built front end found)"));
  pipeline.resume();
});

let closing = false;
const shutdown = () => {
  if (closing) return; closing = true;
  /* Runs in progress stop here and stay "processing"; they start again on the next start (pipeline.resume). */
  pipeline.stopAll(); live.stopAll();
  server.close(() => { store.close(); process.exit(0); });
  setTimeout(() => process.exit(0), 3000).unref();
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
