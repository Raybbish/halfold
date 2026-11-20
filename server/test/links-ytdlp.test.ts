/* Video links: downloading with yt-dlp, and the sentence a student gets when it fails. The real yt-dlp runs against a
   local server through GuardProxy (skipped when yt-dlp is not installed; nothing goes to the internet). */
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { GuardProxy } from "../src/links/guard";
import { classify, identifyTo, LinkError, STUDENT_MESSAGE, YtDlp, ytDlpVersion, type LinkFailure } from "../src/links/ytdlp";

test("failure reasons from what yt-dlp printed", () => {
  const cases: [string, LinkFailure][] = [
    ["ERROR: [youtube] abc: Sign in to confirm you’re not a bot. Use --cookies-from-browser or --cookies for the authentication.", "blocked"],
    ["ERROR: [youtube] abc: Unable to download API page: HTTP Error 429: Too Many Requests", "blocked"],
    /* A public YouTube video whose media server refuses the server's address: not a sign-in. */
    ["ERROR: unable to download video data: HTTP Error 403: Forbidden", "blocked"],
    ["ERROR: [youtube] abc: Private video. Sign in if you've been granted access to this video", "login"],
    ["ERROR: [youtube] abc: Sign in to confirm your age. This video may be inappropriate for some users.", "login"],
    ["ERROR: [youtube] abc: Join this channel to get access to members-only content like this video", "login"],
    ["ERROR: [generic] private: Unable to download webpage: HTTP Error 401: Unauthorized (caused by <HTTPError 401: Unauthorized>)", "login"],
    ["ERROR: [generic] x: Unable to download webpage: HTTP Error 403: Forbidden (caused by <HTTPError 403: Forbidden>)", "login"],
    ["ERROR: [Zoom] abc: This video is protected by a passcode, use the --video-password option", "login"],
    ["ERROR: [Panopto] abc: This session is only available to logged in users. Use --cookies or --username and --password", "login"],
    ["ERROR: [generic] a: Unable to download webpage: HTTP Error 403: Not A Public Address (caused by <HTTPError 403: Not A Public Address>)", "not-public"],
    ["ERROR: [generic] a: Unable to download webpage: ('Unable to connect to proxy', OSError('Tunnel connection failed: 403 Not A Public Address'))", "not-public"],
    ["ERROR: [generic] a: Unable to download webpage: ('Unable to connect to proxy', OSError('Tunnel connection failed: 502 Bad Gateway'))", "unreachable"],
    ["ERROR: [generic] a: Unable to download webpage: <urlopen error [Errno 61] Connection refused>", "unreachable"],
    ["ERROR: [generic] nothing: Unable to download webpage: HTTP Error 404: Not Found (caused by <HTTPError 404: Not Found>)", "no-media"],
    ["WARNING: [generic] Falling back on generic information extractor\nERROR: Unsupported URL: https://example.com/page", "no-media"],
    ["ERROR: [youtube] abc: Video unavailable. This video has been removed by the uploader", "no-media"],
    ["ERROR: [youtube] abc: Requested format is not available. Use --list-formats for a list of available formats", "no-media"],
    ["[download] Lecture 9 does not pass filter (!is_live & duration <? 18000), skipping ..", "too-long"],
    ["[download] File is larger than max-filesize (24494 bytes > 1024 bytes). Aborting.", "too-big"],
    ["ERROR: [youtube] abc: This live event will begin in 3 hours.", "live"],
    ["ERROR: [youtube] abc: Premieres in 2 days", "live"],
    ["ERROR: something nobody has seen before", "other"]
  ];
  for (const [out, kind] of cases) assert.equal(classify(out), kind, out);
  /* Every reason has a sentence for the student, and none of them is the raw error. */
  for (const kind of new Set(cases.map(c => c[1]))) assert.match(STUDENT_MESSAGE[kind], /^[A-Z].+\.$/, kind);
  assert.match(STUDENT_MESSAGE.timeout, /^[A-Z].+\.$/);
});

const have = await ytDlpVersion("yt-dlp");
const audio = Buffer.alloc(20000, 7);

/* A local site: a file, the same file without a length, a page with no video, 401, a file sent slowly, an endless one. */
async function site() {
  const server = http.createServer((req, res) => {
    if (req.url === "/a.mp3") { res.writeHead(200, { "Content-Type": "audio/mpeg", "Content-Length": audio.length }); return res.end(audio); }
    if (req.url === "/chunked.mp3") { res.writeHead(200, { "Content-Type": "audio/mpeg" }); return res.end(audio); }
    if (req.url === "/page.html") { res.writeHead(200, { "Content-Type": "text/html" }); return res.end("<html><body>No video here.</body></html>"); }
    if (req.url === "/private") { res.writeHead(401); return res.end(); }
    if (req.url === "/slow.mp3" || req.url === "/endless.mp3") {
      res.writeHead(200, { "Content-Type": "audio/mpeg" });
      const piece = Buffer.alloc(req.url === "/slow.mp3" ? 10 : 64 * 1024, 1);
      const timer = setInterval(() => res.write(piece), req.url === "/slow.mp3" ? 100 : 5);
      res.on("close", () => clearInterval(timer)); return;
    }
    res.writeHead(404); res.end();
  });
  await new Promise<void>(r => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as AddressInfo).port;
  return { server, url: (p: string) => `http://127.0.0.1:${port}${p}` };
}

async function bench(t: import("node:test").TestContext, guardOptions: ConstructorParameters<typeof GuardProxy>[0] = { allow: ip => ip === "127.0.0.1", ports: null }, timeoutMs = 60_000) {
  const s = await site(), guard = new GuardProxy(guardOptions), proxy = await guard.listen();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sidenote-ytdlp-"));
  t.after(async () => { await guard.close(); s.server.closeAllConnections(); s.server.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  let n = 0;
  /* A new empty folder for each download, as the pipeline gives (a file left from an earlier try would count as done). */
  return { url: s.url, get dir() { const d = path.join(dir, String(n++)); fs.mkdirSync(d); return d; }, ytdlp: new YtDlp({ bin: "yt-dlp", proxy, timeoutMs, checkEveryMs: 50 }) };
}
const failure = async (p: Promise<unknown>) => { try { await p; } catch (e) { if (e instanceof LinkError) return e.kind; throw e; } assert.fail("the download did not fail"); };

test("yt-dlp: downloads a file through the proxy into the folder", { skip: !have && "yt-dlp is not installed" }, async t => {
  const b = await bench(t);
  const dir = b.dir, file = await b.ytdlp.download(b.url("/a.mp3"), dir, { maxBytes: 1 << 20 });
  assert.equal(path.dirname(file), dir);
  assert.deepEqual(fs.readFileSync(file), audio);
});

test("yt-dlp: too big, with a length up front, without one, and an endless stream", { skip: !have && "yt-dlp is not installed" }, async t => {
  const b = await bench(t);
  assert.equal(await failure(b.ytdlp.download(b.url("/a.mp3"), b.dir, { maxBytes: 1000 })), "too-big");
  assert.equal(await failure(b.ytdlp.download(b.url("/chunked.mp3"), b.dir, { maxBytes: 1000 })), "too-big");
  const started = Date.now();
  assert.equal(await failure(b.ytdlp.download(b.url("/endless.mp3"), b.dir, { maxBytes: 2 << 20 })), "too-big");
  assert.ok(Date.now() - started < 20_000, "stopped soon after passing the limit");
});

test("yt-dlp: the proxy refuses the server's own address; sign-in, no video, nothing there", { skip: !have && "yt-dlp is not installed" }, async t => {
  const strict = await bench(t, {});   // the real guard: 127.0.0.1 is not public, and only ports 80 and 443
  assert.equal(await failure(strict.ytdlp.download(strict.url("/a.mp3"), strict.dir, { maxBytes: 1 << 20 })), "not-public");
  const b = await bench(t);
  assert.equal(await failure(b.ytdlp.download(b.url("/private"), b.dir, { maxBytes: 1 << 20 })), "login");
  assert.equal(await failure(b.ytdlp.download(b.url("/page.html"), b.dir, { maxBytes: 1 << 20 })), "no-media");
  assert.equal(await failure(b.ytdlp.download(b.url("/missing.mp3"), b.dir, { maxBytes: 1 << 20 })), "no-media");
});

test("yt-dlp: stops at the time limit, and at once when the lecture is deleted", { skip: !have && "yt-dlp is not installed" }, async t => {
  const slow = await bench(t, undefined, 1500);
  assert.equal(await failure(slow.ytdlp.download(slow.url("/slow.mp3"), slow.dir, { maxBytes: 1 << 20 })), "timeout");
  const b = await bench(t);
  const ctl = new AbortController(), started = Date.now();
  setTimeout(() => ctl.abort(), 800);
  await assert.rejects(b.ytdlp.download(b.url("/slow.mp3"), b.dir, { maxBytes: 1 << 20, signal: ctl.signal }), (e: Error) => !(e instanceof LinkError));
  assert.ok(Date.now() - started < 5000, "stopped right after the abort");
});

/* A stand-in for yt-dlp: records its arguments and the proxy settings in its environment, then "downloads" a file. */
function fakeYtDlp(body: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sidenote-fake-ytdlp-")), bin = path.join(dir, "yt-dlp");
  fs.writeFileSync(bin, body, { mode: 0o755 });
  return { dir, bin };
}
const RECORDER = `#!/usr/bin/env node
const fs = require("fs"), path = require("path"), a = process.argv.slice(2), out = path.dirname(a[a.indexOf("-o") + 1]);
const env = {}; for (const k of ["no_proxy", "NO_PROXY", "http_proxy", "HTTP_PROXY", "https_proxy", "HTTPS_PROXY", "all_proxy", "ALL_PROXY"]) if (k in process.env) env[k] = process.env[k];
fs.writeFileSync(path.join(out, "seen.json"), JSON.stringify({ args: a, env }));
fs.writeFileSync(path.join(out, "media.mp3"), "audio");
`;

test("the server names itself to Wikimedia (it refuses clients that do not), and to no other site", async t => {
  const fake = fakeYtDlp(RECORDER); t.after(() => fs.rmSync(fake.dir, { recursive: true, force: true }));
  const ua = "Halfold/1.0 (https://halfold.app; support@halfold.app)";
  const argsFor = async (url: string, identify: string | null) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sidenote-ytdlp-out-")); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    await new YtDlp({ bin: fake.bin, proxy: "http://127.0.0.1:9", timeoutMs: 10_000, identify }).download(url, dir, { maxBytes: 1 << 20 });
    return (JSON.parse(fs.readFileSync(path.join(dir, "seen.json"), "utf8")) as { args: string[] }).args;
  };
  const wiki = await argsFor("https://upload.wikimedia.org/wikipedia/commons/9/9a/Velocity_of_money.ogg", ua);
  assert.equal(wiki[wiki.indexOf("--user-agent") + 1], ua);
  assert.ok((await argsFor("https://en.wikipedia.org/wiki/File:Example.ogg", ua)).includes("--user-agent"));
  assert.ok(!(await argsFor("https://www.youtube.com/watch?v=abc", ua)).includes("--user-agent"), "YouTube keeps yt-dlp's own headers");
  assert.ok(!(await argsFor("https://notwikimedia.org.example.com/a.ogg", ua)).includes("--user-agent"));
  assert.ok(!(await argsFor("https://upload.wikimedia.org/a.ogg", null)).includes("--user-agent"), "without a contact address, nothing is sent");
  assert.deepEqual([identifyTo("https://commons.wikimedia.org/wiki/File:A.ogg"), identifyTo("https://wikimedia.org.evil.example/a"), identifyTo("not a url")], [true, false, false]);
});

test("yt-dlp is run without ffmpeg, outside the server's proxy settings, for the first video only, at most 480p", async t => {
  const fake = fakeYtDlp(RECORDER), dir = fs.mkdtempSync(path.join(os.tmpdir(), "sidenote-ytdlp-out-"));
  const saved = { ...process.env };
  Object.assign(process.env, { no_proxy: "*", NO_PROXY: "*", http_proxy: "http://elsewhere:1", HTTPS_PROXY: "http://elsewhere:1", ALL_PROXY: "socks5://elsewhere:1" });
  t.after(() => { process.env = saved; fs.rmSync(fake.dir, { recursive: true, force: true }); fs.rmSync(dir, { recursive: true, force: true }); });
  const file = await new YtDlp({ bin: fake.bin, proxy: "http://127.0.0.1:9", timeoutMs: 10_000 }).download("https://www.youtube.com/playlist?list=PL1", dir, { maxBytes: 1 << 20 });
  assert.equal(path.basename(file), "media.mp3");
  const seen = JSON.parse(fs.readFileSync(path.join(dir, "seen.json"), "utf8")) as { args: string[]; env: Record<string, string> };
  const after = (flag: string) => seen.args[seen.args.indexOf(flag) + 1];
  assert.deepEqual(seen.env, {}, "no proxy settings reach yt-dlp or anything it starts");
  assert.equal(after("--proxy"), "http://127.0.0.1:9");
  assert.equal(after("--playlist-items"), "1");
  assert.equal(after("-S"), "res:480");
  assert.equal(after("--fixup"), "never");
  assert.equal(after("--downloader"), "native");
  assert.ok(seen.args.includes("--ffmpeg-location") && !fs.existsSync(after("--ffmpeg-location")), "points yt-dlp at an ffmpeg that does not exist");
  assert.match(after("-f"), /protocol/, "only formats yt-dlp itself downloads over http(s)");
  assert.deepEqual(seen.args.slice(-2), ["--", "https://www.youtube.com/playlist?list=PL1"]);
});

test("a stop ends the download even when yt-dlp left a process holding its output", async t => {
  const fake = fakeYtDlp("#!/bin/sh\nsleep 30 &\nsleep 30\n"), dir = fs.mkdtempSync(path.join(os.tmpdir(), "sidenote-ytdlp-out-"));
  t.after(() => { fs.rmSync(fake.dir, { recursive: true, force: true }); fs.rmSync(dir, { recursive: true, force: true }); });
  const ctl = new AbortController(), started = Date.now();
  setTimeout(() => ctl.abort(), 300);
  await assert.rejects(new YtDlp({ bin: fake.bin, proxy: "http://127.0.0.1:9", timeoutMs: 60_000 }).download("https://example.com/a.mp4", dir, { maxBytes: 1 << 20, signal: ctl.signal }));
  assert.ok(Date.now() - started < 5000, "settled soon after the stop");
  const left = execFileSync("ps", ["-A", "-o", "command="], { encoding: "utf8" }).split("\n").filter(l => l.includes(fake.dir));
  assert.deepEqual(left, [], "nothing it started is still running");
});

test("yt-dlp: an encrypted playlist is not handed to ffmpeg (which would not use the proxy or stop)", { skip: !have && "yt-dlp is not installed", timeout: 40_000 }, async t => {
  const agents: string[] = [];
  const server = http.createServer((req, res) => {
    agents.push(String(req.headers["user-agent"] || ""));
    if (req.url === "/enc.m3u8") {
      res.writeHead(200, { "Content-Type": "application/vnd.apple.mpegurl" });
      return res.end(`#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:10\n#EXT-X-MEDIA-SEQUENCE:0\n#EXT-X-KEY:METHOD=SAMPLE-AES,URI="/key",KEYFORMAT="identity"\n#EXTINF:10,\n/seg.ts\n#EXT-X-ENDLIST\n`);
    }
    if (req.url === "/seg.ts") { res.writeHead(200, { "Content-Type": "video/mp2t" }); const timer = setInterval(() => res.write(Buffer.alloc(188, 0x47)), 50); res.on("close", () => clearInterval(timer)); return; }
    if (req.url === "/key") return res.end(Buffer.alloc(16));
    res.writeHead(404); res.end();
  });
  await new Promise<void>(r => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as AddressInfo).port, guard = new GuardProxy({ allow: ip => ip === "127.0.0.1", ports: null }), proxy = await guard.listen();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sidenote-ytdlp-"));
  t.after(async () => { await guard.close(); server.closeAllConnections(); server.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  const started = Date.now();
  await assert.rejects(new YtDlp({ bin: "yt-dlp", proxy, timeoutMs: 30_000, checkEveryMs: 50 }).download(`http://127.0.0.1:${port}/enc.m3u8`, dir, { maxBytes: 1 << 20 }), LinkError);
  assert.ok(Date.now() - started < 15_000, "failed instead of downloading for the whole time limit");
  assert.deepEqual(agents.filter(a => /Lavf/i.test(a)), [], "ffmpeg never fetched anything");
});

test("yt-dlp: the server's no_proxy setting does not let a download skip the proxy", { skip: !have && "yt-dlp is not installed" }, async t => {
  const saved = { ...process.env };
  Object.assign(process.env, { no_proxy: "127.0.0.1,localhost,::1", NO_PROXY: "127.0.0.1,localhost,::1" });
  t.after(() => { process.env = saved; });
  const b = await bench(t, { ports: null });   // the real address check, any port
  assert.equal(await failure(b.ytdlp.download(b.url("/a.mp3"), b.dir, { maxBytes: 1 << 20 })), "not-public");
});
