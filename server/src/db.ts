/* The database: SQLite through node:sqlite (built into Node, no native build). Everything the routes and the
   pipeline store goes through Store, so another database means rewriting this file only. */
import { DatabaseSync } from "node:sqlite";
import { createHash, randomBytes } from "node:crypto";
import type { Alert, Detail, Line, LectureStatus, Source } from "../../src/types";
import type { ClassLanguage } from "./config";

/* email: the address the student signs in with (phase 4), bound the first time with the invite code; null for an
   invite code nobody has used with an email yet. stripe_customer: the student in Stripe, once they have paid. */
export interface UserRow {
  id: string; invite_code: string; name: string; class_language: string; zh_default: number; zh_script: string | null;
  email: string | null; stripe_customer: string | null;
}
export interface LoginCodeRow { email: string; code_hash: string; expires_at: string; tries: number; created_at: string }
/* A Stripe subscription (paid every month). One row per student: the latest one. plan is the plan id in plans.json. */
export interface SubscriptionRow {
  user_id: string; sub_id: string; customer: string | null; plan: string; status: string; period_end: string;
  cancel_at_end: number; ended_at: string | null; checked_at: string;
}
/* Paid once for a number of days (and days given by hand: npm run plan -- give). */
export interface PassRow { user_id: string; plan: string; until: string; updated_at: string }
/* A Stripe Checkout the student was sent to. card: the plan card they chose. status open, complete, expired or failed. */
export interface CheckoutRow { id: string; user_id: string; card: string; mode: string; status: string; created_at: string; done_at: string | null }
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
  /* Phase 3. share_id: the id in the shared link (#/s/:id), null when not shared; share_url: that link as the student
     copied it. refile: 1 while slides sent after the notes are being matched to the points. copied_from: the lecture a
     shared copy was saved from (POST /shared/:id/save). */
  share_id: string | null; share_url: string | null; refile: number; copied_from: string | null;
}
export interface UpcomingRow { lecture_id: string; date: string; kind: string; text: string; t: number; course_code: string }
export interface PackRow { course_id: string; status: "processing" | "ready" | "failed"; lecture_ids: string; pack_json: string | null; error: string | null; updated_at: string }
export interface FeedbackRow { id: number; lecture_id: string; user_id: string; text: string; created_at: string; title: string; course_code: string; user_name: string }
/* stage "slides": matching slides sent later to the notes; "pack": a review pack, logged with the course id in lecture_id. */
export interface CostEntry {
  lectureId: string; userId: string | null; stage: "stt" | "notes" | "live" | "catchup" | "slides" | "pack"; provider: string; model: string;
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
CREATE TABLE IF NOT EXISTS progress (
  lecture_id TEXT PRIMARY KEY REFERENCES lectures(id) ON DELETE CASCADE, known_json TEXT NOT NULL, quiz_score REAL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT, lecture_id TEXT NOT NULL REFERENCES lectures(id) ON DELETE CASCADE, user_id TEXT NOT NULL, text TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS packs (
  course_id TEXT PRIMARY KEY REFERENCES courses(id) ON DELETE CASCADE, status TEXT NOT NULL, lecture_ids TEXT NOT NULL DEFAULT '',
  pack_json TEXT, error TEXT, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS login_codes (
  email TEXT PRIMARY KEY, code_hash TEXT NOT NULL, expires_at TEXT NOT NULL, tries INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS code_sends (email TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS code_sends_at ON code_sends(created_at);
CREATE TABLE IF NOT EXISTS subscriptions (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, sub_id TEXT NOT NULL, customer TEXT, plan TEXT NOT NULL, status TEXT NOT NULL,
  period_end TEXT NOT NULL, cancel_at_end INTEGER NOT NULL DEFAULT 0, ended_at TEXT, checked_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS passes (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, plan TEXT NOT NULL, until TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS checkouts (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, card TEXT NOT NULL, mode TEXT NOT NULL, status TEXT NOT NULL,
  created_at TEXT NOT NULL, done_at TEXT);
CREATE TABLE IF NOT EXISTS quota (
  kind TEXT NOT NULL, ref TEXT NOT NULL, user_id TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY (kind, ref));
CREATE INDEX IF NOT EXISTS quota_user ON quota(user_id, kind, created_at);
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
  ["lectures", "audio_expired", "INTEGER NOT NULL DEFAULT 0"], ["lectures", "live_held", "TEXT"],
  ["lectures", "share_id", "TEXT"], ["lectures", "share_url", "TEXT"], ["lectures", "refile", "INTEGER NOT NULL DEFAULT 0"], ["lectures", "copied_from", "TEXT"],
  ["users", "email", "TEXT"], ["users", "stripe_customer", "TEXT"], ["sessions", "last_used", "TEXT"]
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
    this.db.exec("CREATE UNIQUE INDEX IF NOT EXISTS lectures_share ON lectures(share_id)");
    this.db.exec("CREATE UNIQUE INDEX IF NOT EXISTS users_email ON users(email)");
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

  /* When plans began on this server (the first start of phase 4). Recordings made before it are kept as if made that day,
     so turning plans on does not delete old recordings at once. */
  private since: string | null = null;
  plansSince() {
    if (this.since) return this.since;
    this.db.prepare("INSERT OR IGNORE INTO meta (key, value) VALUES ('plans_since', ?)").run(now());
    return this.since = (this.db.prepare("SELECT value FROM meta WHERE key = 'plans_since'").get() as { value: string }).value;
  }

  /* ---- users and sessions ---- */
  addInviteCode(code: string, name = ""): UserRow {
    const c = normCode(code); if (!c) throw new Error("empty invite code");
    this.db.prepare("INSERT OR IGNORE INTO users (id, invite_code, name, created_at) VALUES (?, ?, ?, ?)").run("u" + randomId(12), c, name, now());
    return this.userByCode(c)!;
  }
  userByCode(code: string) { return this.db.prepare("SELECT * FROM users WHERE invite_code = ?").get(normCode(code)) as UserRow | undefined; }
  listUsers() { return this.db.prepare("SELECT * FROM users ORDER BY created_at").all() as unknown as UserRow[]; }
  user(id: string) { return this.db.prepare("SELECT * FROM users WHERE id = ?").get(id) as UserRow | undefined; }
  setUserName(id: string, name: string) { this.db.prepare("UPDATE users SET name = ? WHERE id = ?").run(name, id); }
  createSession(userId: string) {
    const token = randomBytes(32).toString("base64url"), at = now();
    this.db.prepare("INSERT INTO sessions (token_hash, user_id, created_at, last_used) VALUES (?, ?, ?, ?)").run(hashToken(token), userId, at, at);
    return token;
  }
  /* The student a token belongs to. A sign-in not used for maxIdleDays has ended (and is removed); one in use is marked
     as used at most once an hour, so a request does not always write. */
  userByToken(token: string, maxIdleDays = Infinity, at = new Date()) {
    const h = hashToken(token);
    const row = this.db.prepare("SELECT users.*, COALESCE(sessions.last_used, sessions.created_at) AS session_used FROM sessions JOIN users ON users.id = sessions.user_id WHERE sessions.token_hash = ?")
      .get(h) as (UserRow & { session_used: string }) | undefined;
    if (!row) return undefined;
    const idle = at.getTime() - Date.parse(row.session_used);
    if (idle > maxIdleDays * 86400_000) { this.db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(h); return undefined; }
    if (idle > 3600_000) this.db.prepare("UPDATE sessions SET last_used = ? WHERE token_hash = ?").run(at.toISOString(), h);
    const { session_used: _s, ...user } = row;
    return user as UserRow;
  }
  endSession(token: string) { this.db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(hashToken(token)); }
  userByEmail(email: string) { return this.db.prepare("SELECT * FROM users WHERE email = ?").get(email) as UserRow | undefined; }
  /* Binds an address to an invite code's account; false when the account already has one or the address is taken. */
  bindEmail(userId: string, email: string) {
    try { return Number(this.db.prepare("UPDATE users SET email = ? WHERE id = ? AND email IS NULL").run(email, userId).changes) > 0; }
    catch (e) { if (/UNIQUE/i.test((e as Error).message)) return false; throw e; }
  }
  setSettings(id: string, s: { name: string; classLanguage: string; zhDefault: boolean; zhScript?: string }) {
    this.db.prepare("UPDATE users SET name = ?, class_language = ?, zh_default = ?, zh_script = COALESCE(?, zh_script) WHERE id = ?")
      .run(s.name, s.classLanguage, s.zhDefault ? 1 : 0, s.zhScript ?? null, id);
  }

  /* ---- codes sent by email to sign in ---- */
  /* One code per address: a new one replaces the last. */
  saveLoginCode(email: string, codeHash: string, expiresAt: string) {
    this.tx(() => {
      this.db.prepare(`INSERT INTO login_codes (email, code_hash, expires_at, tries, created_at) VALUES (?, ?, ?, 0, ?)
        ON CONFLICT(email) DO UPDATE SET code_hash = excluded.code_hash, expires_at = excluded.expires_at, tries = 0, created_at = excluded.created_at`).run(email, codeHash, expiresAt, now());
      this.db.prepare("INSERT INTO code_sends (email, created_at) VALUES (?, ?)").run(email, now());
      this.db.prepare("DELETE FROM code_sends WHERE created_at < ?").run(new Date(Date.now() - 86400_000).toISOString());
    });
  }
  loginCode(email: string) { return this.db.prepare("SELECT * FROM login_codes WHERE email = ?").get(email) as LoginCodeRow | undefined; }
  /* A wrong try; returns how many there have been. */
  wrongCode(email: string) {
    this.db.prepare("UPDATE login_codes SET tries = tries + 1 WHERE email = ?").run(email);
    return this.loginCode(email)?.tries ?? 0;
  }
  dropLoginCode(email: string) { this.db.prepare("DELETE FROM login_codes WHERE email = ?").run(email); }
  /* Codes sent since a time: to one address, or (email null) to all. */
  codesSent(email: string | null, sinceIso: string) {
    const r = email === null ? this.db.prepare("SELECT COUNT(*) AS n FROM code_sends WHERE created_at >= ?").get(sinceIso)
      : this.db.prepare("SELECT COUNT(*) AS n FROM code_sends WHERE email = ? AND created_at >= ?").get(email, sinceIso);
    return Number((r as { n: number }).n);
  }
  lastCodeSent(email: string) { return (this.db.prepare("SELECT MAX(created_at) AS at FROM code_sends WHERE email = ?").get(email) as { at: string | null }).at; }

  /* ---- plans and payment (phase 4) ---- */
  subscription(userId: string) { return this.db.prepare("SELECT * FROM subscriptions WHERE user_id = ?").get(userId) as SubscriptionRow | undefined; }
  userBySubscription(subId: string) { return this.db.prepare("SELECT * FROM subscriptions WHERE sub_id = ?").get(subId) as SubscriptionRow | undefined; }
  userByCustomer(customer: string) { return this.db.prepare("SELECT * FROM users WHERE stripe_customer = ?").get(customer) as UserRow | undefined; }
  saveSubscription(s: SubscriptionRow) {
    this.db.prepare(`INSERT INTO subscriptions (user_id, sub_id, customer, plan, status, period_end, cancel_at_end, ended_at, checked_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET sub_id = excluded.sub_id, customer = excluded.customer, plan = excluded.plan, status = excluded.status,
        period_end = excluded.period_end, cancel_at_end = excluded.cancel_at_end, ended_at = excluded.ended_at, checked_at = excluded.checked_at`)
      .run(s.user_id, s.sub_id, s.customer, s.plan, s.status, s.period_end, s.cancel_at_end, s.ended_at, s.checked_at);
    if (s.customer) this.db.prepare("UPDATE users SET stripe_customer = ? WHERE id = ?").run(s.customer, s.user_id);
  }
  subscriptionChecked(userId: string) { this.db.prepare("UPDATE subscriptions SET checked_at = ? WHERE user_id = ?").run(now(), userId); }
  pass(userId: string) { return this.db.prepare("SELECT * FROM passes WHERE user_id = ?").get(userId) as PassRow | undefined; }
  /* Adds days of a plan: after the current pass of the same plan if it still runs, otherwise from `at`. */
  extendPass(userId: string, plan: string, days: number, at = new Date()) {
    const p = this.pass(userId), from = p && p.plan === plan && Date.parse(p.until) > at.getTime() ? Date.parse(p.until) : at.getTime();
    const until = new Date(from + days * 86400_000).toISOString();
    this.db.prepare(`INSERT INTO passes (user_id, plan, until, updated_at) VALUES (?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET plan = excluded.plan, until = excluded.until, updated_at = excluded.updated_at`).run(userId, plan, until, now());
    return until;
  }
  addCheckout(c: Pick<CheckoutRow, "id" | "user_id" | "card" | "mode">) {
    this.db.prepare("INSERT OR IGNORE INTO checkouts (id, user_id, card, mode, status, created_at) VALUES (?, ?, ?, ?, 'open', ?)").run(c.id, c.user_id, c.card, c.mode, now());
  }
  checkout(id: string) { return this.db.prepare("SELECT * FROM checkouts WHERE id = ?").get(id) as CheckoutRow | undefined; }
  openCheckouts(userId: string, sinceIso: string) {
    return this.db.prepare("SELECT * FROM checkouts WHERE user_id = ? AND status = 'open' AND created_at >= ? ORDER BY created_at").all(userId, sinceIso) as unknown as CheckoutRow[];
  }
  /* open -> another status, once: false when it had already left "open" (the same news came twice). `then` runs in the
     same transaction, only when the status changed here. */
  closeCheckout(id: string, status: "complete" | "expired" | "failed", then?: () => void) {
    return this.tx(() => {
      const changed = Number(this.db.prepare("UPDATE checkouts SET status = ?, done_at = ? WHERE id = ? AND status = 'open'").run(status, now(), id).changes) > 0;
      if (changed && then) then();
      return changed;
    });
  }
  /* Lectures that count against the month's limit, started since a time: those that got (or are getting) notes, deleted
     or not, and those still being recorded or uploaded. Saved copies of shared notes do not count. */
  lecturesUsed(userId: string, sinceIso: string) {
    return Number((this.db.prepare(`SELECT COUNT(*) AS n FROM (
      SELECT ref FROM quota WHERE kind = 'lecture' AND user_id = ? AND created_at >= ?
      UNION SELECT id FROM lectures WHERE user_id = ? AND status = 'recording' AND copied_from IS NULL AND created_at >= ?)`).get(userId, sinceIso, userId, sinceIso) as { n: number }).n);
  }
  /* Review packs made since a time, and those being made now. Empty packs (no lecture with notes yet) do not count. */
  packsUsed(userId: string, sinceIso: string) {
    const made = (this.db.prepare("SELECT COUNT(*) AS n FROM quota WHERE kind = 'pack' AND user_id = ? AND created_at >= ?").get(userId, sinceIso) as { n: number }).n;
    const making = (this.db.prepare("SELECT COUNT(*) AS n FROM packs JOIN courses ON courses.id = packs.course_id WHERE courses.user_id = ? AND packs.status = 'processing'").get(userId) as { n: number }).n;
    return Number(made) + Number(making);
  }

  /* ---- courses ---- */
  createCourse(userId: string, id: string, code: string, name: string, color: string | null): CourseRow {
    this.db.prepare("INSERT INTO courses (id, user_id, code, name, color, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(id, userId, code, name, color, now());
    return this.course(userId, id)!;
  }
  course(userId: string, id: string) { return this.db.prepare("SELECT * FROM courses WHERE id = ? AND user_id = ?").get(id, userId) as CourseRow | undefined; }
  courseExists(id: string) { return !!this.db.prepare("SELECT 1 FROM courses WHERE id = ?").get(id); }
  courses(userId: string) { return this.db.prepare("SELECT * FROM courses WHERE user_id = ? ORDER BY created_at").all(userId) as unknown as CourseRow[]; }
  courseById(id: string) { return this.db.prepare("SELECT * FROM courses WHERE id = ?").get(id) as CourseRow | undefined; }
  updateCourse(id: string, code: string, name: string) { this.db.prepare("UPDATE courses SET code = ?, name = ? WHERE id = ?").run(code, name, id); }
  /* The course, and with it (ON DELETE CASCADE) its lectures, their notes and everything else in the database. */
  deleteCourse(id: string) { this.db.prepare("DELETE FROM courses WHERE id = ?").run(id); }
  /* Lectures of a course, oldest first (the order they were taught). */
  courseLectures(courseId: string) { return this.db.prepare("SELECT * FROM lectures WHERE course_id = ? ORDER BY created_at, rowid").all(courseId) as unknown as LectureRow[]; }
  /* Whether a live recording in this course received a piece of audio since a time: a recording in progress. */
  recordingIn(courseId: string, sinceIso: string) {
    return !!this.db.prepare(`SELECT 1 FROM chunks JOIN lectures ON lectures.id = chunks.lecture_id
      WHERE lectures.course_id = ? AND lectures.status = 'recording' AND chunks.created_at >= ? LIMIT 1`).get(courseId, sinceIso);
  }

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
    /* The lecture now counts against the month's limit for good (plans.json lecturesPerMonth), even if it is deleted later. */
    if (Number(r.changes) > 0) this.db.prepare("INSERT OR IGNORE INTO quota (kind, ref, user_id, created_at) SELECT 'lecture', id, user_id, created_at FROM lectures WHERE id = ? AND copied_from IS NULL").run(id);
    return Number(r.changes) > 0;
  }
  renameLecture(id: string, title: string) { this.db.prepare("UPDATE lectures SET title = ? WHERE id = ?").run(title, id); }
  moveLecture(id: string, courseId: string) { this.db.prepare("UPDATE lectures SET course_id = ? WHERE id = ?").run(courseId, id); }
  setFailed(id: string, error: string) { this.db.prepare("UPDATE lectures SET status = 'failed', error = ? WHERE id = ?").run(error.slice(0, 2000), id); }
  deleteLecture(id: string) { this.db.prepare("DELETE FROM lectures WHERE id = ?").run(id); }
  /* Live recordings (record, tab) started since a time, for the daily limit. */
  liveLecturesSince(userId: string, sinceIso: string) {
    return this.db.prepare("SELECT * FROM lectures WHERE user_id = ? AND source IN ('record', 'tab') AND created_at >= ?").all(userId, sinceIso) as unknown as LectureRow[];
  }

  /* ---- sharing ---- */
  setShare(id: string, shareId: string, url: string) { this.db.prepare("UPDATE lectures SET share_id = ?, share_url = ? WHERE id = ?").run(shareId, url, id); }
  clearShare(id: string) { this.db.prepare("UPDATE lectures SET share_id = NULL, share_url = NULL WHERE id = ?").run(id); }
  lectureByShare(shareId: string) { return this.db.prepare("SELECT * FROM lectures WHERE share_id = ?").get(shareId) as LectureRow | undefined; }
  /* The copy this student already saved of a shared lecture. */
  copyOf(userId: string, sourceId: string) { return this.db.prepare("SELECT * FROM lectures WHERE user_id = ? AND copied_from = ? ORDER BY rowid LIMIT 1").get(userId, sourceId) as LectureRow | undefined; }
  /* A copy of a lecture's notes in another student's course: the notes (without the recording or the owner's progress)
     and the dated alerts. Points the owner added are no longer "mine": they are not the reader's. It keeps the class
     date, and counts as an upload (not against the daily live minutes). */
  copyLecture(src: LectureRow, detail: Detail, to: { id: string; userId: string; courseId: string }) {
    return this.tx(() => {
      this.db.prepare(`INSERT INTO lectures (id, user_id, course_id, title, language, source, status, duration, client_duration, created_at, finished_at, copied_from)
        VALUES (?, ?, ?, ?, ?, 'upload', 'ready', ?, ?, ?, ?, ?)`).run(to.id, to.userId, to.courseId, src.title, src.language, src.duration, src.client_duration, src.created_at, src.finished_at, src.id);
      const { audio: _a, progress: _p, ...notes } = detail;
      notes.sections = notes.sections.map(sec => ({ ...sec, points: sec.points.map(({ mine: _m, ...pt }) => pt) }));
      this.db.prepare("INSERT INTO details (lecture_id, detail_json, created_at) VALUES (?, ?, ?)").run(to.id, JSON.stringify(notes), now());
      this.db.prepare("INSERT INTO upcoming (lecture_id, date, kind, text, t) SELECT ?, date, kind, text, t FROM upcoming WHERE lecture_id = ?").run(to.id, src.id);
      return this.lecture(to.id)!;
    });
  }

  /* ---- slides sent after the notes (API-CHANGES.md section 3) ---- */
  /* ready -> processing, marked as matching slides to the notes; false when the lecture was not ready. */
  startRefile(id: string) {
    return Number(this.db.prepare("UPDATE lectures SET status = 'processing', refile = 1, has_slides = 1, error = NULL WHERE id = ? AND status = 'ready'").run(id).changes) > 0;
  }
  /* The notes under the slides, and ready again. Does nothing when the lecture was deleted meanwhile. */
  saveRefiled(id: string, detail: Detail) {
    return this.tx(() => {
      if (!this.lecture(id)) return false;
      this.db.prepare("UPDATE details SET detail_json = ? WHERE lecture_id = ?").run(JSON.stringify(detail), id);
      this.db.prepare("UPDATE lectures SET status = 'ready', refile = 0, error = NULL WHERE id = ?").run(id);
      return true;
    });
  }
  /* Matching failed: ready again with the notes as they were, without slides. */
  refileFailed(id: string, error: string) {
    this.db.prepare("UPDATE lectures SET status = 'ready', refile = 0, has_slides = 0, error = ? WHERE id = ?").run(error.slice(0, 2000), id);
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
  /* Changes the notes in one transaction: `change` gets the stored notes and edits them in place. An error thrown by
     `change` (a point that is not there) leaves them as they were. */
  editDetail<T>(lectureId: string, change: (d: Detail) => T): T {
    return this.tx(() => {
      const d = this.detail(lectureId);
      if (!d) throw new Error("no notes");
      const out = change(d);
      this.db.prepare("UPDATE details SET detail_json = ? WHERE lecture_id = ?").run(JSON.stringify(d), lectureId);
      return out;
    });
  }
  /* Every point in the notes of a student's lectures, newest lecture first, in the order of the notes (GET /search). */
  notePoints(userId: string) {
    return this.db.prepare(`SELECT lectures.id AS lecture, json_extract(p.value, '$.text') AS text, json_extract(p.value, '$.t') AS t
      FROM lectures JOIN details ON details.lecture_id = lectures.id, json_each(details.detail_json, '$.sections') AS s, json_each(s.value, '$.points') AS p
      WHERE lectures.user_id = ? ORDER BY lectures.created_at DESC, lectures.rowid DESC, s.key, p.key`).all(userId) as unknown as { lecture: string; text: string | null; t: number | null }[];
  }
  upcoming(userId: string, fromDate: string) {
    return this.db.prepare(`SELECT upcoming.*, courses.code AS course_code FROM upcoming JOIN lectures ON lectures.id = upcoming.lecture_id
      JOIN courses ON courses.id = lectures.course_id WHERE lectures.user_id = ? AND upcoming.date >= ? ORDER BY upcoming.date, upcoming.t`).all(userId, fromDate) as unknown as UpcomingRow[];
  }

  /* ---- study progress and feedback ---- */
  /* quizScore null keeps the last score: the front end sends one only when a quiz round was finished. */
  saveProgress(lectureId: string, known: number[], quizScore: number | null) {
    this.db.prepare(`INSERT INTO progress (lecture_id, known_json, quiz_score, updated_at) VALUES (?, ?, ?, ?)
      ON CONFLICT(lecture_id) DO UPDATE SET known_json = excluded.known_json, quiz_score = COALESCE(excluded.quiz_score, progress.quiz_score), updated_at = excluded.updated_at`)
      .run(lectureId, JSON.stringify(known), quizScore, now());
  }
  progress(lectureId: string) {
    const r = this.db.prepare("SELECT known_json, quiz_score FROM progress WHERE lecture_id = ?").get(lectureId) as { known_json: string; quiz_score: number | null } | undefined;
    return r ? { known: JSON.parse(r.known_json) as number[], quizScore: r.quiz_score } : null;
  }
  addFeedback(lectureId: string, userId: string, text: string) {
    this.db.prepare("INSERT INTO feedback (lecture_id, user_id, text, created_at) VALUES (?, ?, ?, ?)").run(lectureId, userId, text, now());
  }
  feedback(limit = 100) {
    return this.db.prepare(`SELECT feedback.*, lectures.title, courses.code AS course_code, users.name AS user_name FROM feedback
      JOIN lectures ON lectures.id = feedback.lecture_id JOIN courses ON courses.id = lectures.course_id JOIN users ON users.id = feedback.user_id
      ORDER BY feedback.id DESC LIMIT ?`).all(limit) as unknown as FeedbackRow[];
  }

  /* ---- review packs, one per course ---- */
  pack(courseId: string) { return this.db.prepare("SELECT * FROM packs WHERE course_id = ?").get(courseId) as PackRow | undefined; }
  packsWithStatus(status: PackRow["status"]) { return this.db.prepare("SELECT * FROM packs WHERE status = ?").all(status) as unknown as PackRow[]; }
  setPackProcessing(courseId: string) {
    this.db.prepare(`INSERT INTO packs (course_id, status, updated_at) VALUES (?, 'processing', ?)
      ON CONFLICT(course_id) DO UPDATE SET status = 'processing', error = NULL, updated_at = excluded.updated_at`).run(courseId, now());
  }
  /* lectureIds: the lectures the pack was made from, to tell later whether it still covers the course. */
  savePack(courseId: string, lectureIds: string[], pack: unknown) {
    const at = now();
    this.db.prepare("UPDATE packs SET status = 'ready', lecture_ids = ?, pack_json = ?, error = NULL, updated_at = ? WHERE course_id = ?")
      .run(lectureIds.join(" "), JSON.stringify(pack), at, courseId);
    /* A pack made from notes counts against the month's limit (plans.json packsPerMonth); an empty one does not. */
    if (lectureIds.length) this.db.prepare("INSERT OR IGNORE INTO quota (kind, ref, user_id, created_at) SELECT 'pack', ?, user_id, ? FROM courses WHERE id = ?").run(`${courseId}@${at}`, at, courseId);
  }
  packFailed(courseId: string, error: string) { this.db.prepare("UPDATE packs SET status = 'failed', error = ?, updated_at = ? WHERE course_id = ?").run(error.slice(0, 2000), now(), courseId); }
  dropPack(courseId: string) { this.db.prepare("DELETE FROM packs WHERE course_id = ?").run(courseId); }

  /* ---- costs: kept after a lecture is deleted, so the totals stay right ---- */
  logCost(c: CostEntry) {
    this.db.prepare(`INSERT INTO costs (lecture_id, user_id, stage, provider, model, audio_seconds, input_tokens, cached_input_tokens, output_tokens, reasoning_tokens, usd, meta_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(c.lectureId, c.userId, c.stage, c.provider, c.model, c.audioSeconds ?? null, c.inputTokens ?? null,
      c.cachedInputTokens ?? null, c.outputTokens ?? null, c.reasoningTokens ?? null, c.usd, c.meta ? JSON.stringify(c.meta) : null, now());
  }
  costs() { return this.db.prepare("SELECT * FROM costs ORDER BY id").all() as unknown as CostRow[]; }
}
