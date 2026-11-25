/* Starts the server: `npm start` in server/ (settings in server/.env, see .env.example). */
import fs from "node:fs";
import path from "node:path";
import { serve } from "@hono/node-server";
import { loadConfig } from "./config";
import { Store } from "./db";
import { createFileStore } from "./files";
import { Ffmpeg } from "./media";
import { Pipeline } from "./pipeline";
import { createApp } from "./app";
import { createNotesWriter, createTranscriber, missingKeys } from "./providers";
import { LiveTranscriber } from "./live/transcriber";
import { DeepSeekCatchUp } from "./notes/catchup";
import { DeepSeekAsk } from "./notes/ask";
import { sweepAudio, sweepKept, sweepOriginals } from "./audio";
import { ReviewPacks } from "./packs";
import { Billing } from "./billing";
import { createMailer } from "./mail";
import { createPayments } from "./pay/stripe";
import { GuardProxy } from "./links/guard";
import { YtDlp, ytDlpVersion } from "./links/ytdlp";

const config = loadConfig();
fs.mkdirSync(config.dataDir, { recursive: true });
const store = new Store(path.join(config.dataDir, "sidenote.db"));
for (const code of config.inviteCodes) store.addInviteCode(code);
/* With R2 set, recordings move there once their notes are written (files.ts). */
const files = createFileStore(config, store);
const media = new Ffmpeg();
const stt = createTranscriber(config), notes = createNotesWriter(config);
/* Video links need yt-dlp; every download goes through the proxy that only reaches public addresses (links/guard.ts). */
const ytdlp = await ytDlpVersion(config.links.ytdlp);
const guard = ytdlp ? new GuardProxy() : null;
/* How the server names itself to sites that ask for it (ytdlp.ts, Wikimedia): only with a contact address to give. */
const identify = config.contactEmail ? `Halfold/1.0 (${[config.publicUrl, config.contactEmail].filter(Boolean).join("; ")})` : null;
const links = guard ? new YtDlp({ bin: config.links.ytdlp, proxy: await guard.listen(), timeoutMs: config.links.downloadMs, identify }) : null;
const pipeline = new Pipeline({ config, store, files, media, stt, notes, links });
const live = new LiveTranscriber({ config, store, files, media, stt });
const packs = new ReviewPacks({ config, store, notes });
const { payments, problem } = createPayments(config.stripe);
const billing = new Billing({ config, store, payments }), mailer = createMailer(config);
store.plansSince();   // the first start with plans: older recordings are kept as if made today
const app = createApp({ config, store, files, media, jobs: pipeline, live, catchUp: new DeepSeekCatchUp(config.catchUp), ask: new DeepSeekAsk(config.ask), packs, billing, mailer, links });

/* Recordings past their plan's keep date (plans.json audioDays) are deleted at start and every six hours. */
const sweep = () => sweepAudio({ config, store, files, billing }).then(n => { if (n) console.log(`[halfold] deleted ${n} recording(s) past their plan's keep date`); }, e => console.error("[halfold] sweep:", e));
if (config.plans.plans.some(p => p.audioDays !== null)) { void sweep(); setInterval(sweep, 6 * 3600_000).unref(); }
/* Original files of lectures with notes (only audio.m4a is kept), likewise at start and every six hours. */
const dropOriginals = () => sweepOriginals({ store, files }).then(n => { if (n) console.log(`[halfold] deleted the original file of ${n} lecture(s) with notes`); }, e => console.error("[halfold] originals:", e));
void dropOriginals(); setInterval(dropOriginals, 6 * 3600_000).unref();
/* With R2: kept files that could not be moved when their notes were written, and deletions R2 did not take, likewise. */
const keep = () => sweepKept({ store, files }).then(r => { if (r.moved || r.deleted) console.log(`[halfold] R2: moved ${r.moved} file(s) there, deleted ${r.deleted} left from before`); }, e => console.error("[halfold] R2 sweep:", e));
if (files.bucket) {
  files.check().catch(e => console.warn(`[halfold] R2 does not work with the R2_* settings in server/.env (${(e as Error).message}): recordings stay on this disk until it does.`));
  void keep(); setInterval(keep, 6 * 3600_000).unref();
}

const missing = missingKeys(config);
if (missing.length) console.warn(`[halfold] not set in server/.env: ${missing.join(", ")}. Notes cannot be written until they are.`);
if (!store.listUsers().length) console.warn("[halfold] no invite codes yet: set INVITE_CODES in server/.env, or run npm run invite -- add <code>");
if (config.retired.length) console.warn(`[halfold] ${config.retired.join(" and ")} in server/.env no longer do anything: each plan's limits are in plans.json.`);
if (config.signIn === "email" && mailer.provider === "console") console.warn("[halfold] RESEND_API_KEY is not set: sign-in codes are printed here instead of emailed. Fine on your own computer; set it before anyone else uses this server.");
if (!ytdlp) console.warn(`[halfold] yt-dlp was not found (YTDLP=${config.links.ytdlp}): video links are refused and students are asked to upload the file.`);
const inR2 = store.remoteTotals().files;
if (!files.bucket && inR2) console.warn(`[halfold] ${inR2} recording file(s) are in R2, but the R2 settings are not in server/.env: they cannot be played or deleted until they are.`);
if (problem) console.warn("[halfold] payments are off: " + problem);
else if (!payments) console.warn("[halfold] STRIPE_SECRET_KEY is not set: plans are shown, but choosing one says checkout is not connected yet.");
else if (!config.stripe.webhookSecret) console.warn("[halfold] STRIPE_WEBHOOK_SECRET is not set: payments are picked up when the student comes back from Stripe, but refunds, disputes and payments that arrive later (Alipay, WeChat Pay) need the webhook.");

/* Node ends a request after 5 minutes by default, which cuts off a 500 MB upload on a slow connection. */
const server = serve({ fetch: app.fetch, port: config.port, hostname: config.host, serverOptions: { requestTimeout: 3 * 3600_000 } }, info => {
  console.log(`[halfold] http://localhost:${info.port}  sign-in: ${config.signIn === "email" ? "email code (" + mailer.provider + ")" : "invite code"}  payments: ${payments ? "Stripe " + (config.stripe.secretKey.includes("_test_") ? "test mode" : "LIVE") : "off"}` +
    `  speech-to-text: ${stt.provider} ${stt.model}  notes: ${notes.provider} ${notes.model}` +
    `  links: ${ytdlp ? "yt-dlp " + ytdlp : "off"}  recordings: ${files.bucket || "this disk"}` +
    `  live: ${!config.liveRecording ? "off" : config.live.transcript ? "on, with transcript and Catch me up (" + config.catchUp.model + ")" : "on, no live transcript"}` +
    (config.webDir && fs.existsSync(path.join(config.webDir, "index.html")) ? `  web: ${config.webDir}` : "  (API only: no built front end found)"));
  pipeline.resume(); packs.resume();
});

let closing = false;
const shutdown = () => {
  if (closing) return; closing = true;
  /* Runs in progress stop here and stay "processing"; they start again on the next start (pipeline.resume, packs.resume). */
  pipeline.stopAll(); live.stopAll(); packs.stopAll(); void guard?.close();
  server.close(() => { store.close(); process.exit(0); });
  setTimeout(() => process.exit(0), 3000).unref();
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
