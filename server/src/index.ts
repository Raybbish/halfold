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

const config = loadConfig();
fs.mkdirSync(config.dataDir, { recursive: true });
const store = new Store(path.join(config.dataDir, "sidenote.db"));
for (const code of config.inviteCodes) store.addInviteCode(code);
const files = new LocalFileStore(config.dataDir);
const media = new Ffmpeg();
const stt = createTranscriber(config), notes = createNotesWriter(config);
const pipeline = new Pipeline({ config, store, files, media, stt, notes });
const app = createApp({ config, store, files, media, jobs: pipeline });

const missing = missingKeys(config);
if (missing.length) console.warn(`[sidenote] not set in server/.env: ${missing.join(", ")}. Notes cannot be written until they are.`);
if (!store.listUsers().length) console.warn("[sidenote] no invite codes yet: set INVITE_CODES in server/.env, or run npm run invite -- add <code>");

const server = serve({ fetch: app.fetch, port: config.port }, info => {
  console.log(`[sidenote] http://localhost:${info.port}  speech-to-text: ${stt.provider} ${stt.model}  notes: ${notes.provider} ${notes.model}` +
    (config.webDir && fs.existsSync(path.join(config.webDir, "index.html")) ? `  web: ${config.webDir}` : "  (API only: no built front end found)"));
  pipeline.resume();
});

let closing = false;
const shutdown = () => {
  if (closing) return; closing = true;
  /* Runs in progress stop here and stay "processing"; they start again on the next start (pipeline.resume). */
  pipeline.stopAll();
  server.close(() => { store.close(); process.exit(0); });
  setTimeout(() => process.exit(0), 3000).unref();
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
