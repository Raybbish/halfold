/* Live recording with ffmpeg, the speech-to-text service, the notes model and Catch me up stubbed: a browser sending
   chunks in order, out of order, twice and after a gap; the live transcript and its alerts; the daily limit; finishing
   (once, twice, from what was saved, after a failure); a lecture deleted while it records; Catch me up. */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { CatchUpReplySchema, ChunkReplySchema, DetailSchema, ErrorReplySchema, HomeSchema } from "../src/shapes";
import { chunkForm, fakeChunk, LIVE_WORDS, liveLecture, setup, StubMedia, uploadedLecture, type TestServer } from "./helpers";

const send = async (s: TestServer, token: string, id: string, seq: number | string, content = fakeChunk()) => {
  const r = await s.call("POST", `/lectures/${id}/chunks`, { token, body: chunkForm(content, seq) });
  if (r.status === 200) ChunkReplySchema.parse(r.body); else ErrorReplySchema.parse(r.body);
  return r;
};
const live = (s: TestServer) => setupLive(s);
function setupLive(s: TestServer) { s.stt.words = LIVE_WORDS; return s; }
const lines = (s: TestServer, id: string) => s.store.liveLines(id);

test("in order: each reply carries the lines of its round; a word cut by the window's end comes whole in the next round", async t => {
  const s = live(setup()); t.after(() => s.close());
  const token = await s.signIn(), id = await liveLecture(s, token, { language: "en" });

  const r0 = await send(s, token, id, 0);
  assert.deepEqual(r0.body, { segments: [{ t: 1, text: "Good afternoon." }, { t: 6, text: "Today we cover elasticity." }], alerts: [] });
  /* "The midterm is on..." runs past 15 s: held back, heard again from 13 s with what follows. */
  const r1 = await send(s, token, id, 1);
  assert.deepEqual(r1.body.segments, [{ t: 13, text: "The midterm is on November 26." }, { t: 22, text: "Elasticity measures how much demand responds to price." }]);
  assert.deepEqual(r1.body.alerts, [{ t: 13, kind: "Midterm", text: "The midterm is on November 26." }]);
  const r2 = await send(s, token, id, 2);
  assert.deepEqual(r2.body, { segments: [{ t: 33, text: "Problem set two is due next Friday." }], alerts: [{ t: 33, kind: "Deadline", text: "Problem set two is due next Friday." }] });
  const r3 = await send(s, token, id, 3, fakeChunk(10));
  assert.deepEqual(r3.body.segments, [{ t: 50, text: "That is all." }]);

  assert.deepEqual(s.stt.windows, [[0, 15], [13, 30], [28, 45], [43, 55]]);
  const lec = s.store.lecture(id)!;
  assert.equal(lec.live_audio, 55); assert.equal(lec.status, "recording");
  /* Every window is paid for, the held tails included. */
  const liveCosts = s.store.costs().filter(c => c.stage === "live");
  assert.equal(liveCosts.length, 4); assert.equal(liveCosts.reduce((n, c) => n + c.audio_seconds!, 0), 15 + 17 + 17 + 12);
  /* Home counts the recording in progress toward today's minutes. */
  assert.equal(HomeSchema.parse((await s.call("GET", "/home", { token })).body).usage!.minutesToday, 1);

  /* End: the chunks become one recording, transcribed again as a whole for the notes. */
  assert.deepEqual((await s.call("POST", `/lectures/${id}/finish`, { token, json: { duration: 56 } })).body, { status: "processing" });
  await s.pipeline.idle();
  const done = s.store.lecture(id)!;
  assert.equal(done.status, "ready"); assert.equal(done.duration, 55); assert.equal(done.client_duration, 56);
  /* The stub media copies what it converts, so audio.m4a holds the joined recording; the original went with the notes. */
  assert.equal(fs.readFileSync(s.files.path(id, "audio.m4a"), "utf8"), fakeChunk() + fakeChunk() + fakeChunk() + fakeChunk(10));
  assert.equal(s.files.exists(id, "recording"), false);
  assert.equal(fs.existsSync(s.files.chunkDir(id)), false);
  assert.equal((s.media as StubMedia).speech.at(-1)!.o!.fillGaps, true);
  assert.deepEqual(s.store.costs().filter(c => c.stage === "stt").map(c => c.audio_seconds), [600]);   // the stub's whole-file reply says 600
  const d = DetailSchema.parse((await s.call("GET", `/lectures/${id}`, { token })).body.detail);
  assert.ok(d.audio?.url);
  assert.equal(s.notes.calls[0].input.lines[0].text, "Good afternoon.");
});

test("a sentence that runs past the end of a round is held back and sent whole with the next round", async t => {
  const s = setup(); t.after(() => s.close());
  s.stt.words = [{ text: "The", start: 9, end: 9.3 }, { text: "law", start: 9.3, end: 9.6 }, { text: "of", start: 9.6, end: 9.8 }, { text: "supply", start: 9.8, end: 10.4 },
    { text: "says", start: 10.4, end: 10.8 }, { text: "that", start: 10.8, end: 11.2 }, { text: "prices", start: 11.4, end: 12 }, { text: "rise.", start: 12.5, end: 14 },
    { text: "Next", start: 20, end: 20.5 }, { text: "topic.", start: 20.5, end: 22 }];
  const token = await s.signIn(), id = await liveLecture(s, token);
  assert.deepEqual((await send(s, token, id, 0)).body.segments, []);
  assert.ok(s.store.lecture(id)!.live_held);
  /* Catch me up still hears the sentence in progress. */
  await s.call("POST", `/lectures/${id}/catch-up`, { token });
  assert.deepEqual(s.catchUp.calls[0].lines, [{ t: 9, text: "The law of supply says that prices" }]);
  assert.deepEqual((await send(s, token, id, 1)).body.segments, [{ t: 9, text: "The law of supply says that prices rise." }, { t: 20, text: "Next topic." }]);
  assert.equal(s.store.lecture(id)!.live_held, null);
});

test("the simulated browser: out of order, twice, a gap, then a backlog sent at once", async t => {
  const s = live(setup()); t.after(() => s.close());
  const token = await s.signIn(), id = await liveLecture(s, token);

  /* 1 before 0: kept, but nothing can be read without the first piece. */
  assert.deepEqual((await send(s, token, id, 1)).body, { segments: [], alerts: [] });
  assert.deepEqual(s.stt.windows, []);
  const r0 = await send(s, token, id, 0);
  assert.deepEqual(r0.body.segments.map((x: { t: number }) => x.t), [1, 6, 13, 22]);   // both pieces in one round
  assert.deepEqual(s.stt.windows, [[0, 30]]);

  /* 0 again, as if its reply had been lost: stored once, and the reply repeats what the first one carried. */
  const bytes = s.store.lecture(id)!.chunk_bytes;
  assert.deepEqual((await send(s, token, id, 0)).body, r0.body);
  assert.equal(s.store.lecture(id)!.chunk_bytes, bytes); assert.deepEqual(s.store.chunkSeqs(id), [0, 1]);
  assert.equal(lines(s, id).length, 4);

  /* 3 before 2: waits for 2. */
  assert.deepEqual((await send(s, token, id, 3)).body.segments, []);
  assert.deepEqual(s.stt.windows, [[0, 30]]);
  const r2 = await send(s, token, id, 2);
  assert.deepEqual(r2.body.segments, [{ t: 33, text: "Problem set two is due next Friday." }, { t: 50, text: "That is all." }]);

  /* Offline for a while, then a backlog: the round in progress takes what came first, the next one all the rest. */
  let release!: () => void; s.stt.gate = new Promise(r => { release = r; });
  const pending = [4, 5, 6].map(seq => send(s, token, id, seq));
  await new Promise(r => setTimeout(r, 20)); release(); s.stt.gate = null;
  const replies = await Promise.all(pending);
  await s.live.idle();
  assert.ok(replies.every(r => r.status === 200));
  assert.ok(s.stt.windows.length <= 4, `three chunks, at most two rounds: ${JSON.stringify(s.stt.windows)}`);
  assert.equal(s.store.lecture(id)!.live_audio, 105);
  /* The live transcript has no line twice. */
  const ts = lines(s, id).map(x => x.t);
  assert.deepEqual(ts, [...new Set(ts)]);
});

test("a reply waits for its round at most LIVE_REPLY_WAIT_MS; the late lines come with the next reply", async t => {
  const s = live(setup({ env: { LIVE_REPLY_WAIT_MS: "30" } })); t.after(() => s.close());
  const token = await s.signIn(), id = await liveLecture(s, token);
  let release!: () => void; s.stt.gate = new Promise(r => { release = r; });
  assert.deepEqual((await send(s, token, id, 0)).body, { segments: [], alerts: [] });
  release(); s.stt.gate = null; await s.live.idle();
  const r1 = await send(s, token, id, 1);
  assert.deepEqual(r1.body.segments.map((x: { t: number }) => x.t), [1, 6, 13, 22]);
});

test("a failed round costs nothing more and is covered by the next one", async t => {
  const s = live(setup()); t.after(() => s.close());
  const token = await s.signIn(), id = await liveLecture(s, token);
  s.stt.error = new Error("stub-stt replied 503");
  assert.deepEqual((await send(s, token, id, 0)).body.segments, []);
  assert.equal(s.store.lecture(id)!.live_from, 0); assert.equal(s.store.lecture(id)!.live_audio, 15);   // the audio still counts toward the limit
  s.stt.error = null;
  assert.deepEqual((await send(s, token, id, 1)).body.segments.map((x: { t: number }) => x.t), [1, 6, 13, 22]);
  assert.deepEqual(s.stt.windows, [[0, 30]]); assert.equal(s.stt.calls, 2);
  assert.equal(s.store.costs().filter(c => c.stage === "live").length, 1);   // a refused request is not logged as paid
});

test("deleted while recording: the round in progress saves nothing, later chunks are 404, no files are left", async t => {
  const s = live(setup({ env: { LIVE_REPLY_WAIT_MS: "20" } })); t.after(() => s.close());
  const token = await s.signIn(), id = await liveLecture(s, token);
  let release!: () => void; s.stt.gate = new Promise(r => { release = r; });
  await send(s, token, id, 0);
  assert.equal((await s.call("DELETE", `/lectures/${id}`, { token })).status, 204);
  release(); await s.live.idle();
  assert.equal(s.store.db.prepare("SELECT COUNT(*) AS n FROM live_lines").get()!.n, 0);
  const late = await send(s, token, id, 1);
  assert.equal(late.status, 404);
  assert.equal(fs.existsSync(path.join(s.dir, "lectures", id)), false);
});

test("finish: refused without audio; idempotent; later chunks are 410 but a resent one is fine; notes from what was saved", async t => {
  const s = live(setup()); t.after(() => s.close());
  const token = await s.signIn(), id = await liveLecture(s, token);
  const none = await s.call("POST", `/lectures/${id}/finish`, { token, json: { duration: 30 } });
  assert.equal(none.status, 409); assert.equal(none.body.message, "Sidenote did not receive any audio for this lecture. Delete it and record again.");
  /* Only a later piece, never the first: nothing can be read. */
  await send(s, token, id, 1);
  assert.equal((await s.call("POST", `/lectures/${id}/finish`, { token })).status, 409);
  await send(s, token, id, 0);

  /* The page was closed; later the student opens the lecture and picks "Make notes from what was saved" (duration 0). */
  let release!: () => void; s.stt.gate = new Promise(r => { release = r; });
  assert.deepEqual((await s.call("POST", `/lectures/${id}/finish`, { token, json: { duration: 0 } })).body, { status: "processing" });
  assert.deepEqual((await s.call("POST", `/lectures/${id}/finish`, { token, json: { duration: 0 } })).body, { status: "processing" });
  const late = await send(s, token, id, 2);
  assert.equal(late.status, 410); assert.match(late.body.message, /has ended/);
  assert.deepEqual((await send(s, token, id, 1)).body, { segments: [], alerts: [] });
  release(); await s.pipeline.idle();
  assert.equal(s.store.lecture(id)!.status, "ready"); assert.equal(s.store.lecture(id)!.duration, 30);
  assert.equal(s.store.lecture(id)!.client_duration, null);   // 0 is not a length
  assert.equal(s.stt.calls - s.stt.windows.length, 1);   // one whole-file transcription
});

test("a chunk that never arrived: the recording is joined without it, and a failure is retried without joining again", async t => {
  const s = live(setup()); t.after(() => s.close());
  const token = await s.signIn(), id = await liveLecture(s, token);
  for (const seq of [0, 1, 3]) await send(s, token, id, seq);
  s.stt.error = new Error("stub-stt replied 500");
  await s.call("POST", `/lectures/${id}/finish`, { token, json: { duration: 60 } }); await s.pipeline.idle();
  assert.equal(s.store.lecture(id)!.status, "failed");
  assert.equal(fs.readFileSync(s.files.path(id, "recording"), "utf8"), fakeChunk().repeat(3));
  s.stt.error = null;
  assert.deepEqual((await s.call("POST", `/lectures/${id}/retry`, { token })).body, { status: "processing" });
  await s.pipeline.idle();
  assert.equal(s.store.lecture(id)!.status, "ready");
});

test("the daily limit: a warning near the end, an alert when it is reached, then 410; a new recording is refused", async t => {
  const s = live(setup({ plans: p => { p.plans[0].dailyLiveMinutes = 10; } })); t.after(() => s.close());
  const token = await s.signIn(), id = await liveLecture(s, token);
  assert.deepEqual((await send(s, token, id, 0, fakeChunk(240))).body.alerts, []);
  const warned = await send(s, token, id, 1, fakeChunk(120));
  assert.deepEqual(warned.body.alerts, [{ t: 360, kind: "Recording", text: "About 4 recording minutes are left today. Sidenote stops saving this recording when they run out; end it then to get notes for what was saved." }]);
  assert.deepEqual((await send(s, token, id, 2, fakeChunk(60))).body.alerts, []);   // warned once
  const reached = await send(s, token, id, 3, fakeChunk(180));
  assert.deepEqual(reached.body.alerts.map((a: { kind: string; t: number }) => [a.kind, a.t]), [["Recording", 600]]);
  assert.match(reached.body.alerts[0].text, /^Today's recording minutes are used up/);
  /* The front end drops the rest of this lecture's chunks on a 410; a resent one that was saved is still fine. */
  const refused = await send(s, token, id, 4, fakeChunk(15));
  assert.equal(refused.status, 410); assert.match(refused.body.message, /^Today's recording minutes are used up/);
  assert.equal((await send(s, token, id, 3, fakeChunk(180))).status, 200);
  assert.deepEqual(s.store.chunkSeqs(id), [0, 1, 2, 3]);
  /* The recording in progress counts: a second one cannot start, on this device or another. */
  const course = s.store.lecture(id)!.course_id;
  const second = await s.call("POST", "/lectures", { token, json: { courseId: course, title: "Again", language: "en", source: "record" } });
  assert.equal(second.status, 429);
  /* Ending the recording writes the notes from the ten minutes that were saved. */
  await s.call("POST", `/lectures/${id}/finish`, { token, json: { duration: 615 } }); await s.pipeline.idle();
  assert.equal(s.store.lecture(id)!.status, "ready"); assert.equal(s.store.lecture(id)!.duration, 600);
});

test("chunks: bad requests, someone else's lecture, an upload lecture, a piece too big, a recording too big", async t => {
  const s = live(setup({ env: { MAX_CHUNK_MB: "0.001", MAX_UPLOAD_MB: "0.0001" } })); t.after(() => s.close());
  const token = await s.signIn(), id = await liveLecture(s, token);
  for (const seq of ["", "x", "-1", "1.5", "1234567"]) assert.equal((await send(s, token, id, seq)).status, 400, `seq ${JSON.stringify(seq)}`);
  const noAudio = new FormData(); noAudio.append("seq", "0");
  assert.equal((await s.call("POST", `/lectures/${id}/chunks`, { token, body: noAudio })).status, 400);
  assert.equal((await send(s, await s.signIn("CODE-B"), id, 0)).status, 404);
  assert.equal((await send(s, token, "lec-missing", 0)).status, 404);
  const big = await send(s, token, id, 0, "FAKEAUDIO:15\n" + "x".repeat(2000));
  assert.equal(big.status, 413);
  /* MAX_UPLOAD_MB also caps a live recording: the piece that would pass it is refused with 410 (stop sending). */
  assert.equal((await send(s, token, id, 0, fakeChunk(15) + "y".repeat(80))).status, 200);
  const over = await send(s, token, id, 1, fakeChunk(15) + "z".repeat(80));
  assert.equal(over.status, 410); assert.equal(s.store.lecture(id)!.live_limit, 2);
  /* A live lecture takes no uploaded file, and an upload lecture takes no chunks. */
  const up = await uploadedLecture(s, token);
  assert.equal((await send(s, token, up, 0)).status, 409);
  assert.equal((await s.call("POST", `/lectures/${id}/recording`, { token, body: chunkForm("FAKEAUDIO", 0) })).status, 409);
  /* Nothing half-received is left behind. */
  assert.deepEqual(fs.readdirSync(path.join(s.dir, "tmp")), []);
});

test("LIVE_TRANSCRIPT=off: chunks are kept and counted, nothing is transcribed live, Catch me up is not offered", async t => {
  const s = live(setup({ env: { LIVE_TRANSCRIPT: "off" } })); t.after(() => s.close());
  const token = await s.signIn(), id = await liveLecture(s, token);
  for (const seq of [0, 1, 2]) assert.deepEqual((await send(s, token, id, seq)).body, { segments: [], alerts: [] });
  assert.deepEqual(s.stt.windows, []); assert.equal(s.store.lecture(id)!.live_audio, 45);
  /* Each measurement reads only what is new. */
  assert.deepEqual((s.media as StubMedia).cuts.map(c => c.from), [0, 15, 30]);
  assert.equal((await s.call("POST", `/lectures/${id}/catch-up`, { token })).status, 501);
});

test("Catch me up: nothing yet; the last five minutes; the model failing; not for an upload", async t => {
  const s = live(setup()); t.after(() => s.close());
  const token = await s.signIn(), id = await liveLecture(s, token, { language: "en-yue" });
  const empty = await s.call("POST", `/lectures/${id}/catch-up`, { token });
  assert.deepEqual(CatchUpReplySchema.parse(empty.body), { points: ["Nothing has been said yet that Sid can sum up. Try again in a minute."] });
  assert.equal(s.catchUp.calls.length, 0);

  for (const seq of [0, 1, 2]) await send(s, token, id, seq);
  const r = await s.call("POST", `/lectures/${id}/catch-up`, { token });
  assert.deepEqual(CatchUpReplySchema.parse(r.body).points, ["Elasticity measures how much demand responds to price.", "Problem set two is due next Friday."]);
  const input = s.catchUp.calls[0];
  assert.equal(input.language, "en-yue"); assert.equal(input.courseCode, "ECON 1001"); assert.equal(input.title, "Week 10");
  assert.deepEqual(input.lines.map(l => l.t), [1, 6, 13, 22, 33]);
  const cost = s.store.costs().filter(c => c.stage === "catchup");
  assert.equal(cost.length, 1); assert.equal(cost[0].input_tokens, 1200); assert.equal(JSON.parse(cost[0].meta_json!).completed, true);

  /* Only the last five minutes go to the model. */
  s.store.db.prepare("INSERT INTO live_lines (lecture_id, t, text) VALUES (?, ?, ?)").run(id, 400, "Much later.");
  await s.call("POST", `/lectures/${id}/catch-up`, { token });
  assert.deepEqual(s.catchUp.calls[1].lines.map(l => l.t), [400]);

  s.catchUp.replies.push(new Error("the reply had no points"));
  const failed = await s.call("POST", `/lectures/${id}/catch-up`, { token });
  assert.equal(failed.status, 502); assert.equal(failed.body.message, "Sid could not sum up the last few minutes just now. Try again in a moment.");
  assert.equal(s.store.costs().filter(c => c.stage === "catchup").length, 3);   // paid for even when unusable

  const up = await uploadedLecture(s, token);
  assert.equal((await s.call("POST", `/lectures/${up}/catch-up`, { token })).status, 409);
  assert.equal((await s.call("POST", `/lectures/${id}/catch-up`, { token: await s.signIn("CODE-B") })).status, 404);
});
