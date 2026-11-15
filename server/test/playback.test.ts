/* Playback (INTEGRATION.md section 4): detail.audio.url is a signed link that works without the token, sends the file
   whole or by byte range, and stops working when it expires, is changed, or the lecture is deleted. A plan that
   keeps recordings N days (plans.json audioDays): keptUntil, then the recording is deleted and detail.audio says expired.
   How the plan changes the date (a lapsed plan, recordings from before plans): billing.test.ts. */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { addDays, sweepAudio } from "../src/audio";
import { localDate } from "../src/time";
import { DetailSchema, ErrorReplySchema, HomeSchema } from "../src/shapes";
import { setup, uploadedLecture, type TestServer } from "./helpers";

async function readyLecture(s: TestServer, token: string) {
  const id = await uploadedLecture(s, token);
  await s.call("POST", `/lectures/${id}/finish`, { token, json: { duration: 600 } });
  await s.pipeline.idle();
  const d = DetailSchema.parse((await s.call("GET", `/lectures/${id}`, { token })).body.detail);
  return { id, audio: d.audio! };
}
/* The link as the browser uses it: no Authorization header. */
const get = (s: TestServer, url: string, headers: Record<string, string> = {}, method = "GET") => s.app.request(url, { method, headers });

test("the link plays without the token: whole file, a byte range, the end, an open range, HEAD; 416 out of range", async t => {
  const s = setup(); t.after(() => s.close());
  const token = await s.signIn(), { id, audio } = await readyLecture(s, token);
  const file = fs.readFileSync(s.files.path(id, "audio.m4a")), size = file.length;

  const whole = await get(s, audio.url!);
  assert.equal(whole.status, 200);
  assert.equal(whole.headers.get("content-type"), "audio/mp4"); assert.equal(whole.headers.get("accept-ranges"), "bytes");
  assert.equal(whole.headers.get("content-length"), String(size));
  assert.match(whole.headers.get("content-disposition")!, /^inline; filename="recording.m4a"; filename\*=UTF-8''Week%209\.m4a$/);
  assert.deepEqual(Buffer.from(await whole.arrayBuffer()), file);

  const part = await get(s, audio.url!, { Range: "bytes=2-5" });
  assert.equal(part.status, 206); assert.equal(part.headers.get("content-range"), `bytes 2-5/${size}`); assert.equal(part.headers.get("content-length"), "4");
  assert.deepEqual(Buffer.from(await part.arrayBuffer()), file.subarray(2, 6));
  const tail = await get(s, audio.url!, { Range: "bytes=-3" });
  assert.equal(tail.status, 206); assert.deepEqual(Buffer.from(await tail.arrayBuffer()), file.subarray(size - 3));
  const open = await get(s, audio.url!, { Range: "bytes=4-" });
  assert.equal(open.headers.get("content-range"), `bytes 4-${size - 1}/${size}`); assert.deepEqual(Buffer.from(await open.arrayBuffer()), file.subarray(4));
  const past = await get(s, audio.url!, { Range: "bytes=100000-" });
  assert.equal(past.status, 416); assert.equal(past.headers.get("content-range"), `bytes */${size}`);
  /* An end past the file is cut to the file. */
  assert.equal((await get(s, audio.url!, { Range: `bytes=0-${size + 50}` })).headers.get("content-range"), `bytes 0-${size - 1}/${size}`);
  const head = await get(s, audio.url!, { Range: "bytes=0-1" }, "HEAD");
  assert.equal(head.status, 206); assert.equal(head.headers.get("content-length"), "2"); assert.equal((await head.arrayBuffer()).byteLength, 0);
});

test("a link that is changed, expired, for another lecture, or of a deleted lecture does not play", async t => {
  const s = setup({ env: { AUDIO_LINK_HOURS: "2" } }); t.after(() => s.close());
  const token = await s.signIn(), a = await readyLecture(s, token), b = await readyLecture(s, token);
  const url = new URL(a.audio.url!, "http://x");
  const exp = Number(url.searchParams.get("exp"));
  assert.ok(Math.abs(exp - (Date.now() / 1000 + 2 * 3600)) < 60);
  const sig = url.searchParams.get("sig")!;
  const bad = [
    `/api/lectures/${a.id}/audio?exp=${exp}&sig=${sig.slice(0, -1)}${sig.endsWith("x") ? "y" : "x"}`,
    `/api/lectures/${a.id}/audio?exp=${exp + 1}&sig=${sig}`,
    `/api/lectures/${b.id}/audio?exp=${exp}&sig=${sig}`,
    `/api/lectures/${a.id}/audio`
  ];
  for (const u of bad) { const r = await get(s, u); assert.equal(r.status, 403, u); ErrorReplySchema.parse(await r.json()); }
  /* An expired link: a fresh GET /lectures/:id gives a new one (the front end does this when playback fails). */
  const old = Math.floor(Date.now() / 1000) - 10;
  const { createHmac } = await import("node:crypto");
  const oldSig = createHmac("sha256", s.store.secret()).update(`audio:${a.id}:${old}`).digest("base64url").slice(0, 32);
  assert.equal((await get(s, `/api/lectures/${a.id}/audio?exp=${old}&sig=${oldSig}`)).status, 403);
  const fresh = (await s.call("GET", `/lectures/${a.id}`, { token })).body.detail.audio.url;
  assert.equal((await get(s, fresh)).status, 200);
  /* Deleted: the file is gone. */
  await s.call("DELETE", `/lectures/${a.id}`, { token });
  assert.equal((await get(s, a.audio.url!)).status, 404);
  /* PUBLIC_URL makes the link absolute. */
  const p = setup({ env: { PUBLIC_URL: "https://sidenote.example.com/" } }); t.after(() => p.close());
  const pt = await p.signIn(), pl = await readyLecture(p, pt);
  assert.match(pl.audio.url!, /^https:\/\/sidenote\.example\.com\/api\/lectures\/[\w-]+\/audio\?exp=/);
});

test("a plan that keeps recordings 30 days: keptUntil and audioDays; past the date the recording is deleted and detail.audio is expired", async t => {
  const s = setup({ plans: p => { p.plans[0].audioDays = 30; } }); t.after(() => s.close());
  const token = await s.signIn(), { id, audio } = await readyLecture(s, token);
  const today = localDate(new Date(), s.config.timezone);
  assert.equal(audio.keptUntil, addDays(today, 30));
  assert.equal(HomeSchema.parse((await s.call("GET", "/home", { token })).body).usage!.audioDays, 30);

  /* A lecture without notes keeps its recording: the notes still need it. */
  const failed = await uploadedLecture(s, token);
  s.stt.error = new Error("stub-stt replied 500");
  await s.call("POST", `/lectures/${failed}/finish`, { token, json: { duration: 600 } }); await s.pipeline.idle();
  assert.equal(s.store.lecture(failed)!.status, "failed");

  assert.equal(await sweepAudio(s, new Date(Date.now() + 30 * 86400_000)), 0);   // the last day is still kept
  assert.equal(await sweepAudio(s, new Date(Date.now() + 32 * 86400_000)), 1);
  assert.equal(s.files.exists(id, "audio.m4a"), false); assert.equal(s.files.exists(id, "recording"), false);
  assert.equal(s.files.exists(failed, "recording"), true);
  const d = DetailSchema.parse((await s.call("GET", `/lectures/${id}`, { token })).body.detail);
  assert.deepEqual(d.audio, { expired: true });
  assert.equal(d.sections.length, 2);   // the notes stay
  assert.equal((await get(s, audio.url!)).status, 404);
  /* A plan that keeps recordings for good: nothing is swept and neither field is sent. */
  const k = setup(); t.after(() => k.close());
  const kt = await k.signIn(), kl = await readyLecture(k, kt);
  assert.equal(await sweepAudio(k, new Date(Date.now() + 9999 * 86400_000)), 0);
  assert.deepEqual(Object.keys(kl.audio), ["url"]);
  assert.equal(HomeSchema.parse((await k.call("GET", "/home", { token: kt })).body).usage!.audioDays, undefined);
});
