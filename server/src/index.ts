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
const files = new LocalFileStore(config.dataDir);
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
const app = createApp({ config, store, files, media, jobs: pipeline, live, catchUp: new DeepSeekCatchUp(config.catchUp), packs, billing, mailer, links });

/* Recordings past their plan's keep date (plans.json audioDays) are deleted at start and every six hours. */
const sweep = () => sweepAudio({ config, store, files, billing }).then(n => { if (n) console.log(`[sidenote] deleted ${n} recording(s) past their plan's keep date`); }, e => console.error("[sidenote] sweep:", e));
if (config.plans.plans.some(p => p.audioDays !== null)) { void sweep(); setInterval(sweep, 6 * 3600_000).unref(); }

const missing = missingKeys(config);
if (missing.length) console.warn(`[sidenote] not set in server/.env: ${missing.join(", ")}. Notes cannot be written until they are.`);
if (!store.listUsers().length) console.warn("[sidenote] no invite codes yet: set INVITE_CODES in server/.env, or run npm run invite -- add <code>");
if (config.retired.length) console.warn(`[sidenote] ${config.retired.join(" and ")} in server/.env no longer do anything: each plan's limits are in plans.json.`);
if (config.signIn === "email" && mailer.provider === "console") console.warn("[sidenote] RESEND_API_KEY is not set: sign-in codes are printed here instead of emailed. Fine on your own computer; set it before anyone else uses this server.");
if (!ytdlp) console.warn(`[sidenote] yt-dlp was not found (YTDLP=${config.links.ytdlp}): video links are refused and students are asked to upload the file.`);
if (problem) console.warn("[sidenote] payments are off: " + problem);
else if (!payments) console.warn("[sidenote] STRIPE_SECRET_KEY is not set: plans are shown, but choosing one says checkout is not connected yet.");
else if (!config.stripe.webhookSecret) console.warn("[sidenote] STRIPE_WEBHOOK_SECRET is not set: payments are picked up when the student comes back from Stripe, but renewals and cancellations need the webhook.");

/* Node ends a request after 5 minutes by default, which cuts off a 500 MB upload on a slow connection. */
const server = serve({ fetch: app.fetch, port: config.port, hostname: config.host, serverOptions: { requestTimeout: 3 * 3600_000 } }, info => {
  console.log(`[sidenote] http://localhost:${info.port}  sign-in: ${config.signIn === "email" ? "email code (" + mailer.provider + ")" : "invite code"}  payments: ${payments ? "Stripe " + (config.stripe.secretKey.includes("_test_") ? "test mode" : "LIVE") : "off"}` +
    `  speech-to-text: ${stt.provider} ${stt.model}  notes: ${notes.provider} ${notes.model}` +
    `  links: ${ytdlp ? "yt-dlp " + ytdlp : "off"}` +
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
