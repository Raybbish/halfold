/* Video links (DESIGN.md, 视频链接): yt-dlp downloads what is behind a public link (YouTube, Google Drive, Vimeo, Zoom
   and Panopto share pages, a plain .mp4 or .m3u8, ...). All of its traffic goes through GuardProxy (guard.ts). It runs
   in the pipeline, not in the request that sent the link: a download takes minutes. When it fails, the student gets a
   sentence that says why and what to do instead (STUDENT_MESSAGE); the raw output stays in the server's log. */
import { execFile, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export type LinkFailure = "login" | "blocked" | "too-long" | "too-big" | "live" | "not-public" | "no-media" | "unreachable" | "timeout" | "other";

export class LinkError extends Error {
  constructor(readonly kind: LinkFailure, detail: string) { super(`${kind}: ${detail}`); }
}

const UPLOAD_INSTEAD = "download the video and upload the file";
export const STUDENT_MESSAGE: Record<LinkFailure, string> = {
  login: `This video needs a sign-in or permission to watch, so it could not be downloaded. Record it with Record an online class while it plays, or ${UPLOAD_INSTEAD}.`,
  blocked: `The video site refused the download for now. Try again later, or ${UPLOAD_INSTEAD}.`,
  "too-long": "Only recorded lectures up to 5 hours long can be used. This video is longer, or it is a live stream.",
  "too-big": "This video is larger than the upload limit. Download just the audio, or the part you need, and upload it.",
  live: "This live stream has not ended yet. Paste the link again once the recording is up.",
  "not-public": "This link leads somewhere that cannot be opened from here, such as a private network. Only public web links work.",
  "no-media": `No video or audio was found at this link. Check that it opens the video in a browser, or ${UPLOAD_INSTEAD}.`,
  unreachable: "The website could not be reached. Check the link and try again.",
  timeout: `The video took too long to download. Try again later, or ${UPLOAD_INSTEAD}.`,
  other: `The video could not be downloaded from this link. Try again later, or ${UPLOAD_INSTEAD}.`
};

/* The reason, from everything yt-dlp printed. The order matters: YouTube's bot check also says "Sign in", and the
   proxy's refusals are 403s that a site could also send. */
const REASONS: [RegExp, LinkFailure][] = [
  [/does not pass filter/i, "too-long"],
  [/larger than max-filesize/i, "too-big"],
  [/not a public address|port not allowed/i, "not-public"],
  [/not a bot|HTTP Error 429|too many requests|unable to download video data: HTTP Error 403/i, "blocked"],
  [/live event will begin|premieres in/i, "live"],
  [/private video|sign in|members-only|logged in|log in|login|--cookies|--username|password|passcode|HTTP Error 40[13]\b/i, "login"],
  [/HTTP Error 40[46]\b|HTTP Error 410\b|unsupported url|video unavailable|requested format is not available|no video formats/i, "no-media"],
  [/unable to connect|tunnel connection failed|connection refused|connection reset|timed out|getaddrinfo|name or service not known|nodename nor servname|network is unreachable|HTTP Error 5\d\d/i, "unreachable"]
];
export function classify(output: string): LinkFailure {
  for (const [re, kind] of REASONS) if (re.test(output)) return kind;
  return "other";
}

export interface LinkDownloader {
  /* Downloads the audio (or the whole video when there is no audio-only version) behind `url` into the empty folder
     `dir` and returns the file's path. Fails with LinkError; with the signal's reason when aborted. */
  download(url: string, dir: string, o: { maxBytes: number; signal?: AbortSignal }): Promise<string>;
}

/* "2026.08.19", or null when yt-dlp cannot be run. */
export function ytDlpVersion(bin: string): Promise<string | null> {
  return new Promise(ok => execFile(bin, ["--version"], { timeout: 15_000 }, (e, out) => ok(e ? null : out.trim() || null)));
}

const MAX_SECONDS = 5 * 3600;
/* Only formats yt-dlp itself downloads over HTTP(S): rtmp, rtsp and mms would start other programs, outside the proxy. */
const OVER_HTTP = "[protocol~='^(https?|m3u8(_native)?|http_dash_segments)$']";
/* The server's own proxy settings are not passed on: anything that honoured no_proxy could skip GuardProxy. */
const childEnv = () => Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(no|http|https|all|ftp)_proxy$/i.test(k)));
const KEEP_OUTPUT = 64 * 1024;
const unfinished = (f: string) => /\.(part|ytdl|temp|tmp)$/.test(f) || /\.part-Frag/.test(f);
function bytesIn(dir: string) {
  let n = 0;
  for (const f of fs.readdirSync(dir)) { try { n += fs.statSync(path.join(dir, f)).size; } catch { /* just renamed */ } }
  return n;
}

/* Wikimedia's sites refuse clients that do not say who they are (meta.wikimedia.org/wiki/User-Agent_policy): a direct
   link to an audio file on upload.wikimedia.org got HTTP 429 on its first request in the test of 2026-11-18. To them the
   server names itself and a way to reach its operator (identify: "Halfold/1.0 (https://halfold.app; support@...)").
   Other sites keep yt-dlp's own headers, which some of them (YouTube) depend on. */
const NAMES_ITSELF_TO = /(^|\.)(wikimedia|wikipedia)\.org$/i;
export function identifyTo(url: string) { try { return NAMES_ITSELF_TO.test(new URL(url).hostname); } catch { return false; } }

export class YtDlp implements LinkDownloader {
  constructor(private readonly o: { bin: string; proxy: string; timeoutMs: number; checkEveryMs?: number; identify?: string | null }) {}

  download(url: string, dir: string, o: { maxBytes: number; signal?: AbortSignal }): Promise<string> {
    const { signal, maxBytes } = o;
    if (signal?.aborted) return Promise.reject(signal.reason);
    const args = [
      "--ignore-config", "--no-playlist", "--no-progress", "--newline", "--no-mtime", "--no-cache-dir",
      /* The first video of a playlist link; audio only when there is such a version, else video no sharper than 480p
         (a 2-hour lecture in 1080p would pass the upload limit). */
      "--playlist-items", "1", "-f", `bestaudio${OVER_HTTP}/best${OVER_HTTP}`, "-S", "res:480",
      "--match-filter", `!is_live & duration <? ${MAX_SECONDS}`, "--max-filesize", String(maxBytes),
      /* yt-dlp's own downloader for every protocol, and no ffmpeg at all: yt-dlp hands some playlists (encrypted ones)
         to ffmpeg, which does not use --proxy and is not stopped with yt-dlp. */
      "--downloader", "native", "--ffmpeg-location", path.join(dir, ".no-ffmpeg"), "--fixup", "never",
      "--socket-timeout", "30", "--proxy", this.o.proxy,
      ...(this.o.identify && identifyTo(url) ? ["--user-agent", this.o.identify] : []),
      "-o", path.join(dir, "media.%(ext)s"), "--", url
    ];
    return new Promise((resolve, reject) => {
      /* In a process group of its own, so that stopping it also stops anything it started (a one-file build of yt-dlp
         runs as two processes). */
      const child = spawn(this.o.bin, args, { stdio: ["ignore", "pipe", "pipe"], detached: true, env: childEnv() });
      let output = "", stopped: LinkFailure | "abort" | null = null;
      const keep = (d: Buffer) => { output = (output + d.toString("utf8")).slice(-KEEP_OUTPUT); };
      child.stdout.on("data", keep); child.stderr.on("data", keep);
      const killAll = () => { try { process.kill(-child.pid!, "SIGKILL"); } catch { /* already gone */ } };
      const stop = (why: LinkFailure | "abort") => { if (!stopped) { stopped = why; killAll(); } };
      const timer = setTimeout(() => stop("timeout"), this.o.timeoutMs);
      /* --max-filesize only works when the size is known before the download starts. */
      const watch = setInterval(() => { if (bytesIn(dir) > maxBytes) stop("too-big"); }, this.o.checkEveryMs ?? 2000);
      const onAbort = () => stop("abort");
      signal?.addEventListener("abort", onAbort, { once: true });
      const done = () => { clearTimeout(timer); clearInterval(watch); signal?.removeEventListener("abort", onAbort); };
      const tail = () => output.trim().split("\n").filter(l => /^(ERROR|WARNING)|does not pass|max-filesize/.test(l)).slice(-5).join(" | ") || output.trim().slice(-500);
      child.on("error", e => { done(); reject(new LinkError("other", `yt-dlp could not be started: ${e.message}`)); });
      /* Whatever it left running would keep its output open, and "close" would never come. */
      child.on("exit", () => { killAll(); if (stopped) { child.stdout.destroy(); child.stderr.destroy(); } });
      let settled = false;
      child.on("close", code => {
        if (settled) return; settled = true;
        done();
        if (stopped === "abort") return reject(signal!.reason);
        if (stopped) return reject(new LinkError(stopped, tail()));
        const got = fs.readdirSync(dir).filter(f => f.startsWith("media.") && !unfinished(f));
        if (code === 0 && got.length) {
          const file = path.join(dir, got[0]);
          if (fs.statSync(file).size > maxBytes) return reject(new LinkError("too-big", "the file passed the limit"));
          return resolve(file);
        }
        reject(new LinkError(classify(output), tail() || `yt-dlp ended with ${code} and no file`));
      });
    });
  }
}
