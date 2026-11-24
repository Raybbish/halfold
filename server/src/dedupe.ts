/* The same class recorded by several students (handoff of 2026-11-23, item 3, stage 1). A recording that is the same as
   one already transcribed reuses that transcript, and the notes written from it, instead of paying for both again.
   What the student sees does not change: the lecture is their own, with their own copy of the transcript and notes,
   which they edit, share and delete as before (deleting the first student's lecture leaves the copies as they are).

   The same recording means, all three (better to miss a merge than make a wrong one):
   - the same file: an upload with the same bytes (SHA-256 of the file as it was uploaded), or a link to the same
     YouTube video. Links to other sites are not matched: the file behind a Drive, Vimeo or plain .mp4 link can be
     replaced, a YouTube video cannot (it can be trimmed, which the length catches);
   - the same class language, which is given to the speech-to-text service and decides the Chinese script;
   - the same length, within SAME_LENGTH seconds.
   Live recordings are not matched here (stage 3 of the handoff).

   What is copied is what the services wrote: the transcript, and the notes as the model wrote them
   (details.original_json), never another student's edits, own points, slides, title, progress or feedback. The
   student had the same file or the same public video, so they get nothing they could not already get. The notes are
   copied only when neither lecture's notes were written with slides; a lecture with slides of its own copies the
   transcript and has its notes written with its slides.

   A link lecture still downloads its own file and every lecture converts its own audio (local work, nothing paid):
   the student plays their own recording, and a link that no longer opens fails as it did. The match is made after
   that, just before transcribing (pipeline.ts). While another lecture is transcribing the same recording, this one
   waits for it (still "processing") instead of transcribing too, and runs again when that one ends: then it copies the
   result, or, if that lecture failed or was deleted, does the work itself.

   A reused lecture logs no transcription or notes cost, and counts against the month's lectures as any other
   (startProcessing): the quota rules are not decided yet. Each lecture with notes gets a row in class_recordings
   (db.ts), kept after it is deleted, for the recordings per class and the merge rate (npm run costs). */
import type { ClassRecordingRow, LectureRow } from "./db";

/* Lengths of the same recording read by ffprobe agree to well under a second, even from two downloads. */
export const SAME_LENGTH = 2;

export const fileKey = (sha256: string) => `file:${sha256}`;

/* YouTube links to one video: watch?v=, youtu.be/, shorts/, live/, embed/, on www., m., music. and youtube-nocookie.com.
   Other parameters (t=, si=, list=) do not change the video. A clip (/clip/) is part of a video and is not matched. */
const YOUTUBE_HOST = /^(?:(?:www|m|music)\.)?youtube\.com$|^(?:www\.)?youtube-nocookie\.com$/;
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
export function linkKey(raw: string): string | null {
  let u: URL;
  try { u = new URL(raw.trim()); } catch { return null; }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  const host = u.hostname.toLowerCase().replace(/\.$/, ""), parts = u.pathname.split("/").filter(Boolean);
  let id: string | null = null;
  if (host === "youtu.be" || host === "www.youtu.be") id = parts.length === 1 ? parts[0] : null;
  else if (YOUTUBE_HOST.test(host)) {
    if (parts.length === 1 && parts[0] === "watch") id = u.searchParams.get("v");
    else if (parts.length === 2 && ["shorts", "live", "embed", "v"].includes(parts[0])) id = parts[1];
  }
  return id && VIDEO_ID.test(id) ? `youtube:${id}` : null;
}

/* What makes two lectures the same recording for transcribing, or null when this lecture is never matched. */
export const matchKey = (l: Pick<LectureRow, "content_key" | "language">) => l.content_key ? `${l.content_key} ${l.language}` : null;

export const sameLength = (a: number | null, b: number) => a != null && Math.abs(a - b) <= SAME_LENGTH;

/* Which lecture is transcribing each recording now, and the lectures waiting for it (pipeline.ts). Kept in memory: after
   a restart every lecture left processing runs again, and the first to get this far claims the recording again. */
export class SameRecording {
  private readonly working = new Map<string, string>();          // match key -> the lecture transcribing it
  private readonly waiting = new Map<string, Set<string>>();     // match key -> lectures waiting for it

  /* true: this lecture goes on (nobody else is working on the recording). false: another lecture is; this one is
     returned by release() when that one's run ends. */
  claim(key: string, id: string) {
    const holder = this.working.get(key);
    if (holder === undefined || holder === id) { this.working.set(key, id); return true; }
    this.waiting.set(key, (this.waiting.get(key) ?? new Set()).add(id));
    return false;
  }
  /* The run of `id` ended (notes written, failed or deleted): the lectures that were waiting for it, to run again. */
  release(key: string, id: string): string[] {
    if (this.working.get(key) !== id) return [];
    this.working.delete(key);
    const woken = [...this.waiting.get(key) ?? []];
    this.waiting.delete(key);
    return woken;
  }
  /* A lecture deleted while it waited. */
  forget(id: string) { for (const ids of this.waiting.values()) ids.delete(id); }
}

/* For npm run costs (handoff item 8): how many recordings each class had and how many were merged, from class_recordings.
   matchable: lectures that could have been matched (an upload, or a YouTube link). sizes: [recordings in a class, classes]. */
export function classStats(rows: Pick<ClassRecordingRow, "class_id" | "match_on" | "reused">[]) {
  const perClass = new Map<string, number>(), sizes = new Map<number, number>();
  for (const r of rows) perClass.set(r.class_id, (perClass.get(r.class_id) ?? 0) + 1);
  for (const n of perClass.values()) sizes.set(n, (sizes.get(n) ?? 0) + 1);
  return {
    lectures: rows.length, matchable: rows.filter(r => r.match_on).length,
    merged: rows.filter(r => r.reused !== "none").length, notesCopied: rows.filter(r => r.reused === "notes").length,
    classes: perClass.size, sizes: [...sizes].sort((a, b) => a[0] - b[0])
  };
}
