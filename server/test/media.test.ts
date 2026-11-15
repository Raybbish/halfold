/* The real ffmpeg (skipped where it is not installed), slide text from a real PDF, and the front end served with its settings. */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { Ffmpeg } from "../src/media";
import { readSlides } from "../src/slides";
import { createApp } from "../src/app";
import { setup } from "./helpers";

const hasFfmpeg = (() => { try { execFileSync("ffmpeg", ["-version"], { stdio: "ignore" }); return true; } catch { return false; } })();
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "sn-media-"));

test("ffmpeg: a video file becomes a mono M4A of the same length; text is not audio", { skip: !hasFfmpeg && "ffmpeg is not installed" }, async () => {
  const dir = tmp(), video = path.join(dir, "class.mp4"), out = path.join(dir, "audio.m4a");
  execFileSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=3", "-f", "lavfi", "-i", "color=c=black:s=64x64:d=3",
    "-c:a", "aac", "-c:v", "libx264", "-shortest", video]);
  const m = new Ffmpeg();
  const info = await m.probe(video);
  assert.ok(info && info.hasAudio && Math.abs(info.duration - 3) < 0.2);
  await m.toSpeechAudio(video, out);
  const probe = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-print_format", "json", "-show_streams", out]).toString());
  assert.deepEqual(probe.streams.map((s: { codec_type: string }) => s.codec_type), ["audio"]);
  assert.equal(probe.streams[0].channels, 1); assert.equal(probe.streams[0].codec_name, "aac");
  fs.writeFileSync(path.join(dir, "notes.txt"), "not audio");
  assert.equal(await m.probe(path.join(dir, "notes.txt")), null);
  /* A file with only video has no audio to transcribe. */
  const silent = path.join(dir, "silent.mp4");
  execFileSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "color=c=black:s=64x64:d=1", "-c:v", "libx264", silent]);
  assert.equal((await m.probe(silent))!.hasAudio, false);
});

/* A two-page PDF written by hand, with correct offsets. */
function pdf(pages: string[]) {
  const objs: string[] = [];
  objs.push("<< /Type /Catalog /Pages 2 0 R >>");
  objs.push(`<< /Type /Pages /Kids [${pages.map((_, i) => `${4 + i * 2} 0 R`).join(" ")}] /Count ${pages.length} >>`);
  objs.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  pages.forEach((text, i) => {
    const stream = `BT /F1 24 Tf 72 700 Td (${text}) Tj ET`;
    objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + i * 2} 0 R >>`);
    objs.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  });
  let out = "%PDF-1.4\n"; const offsets: number[] = [];
  objs.forEach((o, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offsets.map(o => String(o).padStart(10, "0") + " 00000 n \n").join("");
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return out;
}

test("readSlides: the text of each page", async () => {
  const f = path.join(tmp(), "slides.pdf");
  fs.writeFileSync(f, pdf(["Opportunity cost", "Sunk costs"]));
  assert.deepEqual(await readSlides(f), [{ n: 1, text: "Opportunity cost" }, { n: 2, text: "Sunk costs" }]);
});

test("the built front end is served at / with USE_MOCK off, assets by path, nothing outside the folder", async t => {
  const web = tmp();
  fs.mkdirSync(path.join(web, "assets"));
  fs.writeFileSync(path.join(web, "index.html"), '<html><head><title>x</title>\n  <script type="module" crossorigin src="./assets/index-1.js"></script>\n</head><body></body></html>');
  fs.writeFileSync(path.join(web, "assets", "index-1.js"), "console.log(1)");
  fs.writeFileSync(path.join(path.dirname(web), "secret.txt"), "secret");
  const s = setup(); t.after(() => s.close());
  const app = createApp({ config: { ...s.config, webDir: web }, store: s.store, files: s.files, media: s.media, jobs: s.pipeline, live: s.live, catchUp: s.catchUp, packs: s.packs, billing: s.billing, mailer: s.mailer });
  const page = await (await app.request("/")).text();
  const cfg = `<script>window.SIDENOTE_CONFIG = ${JSON.stringify({ USE_MOCK: false, API_BASE: "/api", EXAMPLE_SHARE_ID: null, SIGN_IN: "email" })};</script>`;
  assert.ok(page.indexOf(cfg) >= 0 && page.indexOf(cfg) < page.indexOf('<script type="module"'), "settings come before the app's script");
  /* EXAMPLE_SHARE_ID: "Example notes" on the public pages opens that shared lecture. */
  const example = createApp({ config: { ...s.config, webDir: web, exampleShareId: "Ab12Cd34" }, store: s.store, files: s.files, media: s.media, jobs: s.pipeline, live: s.live, catchUp: s.catchUp, packs: s.packs, billing: s.billing, mailer: s.mailer });
  assert.ok((await (await example.request("/")).text()).includes('"EXAMPLE_SHARE_ID":"Ab12Cd34"'));
  const js = await app.request("/assets/index-1.js");
  assert.equal(js.status, 200); assert.match(js.headers.get("content-type")!, /javascript/); assert.equal(await js.text(), "console.log(1)");
  assert.equal((await app.request("/assets/..%2F..%2Fsecret.txt")).status, 404);
  assert.equal((await app.request("/assets/missing.js")).status, 404);
  /* The API is still under /api. */
  assert.equal((await app.request("/api/home")).status, 401);
});
