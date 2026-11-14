/* The database: SQLite through node:sqlite (built into Node, no native build). Everything the routes and the
   pipeline store goes through Store, so another database means rewriting this file only. */
import { DatabaseSync } from "node:sqlite";
import { createHash, randomBytes } from "node:crypto";
import type { Alert, Detail, Line, LectureStatus, Source } from "../../src/types";
import type { ClassLanguage } from "./config";

export interface UserRow { id: string; invite_code: string; name: string; class_language: string; zh_default: number; zh_script: string | null }
export interface CourseRow { id: string; user_id: string; code: string; name: string; color: string | null; created_at: string }
export interface LectureRow {
  id: string; user_id: string; course_id: string; title: string; language: ClassLanguage; source: Source; status: LectureStatus;
  duration: number | null; client_duration: number | null; recording_file: string | null; has_slides: number; error: string | null;
  created_at: string; finished_at: string | null;
  /* Live recordings (phase 2). live_from: where the next live transcription round starts, in seconds. live_audio: seconds
     of audio received so far. live_limit: 0, 1 = warned that today's minutes are nearly used, 2 = no more audio taken.
     chunk_bytes: bytes of audio received. audio_expired: the recording was deleted after AUDIO_KEEP_DAYS. */
  live_from: number; live_audio: number; live_limit: number; chunk_bytes: number; audio_expired: number;
  live_held: string | null;   // JSON words of a sentence not finished at the end of the last round (live/windows.ts holdUnfinished)
}
export interface UpcomingRow { lecture_id: string; date: string; kind: string; text: string; t: number; course_code: string }
export interface CostEntry {
  lectureId: string; userId: string | null; stage: "stt" | "notes" | "live" | "catchup"; provider: string; model: string;
  audioSeconds?: number | null; inputTokens?: number | null; cachedInputTokens?: number | null; outputTokens?: number | null;
  reasoningTokens?: number | null; usd: number | null; meta?: Record<string, unknown>;
}
export interface CostRow {
  id: number; lecture_id: string; user_id: string | null; stage: string; provider: string; model: string; audio_seconds: number | null;
  input_tokens: number | null; cached_input_tokens: number | null; output_tokens: number | null; reasoning_tokens: number | null;
  usd: number | null; meta_json: string | null; created_at: string;
}

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, invite_code TEXT NOT NULL UNIQUE, name TEXT NOT NULL DEFAULT '',
  class_language TEXT NOT NULL DEFAULT 'en', zh_default INTEGER NOT NULL DEFAULT 0, zh_script TEXT, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS courses (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, code TEXT NOT NULL, name TEXT NOT NULL DEFAULT '',
  color TEXT, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS lectures (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  title TEXT NOT NULL, language TEXT NOT NULL, source TEXT NOT NULL, status TEXT NOT NULL, duration REAL, client_duration REAL,
  recording_file TEXT, has_slides INTEGER NOT NULL DEFAULT 0, error TEXT, created_at TEXT NOT NULL, finished_at TEXT);
CREATE INDEX IF NOT EXISTS lectures_user ON lectures(user_id, created_at);
CREATE TABLE IF NOT EXISTS transcripts (
  lecture_id TEXT PRIMARY KEY REFERENCES lectures(id) ON DELETE CASCADE, provider TEXT NOT NULL, model TEXT NOT NULL,
  lines_json TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS details (
  lecture_id TEXT PRIMARY KEY REFERENCES lectures(id) ON DELETE CASCADE, detail_json TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS upcoming (
  lecture_id TEXT NOT NULL REFERENCES lectures(id) ON DELETE CASCADE, date TEXT NOT NULL, kind TEXT NOT NULL, text TEXT NOT NULL, t REAL NOT NULL);
CREATE TABLE IF NOT EXISTS chunks (
  lecture_id TEXT NOT NULL REFERENCES lectures(id) ON DELETE CASCADE, seq INTEGER NOT NULL, bytes INTEGER NOT NULL, created_at TEXT NOT NULL,
  PRIMARY KEY (lecture_id, seq));
CREATE TABLE IF NOT EXISTS live_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT, lecture_id TEXT NOT NULL REFERENCES lectures(id) ON DELETE CASCADE, t REAL NOT NULL, text TEXT NOT NULL, sent_seq INTEGER);
CREATE INDEX IF NOT EXISTS live_lines_lecture ON live_lines(lecture_id, t);
CREATE TABLE IF NOT EXISTS live_alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT, lecture_id TEXT NOT NULL REFERENCES lectures(id) ON DELETE CASCADE, t REAL NOT NULL, kind TEXT NOT NULL, text TEXT NOT NULL, sent_seq INTEGER);
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS costs (
  id INTEGER PRIMARY KEY AUTOINCREMENT, lecture_id TEXT NOT NULL, user_id TEXT, stage TEXT NOT NULL, provider TEXT NOT NULL, model TEXT NOT NULL,
  audio_seconds REAL, input_tokens INTEGER, cached_input_tokens INTEGER, output_tokens INTEGER, reasoning_tokens INTEGER, usd REAL,
  meta_json TEXT, created_at TEXT NOT NULL);
`;

const now = () => new Date().toISOString();
export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
const ALPHA = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
/* Ids use letters and digits only (INTEGRATION.md section 1: ids are letters, digits, _ and -). */
export function randomId(len: number) { const b = randomBytes(len); let s = ""; for (let i = 0; i < len; i++) s += ALPHA[b[i] % ALPHA.length]; return s; }
const normCode = (code: string) => code.trim().toLowerCase();

/* Columns added after phase 1, added in place to an existing database. */
const ADDED: [string, string, string][] = [
  ["lectures", "live_from", "REAL NOT NULL DEFAULT 0"], ["lectures", "live_audio", "REAL NOT NULL DEFAULT 0"],
  ["lectures", "live_limit", "INTEGER NOT NULL DEFAULT 0"], ["lectures", "chunk_bytes", "INTEGER NOT NULL DEFAULT 0"],
  ["lectures", "audio_expired", "INTEGER NOT NULL DEFAULT 0"], ["lectures", "live_held", "TEXT"]
];

export interface LiveRound { from: number; next: number; audioEnd: number; lines: Line[]; alerts: Alert[]; held: unknown[] }

export class Store {
  readonly db: DatabaseSync;
  constructor(file: string) {
    this.db = new DatabaseSync(file); this.db.exec(SCHEMA);
    for (const [table, col, type] of ADDED) {
      const have = (this.db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).some(c => c.name === col);
      if (!have) this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${type}`);
    }
  }
  close() { this.db.close(); }
  private tx<T>(fn: () => T): T {
    this.db.exec("BEGIN");
    try { const r = fn(); this.db.exec("COMMIT"); return r; } catch (e) { this.db.exec("ROLLBACK"); throw e; }
  }

  /* The key that signs playback links, made once and kept, so links still work after a restart. */
  secret() {
    const r = this.db.prepare("SELECT value FROM meta WHERE key = 'link_secret'").get() as { value: string } | undefined;
    if (r) return r.value;
    this.db.prepare("INSERT OR IGNORE INTO meta (key, value) VALUES ('link_secret', ?)").run(randomBytes(32).toString("base64url"));
    return (this.db.prepare("SELECT value FROM meta WHERE key = 'link_secret'").get() as { value: string }).value;
  }

  /* ---- users and sessions ---- */
  addInviteCode(code: string, name = ""): UserRow {
    const c = normCode(code); if (!c) throw new Error("empty invite code");
    this.db.prepare("INSERT OR IGNORE INTO users (id, invite_code, name, created_at) VALUES (?, ?, ?, ?)").run("u" + randomId(12), c, name, now());
    return this.userByCode(c)!;
  }
  userByCode(code: string) { return this.db.prepare("SELECT * FROM users WHERE invite_code = ?").get(normCode(code)) as UserRow | undefined; }
  listUsers() { return this.db.prepare("SELECT * FROM users ORDER BY created_at").all() as unknown as UserRow[]; }
  setUserName(id: string, name: string) { this.db.prepare("UPDATE users SET name = ? WHERE id = ?").run(name, id); }
  createSession(userId: string) { const token = randomBytes(32).toString("base64url"); this.db.prepare("INSERT INTO sessions (token_hash, user_id, created_at) VALUES (?, ?, ?)").run(hashToken(token), userId, now()); return token; }
  userByToken(token: string) {
    return this.db.prepare("SELECT users.* FROM sessions JOIN users ON users.id = sessions.user_id WHERE sessions.token_hash = ?").get(hashToken(token)) as UserRow | undefined;
  }

  /* ---- courses ---- */
  createCourse(userId: string, id: string, code: string, name: string, color: string | null): CourseRow {
    this.db.prepare("INSERT INTO courses (id, user_id, code, name, color, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(id, userId, code, name, color, now());
    return this.course(userId, id)!;
  }
  course(userId: string, id: string) { return this.db.prepare("SELECT * FROM courses WHERE id = ? AND user_id = ?").get(id, userId) as CourseRow | undefined; }
  courseExists(id: string) { return !!this.db.prepare("SELECT 1 FROM courses WHERE id = ?").get(id); }
  courses(userId: string) { return this.db.prepare("SELECT * FROM courses WHERE user_id = ? ORDER BY created_at").all(userId) as unknown as CourseRow[]; }

  /* ---- lectures ---- */
  createLecture(l: Pick<LectureRow, "id" | "user_id" | "course_id" | "title" | "language" | "source">): LectureRow {
    this.db.prepare("INSERT INTO lectures (id, user_id, course_id, title, language, source, status, created_at) VALUES (?, ?, ?, ?, ?, ?, 'recording', ?)")
      .run(l.id, l.user_id, l.course_id, l.title, l.language, l.source, now());
    return this.lecture(l.id)!;
  }
  lecture(id: string) { return this.db.prepare("SELECT * FROM lectures WHERE id = ?").get(id) as LectureRow | undefined; }
  userLecture(userId: string, id: string) { return this.db.prepare("SELECT * FROM lectures WHERE id = ? AND user_id = ?").get(id, userId) as LectureRow | undefined; }
  lectures(userId: string) { return this.db.prepare("SELECT * FROM lectures WHERE user_id = ? ORDER BY created_at DESC, rowid DESC").all(userId) as unknown as LectureRow[]; }
  lecturesWithStatus(status: LectureStatus) { return this.db.prepare("SELECT * FROM lectures WHERE status = ?").all(status) as unknown as LectureRow[]; }
  setRecording(id: string, file: string) { this.db.prepare("UPDATE lectures SET recording_file = ? WHERE id = ?").run(file, id); }
  setHasSlides(id: string) { this.db.prepare("UPDATE lectures SET has_slides = 1 WHERE id = ?").run(id); }
  setDuration(id: string, seconds: number) { this.db.prepare("UPDATE lectures SET duration = ? WHERE id = ?").run(seconds, id); }
  /* Moves a lecture to processing only from the given states; false when it was not in one of them (someone else moved it first). */
  startProcessing(id: string, from: LectureStatus[], clientDuration?: number | null) {
    const marks = from.map(() => "?").join(",");
    const r = this.db.prepare(`UPDATE lectures SET status = 'processing', error = NULL, finished_at = COALESCE(finished_at, ?), client_duration = COALESCE(?, client_duration) WHERE id = ? AND status IN (${marks})`)
      .run(now(), clientDuration ?? null, id, ...from);
    return Number(r.changes) > 0;
  }
  setFailed(id: string, error: string) { this.db.prepare("UPDATE lectures SET status = 'failed', error = ? WHERE id = ?").run(error.slice(0, 2000), id); }
  deleteLecture(id: string) { this.db.prepare("DELETE FROM lectures WHERE id = ?").run(id); }
  /* Live recordings (record, tab) started since a time, for the daily limit. */
  liveLecturesSince(userId: string, sinceIso: string) {
    return this.db.prepare("SELECT * FROM lectures WHERE user_id = ? AND source IN ('record', 'tab') AND created_at >= ?").all(userId, sinceIso) as unknown as LectureRow[];
  }

  /* ---- live recording: chunks, the live transcript and its alerts ---- */
  /* false when this (lecture, seq) was already there: the browser sent it again. */
  addChunk(lectureId: string, seq: number, bytes: number) {
    return this.tx(() => {
      const r = this.db.prepare("INSERT OR IGNORE INTO chunks (lecture_id, seq, bytes, created_at) VALUES (?, ?, ?, ?)").run(lectureId, seq, bytes, now());
      if (!Number(r.changes)) return false;
      this.db.prepare("UPDATE lectures SET chunk_bytes = chunk_bytes + ? WHERE id = ?").run(bytes, lectureId);
      return true;
    });
  }
  hasChunk(lectureId: string, seq: number) { return !!this.db.prepare("SELECT 1 FROM chunks WHERE lecture_id = ? AND seq = ?").get(lectureId, seq); }
  chunkSeqs(lectureId: string) { return (this.db.prepare("SELECT seq FROM chunks WHERE lecture_id = ? ORDER BY seq").all(lectureId) as { seq: number }[]).map(r => r.seq); }
  /* Saves one live transcription round, unless the lecture is gone or another round already moved on from `from`. */
  saveLiveRound(lectureId: string, r: LiveRound) {
    return this.tx(() => {
      const l = this.lecture(lectureId);
      if (!l || l.live_from !== r.from) return false;
      const line = this.db.prepare("INSERT INTO live_lines (lecture_id, t, text) VALUES (?, ?, ?)");
      for (const x of r.lines) line.run(lectureId, x.t, x.text);
      const alert = this.db.prepare("INSERT INTO live_alerts (lecture_id, t, kind, text) VALUES (?, ?, ?, ?)");
      for (const a of r.alerts) alert.run(lectureId, a.t, a.kind, a.text);
      this.db.prepare("UPDATE lectures SET live_from = ?, live_audio = MAX(live_audio, ?), live_held = ? WHERE id = ?")
        .run(r.next, r.audioEnd, r.held.length ? JSON.stringify(r.held) : null, lectureId);
      return true;
    });
  }
  setLiveAudio(lectureId: string, seconds: number) { this.db.prepare("UPDATE lectures SET live_audio = MAX(live_audio, ?) WHERE id = ?").run(seconds, lectureId); }
  setLiveLimit(lectureId: string, state: number) { this.db.prepare("UPDATE lectures SET live_limit = MAX(live_limit, ?) WHERE id = ?").run(state, lectureId); }
  addLiveAlert(lectureId: string, a: Alert) { this.db.prepare("INSERT INTO live_alerts (lecture_id, t, kind, text) VALUES (?, ?, ?, ?)").run(lectureId, a.t, a.kind, a.text); }
  /* What the reply to chunk `seq` carries: lines and alerts not sent yet, now marked as sent with this chunk, and those
     already sent with it (the reply to a chunk sent twice carries the same lines, in case the first reply was lost). */
  takeLive(lectureId: string, seq: number): { segments: Line[]; alerts: Alert[] } {
    return this.tx(() => {
      this.db.prepare("UPDATE live_lines SET sent_seq = ? WHERE lecture_id = ? AND sent_seq IS NULL").run(seq, lectureId);
      this.db.prepare("UPDATE live_alerts SET sent_seq = ? WHERE lecture_id = ? AND sent_seq IS NULL").run(seq, lectureId);
      const segments = this.db.prepare("SELECT t, text FROM live_lines WHERE lecture_id = ? AND sent_seq = ? ORDER BY t, id").all(lectureId, seq) as unknown as Line[];
      const alerts = this.db.prepare("SELECT t, kind, text FROM live_alerts WHERE lecture_id = ? AND sent_seq = ? ORDER BY t, id").all(lectureId, seq) as unknown as Alert[];
      return { segments: segments.map(x => ({ t: x.t, text: x.text })), alerts: alerts.map(x => ({ t: x.t, kind: x.kind, text: x.text })) };
    });
  }
  liveLines(lectureId: string, since = 0) {
    return (this.db.prepare("SELECT t, text FROM live_lines WHERE lecture_id = ? AND t >= ? ORDER BY t, id").all(lectureId, since) as unknown as Line[]).map(x => ({ t: x.t, text: x.text }));
  }
  liveAlerts(lectureId: string) {
    return (this.db.prepare("SELECT t, kind, text FROM live_alerts WHERE lecture_id = ? ORDER BY t, id").all(lectureId) as unknown as Alert[]).map(x => ({ t: x.t, kind: x.kind, text: x.text }));
  }

  /* ---- kept recordings ---- */
  readyLecturesWithAudio() { return this.db.prepare("SELECT * FROM lectures WHERE status = 'ready' AND audio_expired = 0").all() as unknown as LectureRow[]; }
  setAudioExpired(id: string) { this.db.prepare("UPDATE lectures SET audio_expired = 1 WHERE id = ?").run(id); }

  /* ---- transcript, notes, upcoming dates ---- */
  saveTranscript(lectureId: string, provider: string, model: string, lines: Line[]) {
    this.db.prepare("INSERT OR REPLACE INTO transcripts (lecture_id, provider, model, lines_json, created_at) VALUES (?, ?, ?, ?, ?)").run(lectureId, provider, model, JSON.stringify(lines), now());
  }
  transcript(lectureId: string) {
    const r = this.db.prepare("SELECT lines_json FROM transcripts WHERE lecture_id = ?").get(lectureId) as { lines_json: string } | undefined;
    return r ? JSON.parse(r.lines_json) as Line[] : null;
  }
  /* Notes, the dated alerts and status ready in one transaction. Does nothing when the lecture was deleted meanwhile. */
  saveNotes(lectureId: string, detail: Detail, dated: { date: string; kind: string; text: string; t: number }[]) {
    this.db.exec("BEGIN");
    try {
      if (!this.lecture(lectureId)) { this.db.exec("ROLLBACK"); return false; }
      this.db.prepare("INSERT OR REPLACE INTO details (lecture_id, detail_json, created_at) VALUES (?, ?, ?)").run(lectureId, JSON.stringify(detail), now());
      this.db.prepare("DELETE FROM upcoming WHERE lecture_id = ?").run(lectureId);
      const ins = this.db.prepare("INSERT INTO upcoming (lecture_id, date, kind, text, t) VALUES (?, ?, ?, ?, ?)");
      for (const u of dated) ins.run(lectureId, u.date, u.kind, u.text, u.t);
      this.db.prepare("UPDATE lectures SET status = 'ready', error = NULL WHERE id = ?").run(lectureId);
      this.db.exec("COMMIT"); return true;
    } catch (e) { this.db.exec("ROLLBACK"); throw e; }
  }
  detail(lectureId: string) {
    const r = this.db.prepare("SELECT detail_json FROM details WHERE lecture_id = ?").get(lectureId) as { detail_json: string } | undefined;
    return r ? JSON.parse(r.detail_json) as Detail : null;
  }
  upcoming(userId: string, fromDate: string) {
    return this.db.prepare(`SELECT upcoming.*, courses.code AS course_code FROM upcoming JOIN lectures ON lectures.id = upcoming.lecture_id
      JOIN courses ON courses.id = lectures.course_id WHERE lectures.user_id = ? AND upcoming.date >= ? ORDER BY upcoming.date, upcoming.t`).all(userId, fromDate) as unknown as UpcomingRow[];
  }

  /* ---- costs: kept after a lecture is deleted, so the totals stay right ---- */
  logCost(c: CostEntry) {
    this.db.prepare(`INSERT INTO costs (lecture_id, user_id, stage, provider, model, audio_seconds, input_tokens, cached_input_tokens, output_tokens, reasoning_tokens, usd, meta_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(c.lectureId, c.userId, c.stage, c.provider, c.model, c.audioSeconds ?? null, c.inputTokens ?? null,
      c.cachedInputTokens ?? null, c.outputTokens ?? null, c.reasoningTokens ?? null, c.usd, c.meta ? JSON.stringify(c.meta) : null, now());
  }
  costs() { return this.db.prepare("SELECT * FROM costs ORDER BY id").all() as unknown as CostRow[]; }
}
