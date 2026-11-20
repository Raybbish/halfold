/* Live recording with the real ffmpeg (skipped where it is not installed) and real pieces of a browser recording
   (test/fixtures: Chrome's MediaRecorder, webm/Opus and MP4/AAC, 3-second pieces of a 10.9-second recording).
   The speech-to-text service and the notes model are still stubs. */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Ffmpeg } from "../src/media";
import { chunkForm, liveLecture, setup, type TestServer } from "./helpers";

const hasFfmpeg = (() => { try { execFileSync("ffmpeg", ["-version"], { stdio: "ignore" }); return true; } catch { return false; } })();
const skip = !hasFfmpeg && "ffmpeg is not installed";
const here = path.dirname(fileURLToPath(import.meta.url));
const FORMATS = [
  { name: "webm", dir: path.join(here, "fixtures", "live-webm"), type: "audio/webm;codecs=opus" },
  { name: "mp4", dir: path.join(here, "fixtures", "live-mp4"), type: "audio/mp4;codecs=mp4a.40.2" }
];
const LENGTH = 10.9;
const near = (a: number, b: number, by = 0.3) => assert.ok(Math.abs(a - b) <= by, `${a} is not about ${b}`);
const piece = (dir: string, seq: number) => new Uint8Array(fs.readFileSync(path.join(dir, String(seq).padStart(6, "0"))));
const length = (file: string) => Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]).toString());

test("cutSpeech: any part of the joined pieces, including a prefix that ends inside a cluster; a header alone is 0 s", { skip }, async () => {
  const m = new Ffmpeg(), out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "sn-cut-")), "w.m4a");
  for (const f of FORMATS) {
    const parts = fs.readdirSync(f.dir).sort();
    near(await m.cutSpeech(f.dir, parts, out, { from: 0 }), LENGTH);
    near(await m.cutSpeech(f.dir, parts, out, { from: 6 }), LENGTH - 6);
    near(await m.cutSpeech(f.dir, parts, out, { from: 2, to: 5 }), 3);
    /* What has arrived after two pieces: readable up to where the second one stops. */
    const two = await m.cutSpeech(f.dir, parts.slice(0, 2), out, { from: 0 });
    assert.ok(two > 2 && two < 9, `${f.name}: ${two}`);
  }
  assert.equal(await m.cutSpeech(FORMATS[1].dir, ["000000"], out, { from: 0 }), 0);   // MP4: the first piece is only the header
});

async function record(s: TestServer, token: string, f: typeof FORMATS[number], order: number[]) {
  const id = await liveLecture(s, token);
  for (const seq of order) {
    const r = await s.call("POST", `/lectures/${id}/chunks`, { token, body: chunkForm(piece(f.dir, seq), seq, f.type) });
    assert.equal(r.status, 200, `${f.name} chunk ${seq}: ${r.text}`);
  }
  await s.live.idle();
  return id;
}

for (const f of FORMATS) {
  test(`${f.name}: chunks out of order and twice become one seekable recording of the right length, played by range`, { skip }, async t => {
    /* What is converted is kept here: the joined recording itself is deleted once the notes are written. */
    const media = new Ffmpeg(), toSpeech = media.toSpeechAudio.bind(media); let joined: Buffer | null = null;
    media.toSpeechAudio = (input, output, o) => { joined = fs.readFileSync(input); return toSpeech(input, output, o); };
    const s = setup({ media }); t.after(() => s.close());
    const token = await s.signIn(), id = await record(s, token, f, [2, 0, 3, 1, 1, 0]);
    near(s.store.lecture(id)!.live_audio, LENGTH);
    await s.call("POST", `/lectures/${id}/finish`, { token, json: { duration: 11 } }); await s.pipeline.idle();
    const l = s.store.lecture(id)!;
    assert.equal(l.status, "ready", l.error ?? "");
    near(l.duration!, LENGTH);
    const audio = s.files.path(id, "audio.m4a");
    near(length(audio), LENGTH);
    /* The joined recording is the pieces in order, byte for byte. */
    assert.deepEqual(new Uint8Array(joined!), new Uint8Array(Buffer.concat([0, 1, 2, 3].map(i => piece(f.dir, i)))));
    assert.equal(s.files.exists(id, "recording"), false);
    /* faststart: the index is at the front, so the player can seek before the whole file has come. */
    const bytes = fs.readFileSync(audio).toString("latin1");
    assert.ok(bytes.indexOf("moov") > 0 && bytes.indexOf("moov") < 64 && bytes.indexOf("moov") < bytes.indexOf("mdat"), "moov comes first");
    const url = (await s.call("GET", `/lectures/${id}`, { token })).body.detail.audio.url;
    const r = await s.app.request(url, { headers: { Range: "bytes=100-199" } });
    assert.equal(r.status, 206); assert.equal((await r.arrayBuffer()).byteLength, 100);
  });

  test(`${f.name}: a piece that never arrived becomes silence and the rest keeps its time`, { skip }, async t => {
    const s = setup({ media: new Ffmpeg() }); t.after(() => s.close());
    const token = await s.signIn(), id = await record(s, token, f, [0, 1, 3]);
    await s.call("POST", `/lectures/${id}/finish`, { token, json: { duration: 11 } }); await s.pipeline.idle();
    const l = s.store.lecture(id)!;
    assert.equal(l.status, "ready", l.error ?? "");
    near(l.duration!, LENGTH, 0.5);
  });
}
