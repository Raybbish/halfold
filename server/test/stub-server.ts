/* A server for trying the front end without API keys: real ffmpeg and slide reading, stubbed speech-to-text and notes.
     npx tsx test/stub-server.ts [port] [fixtures-dir]     then open http://localhost:<port> and sign in with the code STUB
   Files in fixtures-dir are served at /__fixtures/<name>, so a browser test can fetch a recording to upload. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { loadConfig } from "../src/config";
import { Store } from "../src/db";
import { LocalFileStore } from "../src/files";
import { Ffmpeg } from "../src/media";
import { Pipeline } from "../src/pipeline";
import { createApp } from "../src/app";
import { StubNotes, StubStt } from "./helpers";

const port = Number(process.argv[2] || 8790);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sidenote-stub-"));
const config = loadConfig({ DATA_DIR: dir });
const store = new Store(path.join(dir, "sidenote.db"));
store.addInviteCode("STUB", "Tester");
const files = new LocalFileStore(dir), media = new Ffmpeg(), stt = new StubStt(), notes = new StubNotes();
const pipeline = new Pipeline({ config, store, files, media, stt, notes });
const fixtures = process.argv[3] ? path.resolve(process.argv[3]) : null;
const app = new Hono();
if (fixtures) app.get("/__fixtures/:name", c => {
  const f = path.join(fixtures, path.basename(c.req.param("name")));
  return fs.existsSync(f) ? c.body(fs.readFileSync(f), 200, { "Access-Control-Allow-Origin": "*" }) : c.notFound();   // other local servers may fetch them
});
app.route("/", createApp({ config, store, files, media, jobs: pipeline }));
serve({ fetch: app.fetch, port }, () => console.log(`stub server on http://localhost:${port} (data in ${dir}); invite code STUB`));
