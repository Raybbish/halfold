/* Playing back the kept recording (INTEGRATION.md section 4). detail.audio.url is a link signed for this lecture that
   works for AUDIO_LINK_HOURS: the <audio> element cannot send the sign-in token, and the front end asks for a fresh
   link (GET /lectures/:id) when one stops working. The file is audio.m4a (AAC, faststart), sent with HTTP Range so the
   player can jump to any second without downloading what comes before.
   With R2 set, the recording of a lecture with notes is in the bucket (files.ts): the same link then answers with a
   redirect to a presigned R2 link that works until this one expires. R2 answers Range itself, and the server does not
   carry the audio. The link the front end gets does not change.
   How long recordings are kept depends on the student's plan (plans.json audioDays, INTEGRATION.md 4.4): null keeps
   them for good and sends neither field; N keeps them N days (detail.audio.keptUntil), then the files are deleted and
   detail.audio is {expired: true}. The N days count from the day of the lecture, but never from before the student's
   paid time ended (a lapsed plan: its recordings stay N more days) or before plans began on this server. Only lectures
   with notes lose their recording: a failed or unfinished lecture still needs it to write the notes. */
import fs from "node:fs";
import fsp from "node:fs/promises";
import { Readable } from "node:stream";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { Audio } from "../../src/types";
import type { Config } from "./config";
import type { LectureRow, Store } from "./db";
import type { FileStore, Moved } from "./files";
import type { Billing } from "./billing";
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

type Keep = { config: Config; store: Store; billing: Billing };

/* The last day the recording is kept, in the students' time zone; null when kept for good. */
export function keptUntil(d: Keep, l: LectureRow, now = new Date()) {
  const ent = d.billing.entitlement(l.user_id, now), days = ent.tier.audioDays;
  if (days === null) return null;
  const tz = d.config.timezone;
  let from = localDate(new Date(l.created_at), tz);
  for (const at of [d.store.plansSince(), ent.paidEnd]) if (at) { const day = localDate(new Date(at), tz); if (day > from) from = day; }
  return addDays(from, days);
}

/* detail.audio for a lecture with notes: a fresh link, the keep date, or "expired". null when there is no recording to play. */
export function audioView(d: Keep & { files: FileStore }, l: LectureRow, now = new Date()): Audio | null {
  if (l.audio_expired) return { expired: true };
  if (!d.files.exists(l.id, AUDIO)) return null;
  const until = keptUntil(d, l, now);
  return { url: audioLink(d.config, d.store, l.id, now), ...(until ? { keptUntil: until } : {}) };
}

/* Deletes the recordings of lectures with notes whose keep date has passed. Runs at start and every few hours. */
export async function sweepAudio(d: Keep & { files: FileStore }, now = new Date()) {
  const { config, store, files } = d;
  if (config.plans.plans.every(p => p.audioDays === null)) return 0;
  const today = localDate(now, config.timezone);
  let n = 0;
  for (const l of store.readyLecturesWithAudio()) {
    const until = keptUntil(d, l, now);
    if (!until || today <= until) continue;
    store.setAudioExpired(l.id);
    await files.remove(l.id, AUDIO); await files.remove(l.id, "recording"); await files.removeChunks(l.id);
    n++;
  }
  return n;
}

/* Deletes the original file of lectures with notes: those written before the pipeline deleted it with the notes
   (pipeline.ts step 6), and any it could not delete then. Only where audio.m4a is there: without it the original is the
   only copy. Lectures that failed or are still being written keep theirs. Runs at start and every few hours. */
export async function sweepOriginals(d: { store: Store; files: FileStore }) {
  let n = 0;
  for (const l of d.store.lecturesWithStatus("ready")) {
    if (!l.recording_file || !d.files.exists(l.id, l.recording_file) || !d.files.exists(l.id, AUDIO)) continue;
    await d.files.remove(l.id, l.recording_file); n++;
  }
  return n;
}

/* With R2 set: moves the kept files (audio.m4a, slides.pdf) of lectures with notes that are still on this disk (the
   upload when the notes were written failed; lectures from before R2), and deletes from R2 what could not be deleted
   before. Stops at the first lecture that cannot be moved (R2 is probably down) unless `all`. Runs at start and every
   few hours; npm run move-to-r2 runs it by hand, with `report`. */
export async function sweepKept(d: { store: Store; files: FileStore }, o: { all?: boolean; report?: (id: string, r: Moved[] | Error) => void } = {}) {
  let moved = 0, failed = 0;
  if (!d.files.bucket) return { moved, failed, deleted: 0 };
  for (const l of d.store.lecturesWithStatus("ready")) {
    if (!d.files.pending(l.id).length) continue;
    try { const m = await d.files.archive(l.id); moved += m.length; o.report?.(l.id, m); }
    catch (e) {
      failed++; o.report?.(l.id, e as Error);
      if (!o.all) { console.warn(`[sidenote] the kept files of ${l.id} could not be moved to R2 (tried again in six hours): ${(e as Error).message}`); break; }
    }
  }
  return { moved, failed, deleted: await d.files.retryDeletes() };
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
