/* Settings, read once from the environment (server/.env, see .env.example). Every value has a default except the API keys. */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadPlans, type PlanBook } from "./plans";

const here = path.dirname(fileURLToPath(import.meta.url));
export const SERVER_DIR = path.resolve(here, "..");

export type SttProviderName = "elevenlabs" | "deepgram";
/* email: a code sent to the student's address, and an invite code the first time (phase 4). invite: the invite code alone (phases 1 to 3). */
export type SignInMode = "email" | "invite";
export type ClassLanguage = "en" | "en-yue" | "en-zh" | "auto";
export const CLASS_LANGUAGES: ClassLanguage[] = ["en", "en-yue", "en-zh", "auto"];

/* DeepSeek list prices in US dollars per million tokens at peak time; off-peak is half (api-docs.deepseek.com/quick_start/pricing, 2026-11). */
export interface TokenPrices { inputCacheHit: number; inputCacheMiss: number; output: number }
const DEEPSEEK_PRICES: Record<string, TokenPrices> = {
  "deepseek-v4-pro": { inputCacheHit: 0.044, inputCacheMiss: 1.32, output: 3.96 },
  "deepseek-flash": { inputCacheHit: 0.006, inputCacheMiss: 0.3, output: 1.2 }
};

export interface DeepSeekSettings { apiKey: string; baseUrl: string; model: string; reasoningEffort: string; maxTokens: number; prices: TokenPrices }

export interface Config {
  port: number;
  publicUrl: string;                  // where students reach the server, e.g. https://sidenote.example.com; empty = links relative to the page
  webUrl: string;                     // where the front end is, for shared links (#/s/:id); empty = the page that asked
  exampleShareId: string | null;      // the shared lecture behind "Example notes" on the public pages; null hides those links
  dataDir: string;
  webDir: string | null;              // the built front end to serve at "/", or null to serve only the API
  timezone: string;                   // the students' time zone: "today", lecture dates, exam dates
  maxUploadBytes: number;
  liveRecording: boolean;             // record and tab lectures can be created
  live: {
    transcript: boolean;              // transcribe while recording: the live transcript, its alerts and Catch me up
    maxChunkBytes: number;            // one piece of a live recording
    replyWaitMs: number;              // how long a chunk reply waits for the transcription the chunk started
    concurrency: number;              // live transcription rounds running at once, all lectures together
  };
  audioLinkHours: number;             // how long a playback link works
  inviteCodes: string[];
  signIn: SignInMode;
  login: {
    codeMinutes: number;              // how long an emailed code works
    codesPerHour: number;             // codes sent in an hour, all addresses together (a guard on the mail quota)
    emailDomains: string[];           // only addresses ending in one of these may sign in; empty = any address
    sessionDays: number;              // a sign-in ends after this many days without using Sidenote
  };
  mail: { resendKey: string; from: string; apiBase: string };
  stripe: { secretKey: string; webhookSecret: string; apiBase: string; allowLive: boolean };
  plans: PlanBook;                    // plans.json: what each plan allows and costs; the daily live limit and how long recordings are kept
  retired: string[];                  // settings in the environment that plans.json replaced (a warning at start)
  pipelineConcurrency: number;
  links: { ytdlp: string; downloadMs: number; concurrency: number };   // video links: the yt-dlp program, how long one download may take, downloads at once
  zhExplanations: boolean;
  stt: {
    provider: SttProviderName;
    elevenlabs: { apiKey: string; model: string; usdPerHour: number };
    deepgram: { apiKey: string; model: string; languages: Record<ClassLanguage, string>; usdPerHourMono: number; usdPerHourMulti: number };
  };
  notes: {
    provider: "deepseek";
    deepseek: DeepSeekSettings;
  };
  catchUp: DeepSeekSettings;          // "Catch me up": a small, fast model without thinking
}

function num(v: string | undefined, d: number) { const n = Number(v); return v !== undefined && v.trim() !== "" && Number.isFinite(n) ? n : d; }
function onOff(v: string | undefined, d: boolean) { if (v === undefined || v.trim() === "") return d; return /^(1|on|true|yes)$/i.test(v.trim()); }
function list(v: string | undefined) { return (v || "").split(",").map(s => s.trim()).filter(Boolean); }

/* "en:en,en-yue:zh-HK" -> map, falling back to the defaults for languages not listed. */
function languageMap(v: string | undefined, d: Record<ClassLanguage, string>): Record<ClassLanguage, string> {
  const out = { ...d };
  for (const pair of list(v)) { const [k, val] = pair.split(":").map(s => s.trim()); if ((CLASS_LANGUAGES as string[]).includes(k) && val) out[k as ClassLanguage] = val; }
  return out;
}

function prices(env: NodeJS.ProcessEnv, prefix: string, model: string): TokenPrices {
  const base = DEEPSEEK_PRICES[model] || DEEPSEEK_PRICES["deepseek-v4-pro"];
  return {
    inputCacheHit: num(env[prefix + "_USD_PER_M_INPUT_CACHE_HIT"], base.inputCacheHit),
    inputCacheMiss: num(env[prefix + "_USD_PER_M_INPUT"], base.inputCacheMiss),
    output: num(env[prefix + "_USD_PER_M_OUTPUT"], base.output)
  };
}

function signInMode(v: string | undefined): SignInMode {
  const m = (v || "email").trim().toLowerCase();
  if (m !== "email" && m !== "invite") throw new Error(`SIGN_IN must be email or invite, not "${v}"`);
  return m;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const deepseekModel = env.DEEPSEEK_MODEL || "deepseek-v4-pro", catchUpModel = env.CATCHUP_MODEL || "deepseek-flash";
  const deepseekKey = env.DEEPSEEK_API_KEY || "", deepseekBase = (env.DEEPSEEK_BASE_URL || "https://api.deepseek.com").replace(/\/+$/, "");
  const web = env.WEB_DIR === undefined ? path.resolve(SERVER_DIR, "../dist") : env.WEB_DIR.trim() ? path.resolve(SERVER_DIR, env.WEB_DIR) : null;
  const provider = (env.STT_PROVIDER || "elevenlabs").trim();
  if (provider !== "elevenlabs" && provider !== "deepgram") throw new Error(`STT_PROVIDER must be elevenlabs or deepgram, not "${provider}"`);
  return {
    port: num(env.PORT, 8787),
    publicUrl: (env.PUBLIC_URL || "").trim().replace(/\/+$/, ""),
    webUrl: (env.WEB_URL || "").trim().replace(/\/+$/, ""),
    exampleShareId: /^[A-Za-z0-9_-]+$/.test((env.EXAMPLE_SHARE_ID || "").trim()) ? env.EXAMPLE_SHARE_ID!.trim() : null,
    dataDir: path.resolve(SERVER_DIR, env.DATA_DIR || "data"),
    webDir: web,
    timezone: env.APP_TIMEZONE || "Asia/Hong_Kong",
    maxUploadBytes: num(env.MAX_UPLOAD_MB, 500) * 1048576,
    liveRecording: onOff(env.LIVE_RECORDING, true),
    live: {
      transcript: onOff(env.LIVE_TRANSCRIPT, true),
      maxChunkBytes: num(env.MAX_CHUNK_MB, 10) * 1048576,
      replyWaitMs: Math.max(0, num(env.LIVE_REPLY_WAIT_MS, 8000)),
      concurrency: Math.max(1, num(env.LIVE_CONCURRENCY, 4))
    },
    audioLinkHours: Math.max(1, num(env.AUDIO_LINK_HOURS, 12)),
    inviteCodes: list(env.INVITE_CODES),
    signIn: signInMode(env.SIGN_IN),
    login: {
      codeMinutes: Math.max(1, num(env.LOGIN_CODE_MINUTES, 10)),
      codesPerHour: Math.max(1, num(env.LOGIN_CODES_PER_HOUR, 300)),
      emailDomains: list(env.EMAIL_DOMAINS).map(d => d.toLowerCase().replace(/^@/, "")),
      sessionDays: Math.max(1, num(env.SESSION_DAYS, 90))
    },
    mail: { resendKey: (env.RESEND_API_KEY || "").trim(), from: (env.MAIL_FROM || "Halfold <onboarding@resend.dev>").trim(), apiBase: (env.RESEND_API_BASE || "https://api.resend.com").replace(/\/+$/, "") },
    stripe: {
      secretKey: (env.STRIPE_SECRET_KEY || "").trim(), webhookSecret: (env.STRIPE_WEBHOOK_SECRET || "").trim(),
      apiBase: (env.STRIPE_API_BASE || "https://api.stripe.com").replace(/\/+$/, ""), allowLive: onOff(env.STRIPE_ALLOW_LIVE, false)
    },
    plans: loadPlans(env.PLANS_FILE ? path.resolve(SERVER_DIR, env.PLANS_FILE) : path.join(SERVER_DIR, "plans.json")),
    retired: ["DAILY_LIVE_MINUTES", "AUDIO_KEEP_DAYS"].filter(k => (env[k] || "").trim() !== ""),
    pipelineConcurrency: Math.max(1, num(env.PIPELINE_CONCURRENCY, 2)),
    links: {
      ytdlp: (env.YTDLP || "").trim() || "yt-dlp", downloadMs: Math.max(1, num(env.LINK_DOWNLOAD_MINUTES, 30)) * 60_000,
      concurrency: Math.max(1, num(env.LINK_CONCURRENCY, 2))
    },
    zhExplanations: onOff(env.ZH_EXPLANATIONS, true),
    stt: {
      provider,
      elevenlabs: { apiKey: env.ELEVENLABS_API_KEY || "", model: env.ELEVENLABS_MODEL || "scribe_v3", usdPerHour: num(env.ELEVENLABS_USD_PER_HOUR, 0.2) },
      deepgram: {
        apiKey: env.DEEPGRAM_API_KEY || "", model: env.DEEPGRAM_MODEL || "nova-3",
        languages: languageMap(env.DEEPGRAM_LANGUAGES, { en: "en", "en-yue": "zh-HK", "en-zh": "multi", auto: "multi" }),
        usdPerHourMono: num(env.DEEPGRAM_USD_PER_HOUR, 0.258), usdPerHourMulti: num(env.DEEPGRAM_USD_PER_HOUR_MULTI, 0.312)
      }
    },
    notes: {
      provider: "deepseek",
      deepseek: {
        apiKey: deepseekKey, baseUrl: deepseekBase,
        model: deepseekModel, reasoningEffort: env.DEEPSEEK_REASONING_EFFORT || "high", maxTokens: num(env.DEEPSEEK_MAX_TOKENS, 131072),
        prices: prices(env, "DEEPSEEK", deepseekModel)
      }
    },
    catchUp: {
      apiKey: deepseekKey, baseUrl: deepseekBase, model: catchUpModel, reasoningEffort: env.CATCHUP_REASONING_EFFORT || "none",
      maxTokens: num(env.CATCHUP_MAX_TOKENS, 2000), prices: prices(env, "CATCHUP", catchUpModel)
    }
  };
}
