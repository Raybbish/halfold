/* Recordings in Cloudflare R2 (files.ts R2FileStore, r2.ts), against a local fake of R2's S3 API that checks every
   signature, the signed SHA-256 of each upload and the expiry of presigned links, as R2 does. The signing itself is
   checked against AWS's published examples. Without the R2 settings nothing changes: every other test runs that way. */
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { AddressInfo } from "node:net";
import { presign, signedHeaders, R2, type Credentials } from "../src/r2";
import { loadConfig } from "../src/config";
import { Store } from "../src/db";
import { sweepAudio, sweepKept } from "../src/audio";
import { DetailSchema } from "../src/shapes";
import { chunkForm, fakeChunk, fileForm, liveLecture, readyLecture, setup, uploadedLecture, FAKE_AUDIO, type TestServer } from "./helpers";

const SERVER_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BUCKET = "halfold-test";
const CREDS: Credentials = { accessKeyId: "test-key-id", secretAccessKey: "test-secret", region: "auto" };
const md5 = (b: Buffer | string) => createHash("md5").update(b).digest("hex");
const sha256 = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");
const fromAmzDate = (s: string) => new Date(`${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T${s.slice(9, 11)}:${s.slice(11, 13)}:${s.slice(13, 15)}Z`);

interface Seen { method: string; key: string; url: string; headers: http.IncomingHttpHeaders; body: Buffer }
/* R2's S3 API as far as Halfold uses it: PUT, HEAD and DELETE signed in headers, GET and HEAD by presigned link.
   fail(req) → an HTTP status to fail that request with; lie(key) → what HEAD says instead of the truth; gate → PUTs
   wait for it. */
async function fakeR2() {
  const objects = new Map<string, { body: Buffer; type: string }>(), seen: Seen[] = [];
  const f = {
    objects, seen, url: "",
    fail: null as ((s: Seen) => number | null) | null,
    lie: null as ((key: string) => { size?: number; etag?: string } | null) | null,
    gate: null as Promise<void> | null,
    close: () => new Promise(r => server.close(r)),
    keys: () => [...objects.keys()].sort()
  };
  const xml = (res: http.ServerResponse, status: number, code: string) => { res.writeHead(status, { "Content-Type": "application/xml" }); res.end(`<?xml version="1.0"?><Error><Code>${code}</Code><Message>fake ${code}</Message></Error>`); };
  const server = http.createServer((req, res) => {
    const parts: Buffer[] = [];
    req.on("data", d => parts.push(d));
    req.on("end", async () => {
      const url = new URL(req.url!, f.url), [, bucket, ...rest] = url.pathname.split("/"), key = rest.map(decodeURIComponent).join("/");
      const s: Seen = { method: req.method!, key, url: url.toString(), headers: req.headers, body: Buffer.concat(parts) };
      seen.push(s);
      const failWith = f.fail?.(s);
      if (failWith) return xml(res, failWith, "InternalError");
      if (bucket !== BUCKET) return xml(res, 404, "NoSuchBucket");
      const sig = url.searchParams.get("X-Amz-Signature");
      if (sig) {
        /* A presigned link: its signature, then its expiry. */
        const base = new URL(url);
        for (const k of [...base.searchParams.keys()]) if (k.startsWith("X-Amz-")) base.searchParams.delete(k);
        const when = fromAmzDate(url.searchParams.get("X-Amz-Date")!), expires = Number(url.searchParams.get("X-Amz-Expires"));
        const want = new URL(presign(CREDS, req.method!, base, expires, when)).searchParams.get("X-Amz-Signature");
        if (want !== sig) return xml(res, 403, "SignatureDoesNotMatch");
        if (when.getTime() + expires * 1000 < Date.now()) return xml(res, 403, "AccessDenied");
        if (req.method !== "GET" && req.method !== "HEAD") return xml(res, 403, "AccessDenied");
      } else {
        /* Signed headers: the Authorization header, worked out again from what arrived. */
        const auth = String(req.headers.authorization || ""), names = /SignedHeaders=([^,]+)/.exec(auth)?.[1].split(";") || [];
        const given: Record<string, string> = {};
        for (const n of names) if (!["host", "x-amz-date", "x-amz-content-sha256"].includes(n)) given[n] = String(req.headers[n]);
        const again = signedHeaders(CREDS, req.method!, url, given, String(req.headers["x-amz-content-sha256"]), fromAmzDate(String(req.headers["x-amz-date"])));
        if (again.Authorization !== auth) return xml(res, 403, "SignatureDoesNotMatch");
      }
      if (req.method === "PUT") {
        if (f.gate) await f.gate;
        if (req.headers["x-amz-content-sha256"] !== sha256(s.body)) return xml(res, 400, "XAmzContentSHA256Mismatch");
        objects.set(key, { body: s.body, type: String(req.headers["content-type"] || "") });
        res.writeHead(200, { ETag: `"${md5(s.body)}"` }); return res.end();
      }
      if (req.method === "DELETE") { objects.delete(key); res.writeHead(204); return res.end(); }
      const o = objects.get(key);
      if (!o) return xml(res, 404, "NoSuchKey");
      const lie = !sig && f.lie?.(key);
      const headers: Record<string, string> = {
        "Content-Type": url.searchParams.get("response-content-type") || o.type, ETag: `"${lie && lie.etag || md5(o.body)}"`, "Accept-Ranges": "bytes"
      };
      for (const [q, h] of [["response-content-disposition", "Content-Disposition"], ["response-cache-control", "Cache-Control"]]) if (url.searchParams.get(q)) headers[h] = url.searchParams.get(q)!;
      let body = o.body, status = 200;
      const m = /^bytes=(\d+)-(\d*)$/.exec(String(req.headers.range || ""));
      if (m) { const a = Number(m[1]), b = m[2] ? Number(m[2]) : body.length - 1; body = body.subarray(a, b + 1); status = 206; headers["Content-Range"] = `bytes ${a}-${a + body.length - 1}/${o.body.length}`; }
      headers["Content-Length"] = String(lie && lie.size !== undefined ? lie.size : body.length);
      res.writeHead(status, headers); res.end(req.method === "HEAD" ? undefined : body);
    });
  });
  await new Promise<void>(r => server.listen(0, "127.0.0.1", r));
  f.url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return f;
}
type Fake = Awaited<ReturnType<typeof fakeR2>>;
const r2Env = (f: Fake) => ({ R2_ACCOUNT_ID: "acct123", R2_ACCESS_KEY_ID: CREDS.accessKeyId, R2_SECRET_ACCESS_KEY: CREDS.secretAccessKey, R2_BUCKET: BUCKET, R2_ENDPOINT: f.url });
const withR2 = async (t: { after: (fn: () => unknown) => void }, o: Parameters<typeof setup>[0] = {}) => {
  const f = await fakeR2(), s = setup({ ...o, env: { ...r2Env(f), ...(o.env || {}) } });
  t.after(async () => { s.close(); await f.close(); });
  return { f, s };
};
const local = (s: TestServer, id: string, name: string) => fs.existsSync(path.join(s.dir, "lectures", id, name));
const audioUrl = async (s: TestServer, token: string, id: string) => DetailSchema.parse((await s.call("GET", `/lectures/${id}`, { token })).body.detail).audio!.url!;
const get = (s: TestServer, url: string, method = "GET") => s.app.request(url, { method });

test("SigV4: the signatures in AWS's own examples (a presigned GET, a GET with Range, a PUT)", () => {
  const c: Credentials = { accessKeyId: "AKIAIOSFODNN7EXAMPLE", secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY", region: "us-east-1" };
  const when = new Date("2013-05-24T00:00:00Z"), url = (p: string) => new URL("https://examplebucket.s3.amazonaws.com" + p);
  assert.equal(new URL(presign(c, "GET", url("/test.txt"), 86400, when)).searchParams.get("X-Amz-Signature"), "aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404");
  assert.match(signedHeaders(c, "GET", url("/test.txt"), { range: "bytes=0-9" }, sha256(""), when).Authorization,
    /SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41$/);
  assert.match(signedHeaders(c, "PUT", url("/test%24file.text"), { date: "Fri, 24 May 2013 00:00:00 GMT", "x-amz-storage-class": "REDUCED_REDUNDANCY" }, sha256("Welcome to Amazon S3."), when).Authorization,
    /Signature=98ad721746da40c64f1a55b78f14c238d841ea1380cd77a1b5971af0ece108bd$/);
});

test("the R2 settings: all four or none; a missing one is named; the endpoint is the account's unless R2_ENDPOINT says otherwise", () => {
  const all = { R2_ACCOUNT_ID: "abc123", R2_ACCESS_KEY_ID: "k", R2_SECRET_ACCESS_KEY: "s", R2_BUCKET: "halfold" };
  assert.equal(loadConfig({}).r2, null);
  assert.deepEqual(loadConfig(all).r2, { accountId: "abc123", accessKeyId: "k", secretAccessKey: "s", bucket: "halfold", endpoint: "https://abc123.r2.cloudflarestorage.com" });
  assert.equal(loadConfig({ ...all, R2_ENDPOINT: "https://abc123.eu.r2.cloudflarestorage.com/" }).r2!.endpoint, "https://abc123.eu.r2.cloudflarestorage.com");
  assert.throws(() => loadConfig({ ...all, R2_BUCKET: " " }), /R2_BUCKET is not set/);
  assert.throws(() => loadConfig({ R2_ACCOUNT_ID: "abc123" }), /R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY and R2_BUCKET are not set/);
  /* Without them, files stay on this disk. */
  const s = setup(); s.close();
  assert.equal(s.files.bucket, null);
});

test("the check at start: the right settings reach the bucket; a wrong secret or bucket is reported", async t => {
  const f = await fakeR2(); t.after(() => f.close());
  const store = (env: Record<string, string>) => new R2(loadConfig({ ...r2Env(f), ...env }).r2!);
  await store({}).check();
  await assert.rejects(store({ R2_SECRET_ACCESS_KEY: "wrong" }).check(), /R2 check replied 403 SignatureDoesNotMatch/);
  await assert.rejects(store({ R2_BUCKET: "no-such-bucket" }).check(), /R2 check replied 404 NoSuchBucket/);
  f.fail = () => 500;
  await assert.rejects(store({}).check(), /R2 check replied 500 InternalError/);
});

test("with R2: once the notes are written, audio.m4a and slides.pdf are in the bucket, not here; the same link sends the player there, by range and HEAD too", async t => {
  const { f, s } = await withR2(t);
  const token = await s.signIn(), id = await readyLecture(s, token, { slides: true });
  assert.deepEqual(f.keys(), [`kept/${id}/audio.m4a`, `kept/${id}/slides.pdf`]);
  assert.equal(f.objects.get(`kept/${id}/audio.m4a`)!.type, "audio/mp4");
  assert.equal(f.objects.get(`kept/${id}/slides.pdf`)!.type, "application/pdf");
  assert.equal(f.objects.get(`kept/${id}/slides.pdf`)!.body.toString(), "%PDF-1.4 fake");
  const audio = f.objects.get(`kept/${id}/audio.m4a`)!.body;
  assert.match(audio.toString(), new RegExp(`^${FAKE_AUDIO}-bytes-\\d+$`));   // the upload as it came (helpers.ts anotherRecording numbers each one)
  /* Nothing kept is left here; the original went with the notes, as without R2. */
  for (const name of ["audio.m4a", "slides.pdf", "recording"]) assert.equal(local(s, id, name), false, name);
  assert.equal(s.files.where(id, "audio.m4a"), "remote"); assert.equal(s.files.exists(id, "slides.pdf"), true);

  /* The link the front end gets is the same as without R2. */
  const url = await audioUrl(s, token, id);
  assert.match(url, /^\/api\/lectures\/[\w-]+\/audio\?exp=\d+&sig=[\w-]+$/);
  const r = await get(s, url);
  assert.equal(r.status, 302); assert.equal(r.headers.get("cache-control"), "no-store");
  const to = new URL(r.headers.get("location")!);
  assert.equal(to.origin + to.pathname, `${f.url}/${BUCKET}/kept/${id}/audio.m4a`);
  /* It works as long as the link it came from (AUDIO_LINK_HOURS). */
  const exp = Number(new URL(url, "http://x").searchParams.get("exp"));
  assert.ok(Math.abs(Number(to.searchParams.get("X-Amz-Expires")) - (exp - Date.now() / 1000)) < 60);
  assert.equal(to.searchParams.get("response-content-disposition"), `attachment; filename="recording.m4a"; filename*=UTF-8''Week%209.m4a`);

  const whole = await fetch(to);
  assert.equal(whole.status, 200); assert.equal(whole.headers.get("content-type"), "audio/mp4");
  assert.match(whole.headers.get("content-disposition")!, /^attachment; .*Week%209\.m4a$/);
  assert.deepEqual(Buffer.from(await whole.arrayBuffer()), audio);
  const part = await fetch(to, { headers: { Range: "bytes=2-5" } });
  assert.equal(part.status, 206); assert.deepEqual(Buffer.from(await part.arrayBuffer()), audio.subarray(2, 6));
  /* HEAD gets a link signed for HEAD (a GET link would not work for it). */
  const head = await get(s, url, "HEAD");
  assert.equal(head.status, 302);
  const h = await fetch(head.headers.get("location")!, { method: "HEAD" });
  assert.equal(h.status, 200); assert.equal(h.headers.get("content-length"), String(audio.length));
  assert.equal((await fetch(head.headers.get("location")!)).status, 403);
  /* A changed link still does not play. */
  assert.equal((await get(s, url.replace(/exp=(\d+)/, (_, n) => "exp=" + (Number(n) + 1)))).status, 403);

  /* Deleting the lecture deletes both objects. */
  assert.equal((await s.call("DELETE", `/lectures/${id}`, { token })).status, 204);
  assert.deepEqual(f.keys(), []);
  assert.deepEqual(f.seen.filter(x => x.method === "DELETE").map(x => x.key).sort(), [`kept/${id}/audio.m4a`, `kept/${id}/slides.pdf`]);
  assert.deepEqual(s.store.remoteDeletes(), []);
  assert.equal((await get(s, url)).status, 404);
});

test("with R2: a live recording's pieces are kept and joined on this disk; only audio.m4a goes to the bucket", async t => {
  const { f, s } = await withR2(t);
  const token = await s.signIn(), id = await liveLecture(s, token);
  for (let seq = 0; seq < 3; seq++) assert.equal((await s.call("POST", `/lectures/${id}/chunks`, { token, body: chunkForm(fakeChunk(15), seq) })).status, 200);
  assert.equal(fs.readdirSync(s.files.chunkDir(id)).length, 3);
  assert.equal(f.seen.length, 0);
  await s.call("POST", `/lectures/${id}/finish`, { token, json: { duration: 45 } }); await s.pipeline.idle();
  assert.equal(s.store.lecture(id)!.status, "ready");
  assert.deepEqual(f.keys(), [`kept/${id}/audio.m4a`]);
  assert.equal(fs.existsSync(s.files.chunkDir(id)), false);
  assert.equal(local(s, id, "audio.m4a"), false); assert.equal(local(s, id, "recording"), false);
});

test("with R2 down when the notes are written: the lecture is ready and plays from here; an upload R2 does not have whole is not trusted; the sweep moves it later", async t => {
  const { f, s } = await withR2(t);
  const token = await s.signIn();
  f.fail = x => x.method === "PUT" ? 500 : null;
  const id = await readyLecture(s, token);
  assert.equal(local(s, id, "audio.m4a"), true); assert.equal(s.files.where(id, "audio.m4a"), "local");
  const url = await audioUrl(s, token, id);
  const here = await get(s, url);
  assert.equal(here.status, 200); assert.match(here.headers.get("content-disposition")!, /^inline; /);

  /* R2 answers, but has fewer bytes than were sent: the file stays here. */
  f.fail = null; f.lie = () => ({ size: 3 });
  assert.deepEqual(await sweepKept(s), { moved: 0, failed: 1, deleted: 0 });
  assert.equal(local(s, id, "audio.m4a"), true); assert.equal(s.store.isRemote(id, "audio.m4a"), false);
  /* Or another MD5. */
  f.lie = () => ({ etag: md5("something else") });
  assert.equal((await sweepKept(s)).failed, 1); assert.equal(local(s, id, "audio.m4a"), true);

  f.lie = null;
  assert.deepEqual(await sweepKept(s), { moved: 1, failed: 0, deleted: 0 });
  assert.equal(local(s, id, "audio.m4a"), false);
  assert.equal((await get(s, url)).status, 302);
  assert.deepEqual(await sweepKept(s), { moved: 0, failed: 0, deleted: 0 });   // nothing left to move
});

test("with R2 down when a lecture is deleted: the delete goes through and R2's copies are deleted by the sweep later", async t => {
  const { f, s } = await withR2(t);
  const token = await s.signIn(), id = await readyLecture(s, token, { slides: true });
  f.fail = x => x.method === "DELETE" ? 503 : null;
  assert.equal((await s.call("DELETE", `/lectures/${id}`, { token })).status, 204);
  assert.ok(!s.store.lecture(id));
  assert.equal(f.keys().length, 2);
  assert.deepEqual(s.store.remoteDeletes().map(x => x.key).sort(), [`kept/${id}/audio.m4a`, `kept/${id}/slides.pdf`]);
  f.fail = null;
  assert.deepEqual(await sweepKept(s), { moved: 0, failed: 0, deleted: 2 });
  assert.deepEqual(f.keys(), []); assert.deepEqual(s.store.remoteDeletes(), []);
});

test("with R2 and a plan that keeps recordings 30 days: past the date the recording is deleted from R2", async t => {
  const { f, s } = await withR2(t, { plans: p => { p.plans[0].audioDays = 30; } });
  const token = await s.signIn(), id = await readyLecture(s, token, { slides: true });
  assert.equal(await sweepAudio(s, new Date(Date.now() + 32 * 86400_000)), 1);
  assert.deepEqual(f.keys(), [`kept/${id}/slides.pdf`]);   // the slides stay, as on this disk
  assert.equal(s.files.exists(id, "audio.m4a"), false);
  assert.deepEqual(DetailSchema.parse((await s.call("GET", `/lectures/${id}`, { token })).body.detail).audio, { expired: true });
});

test("with R2: slides sent after the notes go to the bucket once they are filed, also when they arrive while the recording is still uploading", async t => {
  const { f, s } = await withR2(t);
  const token = await s.signIn(), id = await uploadedLecture(s, token);
  let open!: () => void;
  f.gate = new Promise(r => { open = r; });
  await s.call("POST", `/lectures/${id}/finish`, { token, json: { duration: 600 } });
  while (!f.seen.some(x => x.method === "PUT")) await new Promise(r => setTimeout(r, 5));
  /* The notes are written and audio.m4a is on its way to R2: the slides arrive now. */
  assert.equal(s.store.lecture(id)!.status, "ready");
  assert.equal((await s.call("POST", `/lectures/${id}/slides`, { token, body: fileForm("%PDF-1.4 late", "slides.pdf") })).status, 204);
  assert.equal(s.store.lecture(id)!.status, "processing");
  f.gate = null; open();
  await s.pipeline.idle();
  const l = s.store.lecture(id)!;
  assert.equal(l.status, "ready");
  assert.ok(DetailSchema.parse((await s.call("GET", `/lectures/${id}`, { token })).body.detail).slides.length > 0);
  assert.deepEqual(f.keys(), [`kept/${id}/audio.m4a`, `kept/${id}/slides.pdf`]);
  assert.equal(f.objects.get(`kept/${id}/slides.pdf`)!.body.toString(), "%PDF-1.4 late");
  assert.equal(local(s, id, "slides.pdf"), false);
});

test("npm run move-to-r2: moves what was kept here before R2, checks each upload, leaves what does not check out, and can be run again", async t => {
  /* Lectures made without R2: two with notes (one with slides), one whose notes failed. */
  const s = setup(), token = await s.signIn();
  const a = await readyLecture(s, token, { slides: true }), b = await readyLecture(s, token);
  const failed = await uploadedLecture(s, token);
  s.stt.error = new Error("stub-stt replied 500");
  await s.call("POST", `/lectures/${failed}/finish`, { token, json: { duration: 600 } }); await s.pipeline.idle();
  s.pipeline.stopAll(); s.live.stopAll(); s.packs.stopAll(); s.store.close();
  fs.renameSync(path.join(s.dir, "test.db"), path.join(s.dir, "sidenote.db"));
  const f = await fakeR2();
  t.after(async () => { fs.rmSync(s.dir, { recursive: true, force: true }); await f.close(); });
  fs.writeFileSync(path.join(s.dir, "tmp", "upload-in-progress.part"), "x");
  /* What the three kept files weigh, read here: each test upload has bytes of its own (helpers.ts anotherRecording). */
  const keptBytes = ([[a, "audio.m4a"], [a, "slides.pdf"], [b, "audio.m4a"]] as const).reduce((n, [id, name]) => n + fs.statSync(path.join(s.dir, "lectures", id, name)).size, 0);
  const run = (...args: string[]) => new Promise<{ code: number; out: string }>(resolve => {
    execFile(process.execPath, ["--disable-warning=ExperimentalWarning", "--import", "tsx", "scripts/move-to-r2.ts", ...args],
      { cwd: SERVER_DIR, env: { ...process.env, DATA_DIR: s.dir, WEB_DIR: "", ...r2Env(f) } },
      (e, stdout, stderr) => resolve({ code: e ? (e as { code?: number }).code ?? 1 : 0, out: stdout + stderr }));
  });

  const dry = await run("--dry-run");
  assert.equal(dry.code, 0, dry.out);
  assert.match(dry.out, /3 file\(s\), 0\.0 MB, would move to R2 bucket halfold-test\. Already there: 0 file\(s\)\./);
  assert.equal(f.seen.length, 0);

  f.lie = key => key === `kept/${b}/audio.m4a` ? { size: 1 } : null;
  const first = await run();
  assert.equal(first.code, 1, first.out);
  assert.match(first.out, new RegExp(`${b}  NOT MOVED \\(kept here\\): R2 has 1 bytes`));
  assert.match(first.out, /Moved 2 file\(s\)/);
  assert.match(first.out, /1 lecture\(s\) without notes yet keep their files on this disk/);
  assert.deepEqual(f.keys(), [`kept/${a}/audio.m4a`, `kept/${a}/slides.pdf`, `kept/${b}/audio.m4a`].sort());
  assert.equal(local(s, a, "audio.m4a"), false); assert.equal(local(s, a, "slides.pdf"), false);
  assert.equal(local(s, b, "audio.m4a"), true);
  assert.equal(local(s, failed, "recording"), true);

  f.lie = null;
  const second = await run();
  assert.equal(second.code, 0, second.out);
  assert.match(second.out, /Moved 1 file\(s\).*In R2 now: 3 file\(s\)/);
  assert.equal(local(s, b, "audio.m4a"), false);
  const third = await run();
  assert.match(third.out, /Moved 0 file\(s\)/);
  assert.equal(f.seen.filter(x => x.method === "PUT").length, 4);
  /* The server's uploads in progress are left alone. */
  assert.equal(fs.existsSync(path.join(s.dir, "tmp", "upload-in-progress.part")), true);

  const store = new Store(path.join(s.dir, "sidenote.db"));
  t.after(() => store.close());
  assert.deepEqual(store.remoteTotals(), { files: 3, bytes: keptBytes });
});

/* Fetching kept files back from R2 (files.ts fetch), for a step that reads them again. */
test("R2 get: downloads an object and checks its size and MD5; a wrong or missing one leaves no file behind", async t => {
  const f = await fakeR2(); t.after(() => f.close());
  const r2 = new R2(loadConfig(r2Env(f)).r2!), dir = fs.mkdtempSync(path.join(os.tmpdir(), "sn-r2get-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const src = path.join(dir, "deck.pdf"), out = path.join(dir, "back.pdf");
  fs.writeFileSync(src, "%PDF-1.4 the deck");
  await r2.put("kept/lec-1/slides.pdf", src, "application/pdf");
  const got = await r2.get("kept/lec-1/slides.pdf", out);
  assert.equal(fs.readFileSync(out, "utf8"), "%PDF-1.4 the deck");
  assert.deepEqual(got, { size: 17, md5: createHash("md5").update("%PDF-1.4 the deck").digest("hex") });
  /* R2 says it has other bytes than it sends: refused, and the file is not there (nor a part file). */
  fs.rmSync(out);
  f.lie = () => ({ etag: "0".repeat(32) });
  await assert.rejects(r2.get("kept/lec-1/slides.pdf", out), /R2 sent 17 bytes .* not the 17 bytes \(ETag 0{32}\)/);
  f.lie = null;
  await assert.rejects(r2.get("kept/lec-1/none.pdf", out), /R2 has no kept\/lec-1\/none.pdf/);
  assert.deepEqual(fs.readdirSync(dir), ["deck.pdf"]);
});

/* A slide reader that needs the PDF on this disk, as the real one does (the default stub does not read the file). */
const readsPdf = async (file: string) => {
  if (!fs.readFileSync(file, "utf8").startsWith("%PDF")) throw new Error("not a PDF");
  return [{ n: 1, text: "Course admin\nMidterm" }, { n: 2, text: "Opportunity cost\nThe value of the next best alternative" }];
};
async function packInR2(s: TestServer, f: Fake, token: string) {
  const course = (await s.call("POST", "/courses", { token, json: { code: "ECON 1001", name: "Microeconomics" } })).body;
  const id = (await s.call("POST", "/lectures", { token, json: { courseId: course.id, title: "Week 10", language: "en", source: "slides" } })).body.id as string;
  assert.equal((await s.call("POST", `/lectures/${id}/slides`, { token, body: fileForm("%PDF-1.4 fake", "slides.pdf") })).status, 204);
  await s.call("POST", `/lectures/${id}/finish`, { token, json: { duration: 0 } }); await s.pipeline.idle();
  /* The pack is written and its deck moved to R2, like any lecture's files once it has notes. */
  assert.equal(s.store.lecture(id)!.status, "ready");
  assert.deepEqual(f.keys(), [`kept/${id}/slides.pdf`]); assert.equal(local(s, id, "slides.pdf"), false);
  return id;
}

test("with R2: a study pack's deck, moved to R2, comes back when its recording does; the notes are written with the slides, then both files go to R2", async t => {
  const { f, s } = await withR2(t, { slides: readsPdf });
  const token = await s.signIn(), id = await packInR2(s, f, token);
  const up = await s.call("POST", `/lectures/${id}/recording`, { token, body: fileForm(FAKE_AUDIO + "-the-pack-recording", "week10.mp3") });
  assert.equal(up.status, 204, up.text); await s.pipeline.idle();
  const l = s.store.lecture(id)!;
  assert.equal(l.status, "ready"); assert.equal(l.source, "upload");
  /* Written with the slides: before, the deck was only in R2 and the notes were written without it. */
  assert.deepEqual(s.notes.calls.at(-1)!.input.slides.map(p => p.n), [1, 2]);
  assert.ok(f.seen.some(x => x.method === "GET" && x.key === `kept/${id}/slides.pdf` && !x.url.includes("X-Amz-Signature")), "the deck was fetched from R2");
  assert.deepEqual(f.keys(), [`kept/${id}/audio.m4a`, `kept/${id}/slides.pdf`]);
  assert.equal(f.objects.get(`kept/${id}/slides.pdf`)!.body.toString(), "%PDF-1.4 fake");
  for (const name of ["audio.m4a", "slides.pdf"]) assert.equal(local(s, id, name), false, name);
});

test("with R2: when the deck cannot be fetched back, the notes are not written without it; Try again fetches it", async t => {
  const { f, s } = await withR2(t, { slides: readsPdf });
  const token = await s.signIn(), id = await packInR2(s, f, token);
  f.fail = x => x.method === "GET" && x.key === `kept/${id}/slides.pdf` ? 500 : null;
  assert.equal((await s.call("POST", `/lectures/${id}/recording`, { token, body: fileForm(FAKE_AUDIO + "-another-pack-recording", "week10.mp3") })).status, 204);
  await s.pipeline.idle();
  assert.equal(s.store.lecture(id)!.status, "failed");
  assert.equal(s.notes.calls.length, 0);   // no notes written without the slides
  assert.equal(local(s, id, "slides.pdf"), false); assert.ok(f.objects.has(`kept/${id}/slides.pdf`), "the deck is still in R2");
  f.fail = null;
  assert.equal((await s.call("POST", `/lectures/${id}/retry`, { token })).status, 200);
  await s.pipeline.idle();
  assert.equal(s.store.lecture(id)!.status, "ready");
  assert.deepEqual(s.notes.calls.at(-1)!.input.slides.map(p => p.n), [1, 2]);
  assert.equal(local(s, id, "slides.pdf"), false);
});
