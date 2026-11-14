/* Playing back the kept recording (INTEGRATION.md section 4). detail.audio.url is a link signed for this lecture that
   works for AUDIO_LINK_HOURS: the <audio> element cannot send the sign-in token, and the front end asks for a fresh
   link (GET /lectures/:id) when one stops working. The file is audio.m4a (AAC, faststart), sent with HTTP Range so the
   player can jump to any second without downloading what comes before.
   AUDIO_KEEP_DAYS > 0 keeps recordings that many days after the lecture: detail.audio.keptUntil, then the files are
   deleted and detail.audio is {expired: true}. Only lectures with notes lose their recording: a failed or unfinished
   lecture still needs it to write the notes (4.4). 0, the default, keeps everything and sends neither field. */
import fs from "node:fs";
import fsp from "node:fs/promises";
import { Readable } from "node:stream";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { Audio } from "../../src/types";
import type { Config } from "./config";
import type { LectureRow, Store } from "./db";
import type { FileStore } from "./files";
import { localDate } from "./time";

export const AUDIO = "audio.m4a";

const sign = (secret: string, id: string, exp: number) => createHmac("sha256", secret).update(`audio:${id}:${exp}`).digest("base64url").slice(0, 32);

export function audioLink(config: Config, store: Store, id: string, now = new Date()) {
  const exp = Math.floor(now.getTime() / 1000) + Math.round(config.audioLinkHours * 3600);
  return `${config.publicUrl}/api/lectures/${encodeURIComponent(id)}/audio?exp=${exp}&sig=${sign(store.secret(), id, exp)}`;
}

export function linkIsValid(store: Store, id: string, exp: string | undefined, sig: string | undefined, now = new Date()) {
  const e = Number(exp);
  if (!sig || !Number.isInteger(e) || e < now.getTime() / 1000) return false;
  const want = Buffer.from(sign(store.secret(), id, e)), got = Buffer.from(sig);
  return want.length === got.length && timingSafeEqual(want, got);
}

/* "YYYY-MM-DD" plus days. */
export function addDays(ymd: string, days: number) {
  const d = new Date(ymd + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/* The last day the recording is kept, counted from the day of the lecture in the students' time zone; null when kept for good. */
export function keptUntil(config: Config, l: LectureRow) {
  return config.audioKeepDays > 0 ? addDays(localDate(new Date(l.created_at), config.timezone), config.audioKeepDays) : null;
}

/* detail.audio for a lecture with notes: a fresh link, the keep date, or "expired". null when there is no recording to play. */
export function audioView(config: Config, store: Store, files: FileStore, l: LectureRow, now = new Date()): Audio | null {
  if (l.audio_expired) return { expired: true };
  if (!files.exists(l.id, AUDIO)) return null;
  const until = keptUntil(config, l);
  return { url: audioLink(config, store, l.id, now), ...(until ? { keptUntil: until } : {}) };
}

/* Deletes the recordings of lectures with notes whose keep date has passed. Runs at start and every few hours. */
export async function sweepAudio(config: Config, store: Store, files: FileStore, now = new Date()) {
  if (config.audioKeepDays <= 0) return 0;
  const today = localDate(now, config.timezone);
  let n = 0;
  for (const l of store.readyLecturesWithAudio()) {
    const until = keptUntil(config, l);
    if (!until || today <= until) continue;
    store.setAudioExpired(l.id);
    await files.remove(l.id, AUDIO); await files.remove(l.id, "recording"); await files.removeChunks(l.id);
    n++;
  }
  return n;
}

/* The file, whole (200) or one byte range (206). A range that does not fit is 416; several ranges get the whole file. */
export async function sendFile(req: Request, file: string, type: string, extra: Record<string, string> = {}): Promise<Response> {
  const size = (await fsp.stat(file)).size;
  const headers: Record<string, string> = { "Content-Type": type, "Accept-Ranges": "bytes", ...extra };
  let start = 0, end = size - 1, status = 200;
  const m = /^bytes=(\d*)-(\d*)$/.exec((req.headers.get("range") || "").trim());
  if (m && (m[1] || m[2])) {
    if (m[1]) { start = Number(m[1]); end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1; }
    else { start = Math.max(0, size - Number(m[2])); }
    if (start >= size || start > end) return new Response(null, { status: 416, headers: { ...headers, "Content-Range": `bytes */${size}` } });
    status = 206; headers["Content-Range"] = `bytes ${start}-${end}/${size}`;
  }
  headers["Content-Length"] = String(size ? end - start + 1 : 0);
  if (req.method === "HEAD" || !size) return new Response(null, { status, headers });
  const body = Readable.toWeb(fs.createReadStream(file, { start, end })) as unknown as ReadableStream;
  return new Response(body, { status, headers });
}
