/* Recording and slide uploads (API-CHANGES.md section 2): 413 for a file that is too big, an interrupted upload leaves
   nothing behind, a lecture deleted while its file is uploading keeps no files, and files that are not audio or PDF are refused. */
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { serve } from "@hono/node-server";
import type { AddressInfo } from "node:net";
import { ErrorReplySchema } from "../src/shapes";
import { FAKE_AUDIO, fileForm, setup, tempFiles, type TestServer } from "./helpers";

async function newLecture(s: TestServer, token: string) {
  const course = (await s.call("POST", "/courses", { token, json: { code: "ECON 1001", name: "" } })).body;
  return (await s.call("POST", "/lectures", { token, json: { courseId: course.id, title: "L", language: "en", source: "upload" } })).body.id as string;
}
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));
async function until(check: () => boolean, ms = 2000) { const end = Date.now() + ms; while (!check() && Date.now() < end) await wait(20); return check(); }

test("a file over MAX_UPLOAD_MB is a 413 with a message, by Content-Length or while streaming", async t => {
  const s = setup({ env: { MAX_UPLOAD_MB: "1" } }); t.after(() => s.close());
  const token = await s.signIn(), id = await newLecture(s, token);
  const r = await s.call("POST", `/lectures/${id}/recording`, { token, body: fileForm(FAKE_AUDIO + "x".repeat(2 * 1048576), "big.mp3") });
  assert.equal(r.status, 413); assert.equal(ErrorReplySchema.parse(r.body).message, "That file is larger than 1 MB.");

  /* No Content-Length (a streamed body): the limit is enforced while reading. */
  const req = new Request("http://x/", { method: "POST", body: fileForm(FAKE_AUDIO + "x".repeat(1100 * 1024), "big.mp3") });
  const res = await s.app.request(`/api/lectures/${id}/slides`, { method: "POST", headers: { Authorization: "Bearer " + token, "Content-Type": req.headers.get("content-type")! },
    body: req.body, duplex: "half" } as RequestInit);
  assert.equal(res.status, 413); ErrorReplySchema.parse(await res.json());
  assert.deepEqual(tempFiles(s), []);
  assert.equal(s.store.lecture(id)!.recording_file, null);
});

test("MAX_UPLOAD_MB with a fraction: a bigger file is still a 413, not cut short and kept", async t => {
  const s = setup({ env: { MAX_UPLOAD_MB: "0.3" } }); t.after(() => s.close());   // 314572.8 bytes
  const token = await s.signIn(), id = await newLecture(s, token);
  const req = new Request("http://x/", { method: "POST", body: fileForm(FAKE_AUDIO + "x".repeat(400 * 1024), "big.mp3") });
  const res = await s.app.request(`/api/lectures/${id}/recording`, { method: "POST", headers: { Authorization: "Bearer " + token, "Content-Type": req.headers.get("content-type")! },
    body: req.body, duplex: "half" } as RequestInit);
  assert.equal(res.status, 413);
  assert.equal(s.store.lecture(id)!.recording_file, null);
});

test("not audio is a 415; not a PDF is a 415; no file is a 400; nothing is kept", async t => {
  const s = setup(); t.after(() => s.close());
  const token = await s.signIn(), id = await newLecture(s, token);
  const notAudio = await s.call("POST", `/lectures/${id}/recording`, { token, body: fileForm("hello, just text", "notes.txt") });
  assert.equal(notAudio.status, 415); ErrorReplySchema.parse(notAudio.body);
  const notPdf = await s.call("POST", `/lectures/${id}/slides`, { token, body: fileForm("PK zip file", "slides.pptx") });
  assert.equal(notPdf.status, 415); ErrorReplySchema.parse(notPdf.body);
  const wrongField = await s.call("POST", `/lectures/${id}/recording`, { token, body: fileForm(FAKE_AUDIO, "a.mp3", "audio") });
  assert.equal(wrongField.status, 400); ErrorReplySchema.parse(wrongField.body);
  const notForm = await s.call("POST", `/lectures/${id}/recording`, { token, json: { file: "x" } });
  assert.equal(notForm.status, 400);
  assert.deepEqual(tempFiles(s), []);
  assert.equal(fs.existsSync(path.join(s.dir, "lectures", id)), false);
});

test("a second recording replaces the first; a recording after finish is a 409", async t => {
  const s = setup(); t.after(() => s.close());
  const token = await s.signIn(), id = await newLecture(s, token);
  assert.equal((await s.call("POST", `/lectures/${id}/recording`, { token, body: fileForm(FAKE_AUDIO + "1", "a.mp3") })).status, 204);
  assert.equal((await s.call("POST", `/lectures/${id}/recording`, { token, body: fileForm(FAKE_AUDIO + "2", "b.m4a") })).status, 204);
  assert.deepEqual(fs.readdirSync(path.join(s.dir, "lectures", id)), ["recording"]);   // a fixed name: ffmpeg reads it by content, not by the uploaded name
  assert.equal(fs.readFileSync(path.join(s.dir, "lectures", id, "recording"), "utf8"), FAKE_AUDIO + "2");
  await s.call("POST", `/lectures/${id}/finish`, { token, json: { duration: 10 } });
  await s.pipeline.idle();
  const again = await s.call("POST", `/lectures/${id}/recording`, { token, body: fileForm(FAKE_AUDIO, "c.mp3") });
  assert.equal(again.status, 409); ErrorReplySchema.parse(again.body);
  const slides = await s.call("POST", `/lectures/${id}/slides`, { token, body: fileForm("%PDF-1.4", "s.pdf") });
  assert.equal(slides.status, 409); assert.equal(slides.body.message, "Adding slides to a lecture that already has notes is not available yet.");
});

/* Real HTTP: the browser's XMLHttpRequest is aborted (Cancel upload) or the connection drops part way. */
async function liveServer(s: TestServer) {
  const server = serve({ fetch: s.app.fetch, port: 0 });
  await new Promise(r => server.once("listening", r));
  return { port: (server.address() as AddressInfo).port, close: () => new Promise(r => server.close(r)) };
}
function startUpload(port: number, token: string, id: string, declared: number) {
  const boundary = "----sidenote" + Date.now();
  const head = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="lecture.mp3"\r\nContent-Type: audio/mpeg\r\n\r\n` + FAKE_AUDIO;
  const req = http.request({ port, method: "POST", path: `/api/lectures/${id}/recording`, headers: {
    Authorization: "Bearer " + token, "Content-Type": `multipart/form-data; boundary=${boundary}`, "Content-Length": String(declared) } });
  const reply = new Promise<{ status: number; body: string }>((ok, bad) => {
    req.on("response", res => { let b = ""; res.on("data", d => b += d); res.on("end", () => ok({ status: res.statusCode!, body: b })); });
    req.on("error", bad);
  });
  req.write(head);
  const tail = `\r\n--${boundary}--\r\n`;
  return { req, reply, finish: () => req.end(tail), headLength: Buffer.byteLength(head), tailLength: Buffer.byteLength(tail) };
}

test("an upload cut off part way leaves no file behind and the lecture without a recording", async t => {
  const s = setup(); t.after(() => s.close());
  const live = await liveServer(s); t.after(live.close);
  const token = await s.signIn(), id = await newLecture(s, token);
  const up = startUpload(live.port, token, id, 50_000);
  up.reply.catch(() => {});
  up.req.write("x".repeat(10_000));
  assert.ok(await until(() => tempFiles(s).length === 1), "the upload started");
  up.req.destroy();
  assert.ok(await until(() => tempFiles(s).length === 0), "the partial file is deleted");
  assert.equal(s.store.lecture(id)!.recording_file, null);
  assert.equal(fs.existsSync(path.join(s.dir, "lectures", id)), false);
});

test("Cancel upload: the upload is aborted, then the lecture deleted; nothing is kept", async t => {
  const s = setup(); t.after(() => s.close());
  const live = await liveServer(s); t.after(live.close);
  const token = await s.signIn(), id = await newLecture(s, token);
  const up = startUpload(live.port, token, id, 100_000);
  up.reply.catch(() => {});
  up.req.write("x".repeat(5000));
  assert.ok(await until(() => tempFiles(s).length === 1));
  up.req.destroy();
  assert.equal((await s.call("DELETE", `/lectures/${id}`, { token })).status, 204);
  assert.ok(await until(() => tempFiles(s).length === 0));
  assert.equal(fs.existsSync(path.join(s.dir, "lectures", id)), false);
  assert.equal(s.store.lecture(id), undefined);
});

test("a lecture deleted while its file uploads: the finished upload is refused and its file dropped", async t => {
  const s = setup(); t.after(() => s.close());
  const live = await liveServer(s); t.after(live.close);
  const token = await s.signIn(), id = await newLecture(s, token);
  const filler = "y".repeat(3000);
  const probe = startUpload(live.port, token, id, 1);   // measure the framing, then throw it away
  const total = probe.headLength + filler.length + probe.tailLength; probe.req.destroy(); await probe.reply.catch(() => {});
  const up = startUpload(live.port, token, id, total);
  up.req.write(filler);
  assert.ok(await until(() => tempFiles(s).length === 1));
  assert.equal((await s.call("DELETE", `/lectures/${id}`, { token })).status, 204);
  up.finish();
  const r = await up.reply;
  assert.equal(r.status, 404); ErrorReplySchema.parse(JSON.parse(r.body));
  assert.ok(await until(() => tempFiles(s).length === 0));
  assert.equal(fs.existsSync(path.join(s.dir, "lectures", id)), false);
});
