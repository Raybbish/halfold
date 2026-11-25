/* Where lecture files live. Every file is written to this disk first, under DATA_DIR/lectures/<id>/: the pipeline needs
   local paths (ffmpeg reads and writes files), and live chunks are joined there. Without R2 that is where they stay.
   With R2 (config.r2, R2FileStore): once a lecture's notes are written, the files it keeps for good (KEPT: audio.m4a,
   which is played and downloaded, and slides.pdf) move to the bucket, under kept/<id>/<name>, and are read from
   there through presigned links. Not lectures/: the nightly backup (deploy/server/backup.sh) mirrors this disk's
   lectures/ folder to lectures/ in its bucket, deleting what is not here, and the two may share a bucket. Everything else (the original upload until the notes are written, live chunks, temp
   files, the raw transcript) stays on this disk and is deleted as before. */
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import type { Config } from "./config";
import { randomId, type Store } from "./db";
import { R2 } from "./r2";

/* The files that move to R2 once the notes are written, and the type R2 serves each with. */
export const KEPT: Record<string, string> = { "audio.m4a": "audio/mp4", "slides.pdf": "application/pdf" };
const isKept = (name: string) => Object.hasOwn(KEPT, name);

/* A link to a file in R2: GET (or HEAD), working until `until` (Unix seconds), with the reply headers to send. */
export interface LinkOptions { method?: "GET" | "HEAD"; until: number; type?: string; disposition?: string; cacheControl?: string }
export interface Moved { name: string; bytes: number }

export interface FileStore {
  /* "R2 bucket <name>", or null when every file stays on this disk. */
  readonly bucket: string | null;
  /* A fresh path for a file being received. Nothing is visible to the pipeline until commit(). */
  tempPath(): string;
  /* Moves a fully received temp file into the lecture's folder under `name`, replacing what was there. */
  commit(tempPath: string, lectureId: string, name: string): Promise<string>;
  /* The file on this disk. A file that has moved to R2 is not there: see where(). */
  path(lectureId: string, name: string): string;
  /* On this disk or in R2. */
  exists(lectureId: string, name: string): boolean;
  /* "local": read it at path(). "remote": in R2, send the browser to link(). null: neither. */
  where(lectureId: string, name: string): "local" | "remote" | null;
  link(lectureId: string, name: string, o: LinkOptions): string;
  /* Deletes the file here and, for a kept file, in R2. */
  remove(lectureId: string, name: string): Promise<void>;
  removeLecture(lectureId: string): Promise<void>;
  discard(tempPath: string): Promise<void>;
  /* Live recordings: the pieces the browser sends, one file each, named by their order (seq). */
  chunkDir(lectureId: string): string;
  chunkName(seq: number): string;
  commitChunk(tempPath: string, lectureId: string, seq: number): Promise<void>;
  removeChunks(lectureId: string): Promise<void>;
  /* The kept files of a lecture that are still on this disk, which archive() would move. */
  pending(lectureId: string): Moved[];
  /* Moves them to R2 (a lecture with notes only). Without R2, nothing to do. */
  archive(lectureId: string, signal?: AbortSignal): Promise<Moved[]>;
  /* Deletions in R2 that failed, tried again: how many went through. */
  retryDeletes(): Promise<number>;
  /* Throws when R2 is set but cannot be reached with its settings. */
  check(): Promise<void>;
}

const statOf = (file: string) => { try { return fs.statSync(file); } catch { return null; } };

export class LocalFileStore implements FileStore {
  readonly bucket: string | null = null;
  private readonly root: string;
  private readonly tmp: string;
  /* clearTemp: false for a script run beside the server, whose temp files are uploads in progress. */
  constructor(dataDir: string, o: { clearTemp?: boolean } = {}) {
    this.root = path.join(dataDir, "lectures"); this.tmp = path.join(dataDir, "tmp");
    fs.mkdirSync(this.root, { recursive: true }); fs.mkdirSync(this.tmp, { recursive: true });
    /* Temp files left by a crash are never complete: drop them. */
    if (o.clearTemp !== false) for (const f of fs.readdirSync(this.tmp)) fs.rmSync(path.join(this.tmp, f), { force: true, recursive: true });
  }
  tempPath() { return path.join(this.tmp, Date.now().toString(36) + "-" + randomId(8) + ".part"); }
  async commit(tempPath: string, lectureId: string, name: string) {
    const dest = this.path(lectureId, name);
    await fsp.mkdir(path.dirname(dest), { recursive: true });
    await fsp.rename(tempPath, dest);
    return dest;
  }
  path(lectureId: string, name: string) {
    if (!/^[A-Za-z0-9_-]+$/.test(lectureId) || name.includes("/") || name.includes("..")) throw new Error("bad file key");
    return path.join(this.root, lectureId, name);
  }
  protected here(lectureId: string, name: string) { return fs.existsSync(this.path(lectureId, name)); }
  exists(lectureId: string, name: string) { return this.here(lectureId, name); }
  where(lectureId: string, name: string): "local" | "remote" | null { return this.here(lectureId, name) ? "local" : null; }
  link(lectureId: string, name: string, _o: LinkOptions): string { throw new Error(`${lectureId}/${name} is not in R2`); }
  async remove(lectureId: string, name: string) { await fsp.rm(this.path(lectureId, name), { force: true }); }
  async removeLecture(lectureId: string) { await fsp.rm(path.join(this.root, lectureId), { force: true, recursive: true }); }
  async discard(tempPath: string) { await fsp.rm(tempPath, { force: true }); }
  chunkDir(lectureId: string) { return path.join(path.dirname(this.path(lectureId, "x")), "chunks"); }
  chunkName(seq: number) { return String(seq).padStart(6, "0"); }
  async commitChunk(tempPath: string, lectureId: string, seq: number) {
    const dir = this.chunkDir(lectureId);
    await fsp.mkdir(dir, { recursive: true });
    await fsp.rename(tempPath, path.join(dir, this.chunkName(seq)));
  }
  async removeChunks(lectureId: string) { await fsp.rm(this.chunkDir(lectureId), { force: true, recursive: true }); }
  pending(_lectureId: string): Moved[] { return []; }
  async archive(_lectureId: string, _signal?: AbortSignal): Promise<Moved[]> { return []; }
  async retryDeletes() { return 0; }
  async check() {}
}

/* This disk while a lecture is being made, R2 for what it keeps after. Which kept files are in R2 is in the database
   (remote_files), so exists() and where() need no request to R2. A file is deleted here only after R2 has it: uploaded
   with its SHA-256 signed (R2 refuses other bytes), then its size and MD5 (the ETag R2 gives a single upload) read back. */
export class R2FileStore extends LocalFileStore {
  override readonly bucket: string;
  private readonly moving = new Set<string>();
  constructor(dataDir: string, private readonly store: Store, private readonly r2: R2, o: { clearTemp?: boolean } = {}) {
    super(dataDir, o);
    this.bucket = `R2 bucket ${r2.bucket}`;
  }
  key(lectureId: string, name: string) { this.path(lectureId, name); return `kept/${lectureId}/${name}`; }

  override exists(lectureId: string, name: string) { return this.here(lectureId, name) || this.store.isRemote(lectureId, name); }
  override where(lectureId: string, name: string) { return this.here(lectureId, name) ? "local" : this.store.isRemote(lectureId, name) ? "remote" : null; }
  override link(lectureId: string, name: string, o: LinkOptions) {
    if (!this.store.isRemote(lectureId, name)) throw new Error(`${lectureId}/${name} is not in R2`);
    return this.r2.presign(this.key(lectureId, name), { ...o, seconds: Math.max(60, o.until - Date.now() / 1000) });
  }

  override async remove(lectureId: string, name: string) {
    await super.remove(lectureId, name);
    if (!isKept(name)) return;
    this.store.dropRemote(lectureId, name);
    await this.forget([this.key(lectureId, name)]);
  }
  /* Every kept name, not only the ones recorded as moved: an upload cut off before it was recorded may have left one. */
  override async removeLecture(lectureId: string) {
    await super.removeLecture(lectureId);
    await this.forget(Object.keys(KEPT).map(n => this.key(lectureId, n)));
  }

  override pending(lectureId: string): Moved[] {
    const out: Moved[] = [];
    for (const name of Object.keys(KEPT)) { const s = statOf(this.path(lectureId, name)); if (s) out.push({ name, bytes: s.size }); }
    return out;
  }

  /* Throws when R2 fails or does not have what was sent: the file stays here, is served from here, and the sweep
     (audio.ts sweepKept) tries again. */
  override async archive(lectureId: string, signal?: AbortSignal) {
    const moved: Moved[] = [];
    if (this.moving.has(lectureId)) return moved;
    this.moving.add(lectureId);
    try {
      for (const name of Object.keys(KEPT)) {
        /* Only a lecture with notes: one being made, or getting its slides (refile), still reads these files here. */
        if (this.store.lecture(lectureId)?.status !== "ready") break;
        const file = this.path(lectureId, name), before = statOf(file);
        if (!before) continue;
        const key = this.key(lectureId, name);
        this.store.remoteDeleted(key);   // a deletion still waiting for this key must not delete what is sent now
        const sent = await this.r2.put(key, file, KEPT[name], signal);
        const got = await this.r2.head(key, signal);
        if (!got || got.size !== sent.size || (/^[0-9a-f]{32}$/.test(got.etag) && got.etag !== sent.md5))
          throw new Error(`R2 has ${got ? `${got.size} bytes (ETag ${got.etag})` : "nothing"} for ${key}, not the ${sent.size} bytes sent (MD5 ${sent.md5})`);
        /* Deleted while it was uploading: what was sent goes too. */
        if (!this.store.lecture(lectureId)) { await this.forget([key]); break; }
        /* Replaced while it was uploading (slides sent again), or moved by another run: left for the next time. */
        const after = statOf(file);
        if (!after || after.ino !== before.ino || after.size !== sent.size || after.mtimeMs !== before.mtimeMs) continue;
        this.store.addRemote(lectureId, name, sent.size);
        await fsp.rm(file, { force: true });
        moved.push({ name, bytes: sent.size });
      }
      return moved;
    } finally { this.moving.delete(lectureId); }
  }

  override async retryDeletes() {
    let n = 0;
    for (const { key } of this.store.remoteDeletes()) {
      /* Kept again since (slides sent again after a failed refile): not to be deleted. */
      const [, id, name] = key.split("/");
      if (id && this.moving.has(id)) continue;   // being uploaded again right now (archive cancels the deletion)
      if (id && name && this.store.isRemote(id, name)) { this.store.remoteDeleted(key); continue; }
      if (await this.deleteNow(key)) n++;
    }
    return n;
  }

  /* Each deletion is written down before it is sent, so one R2 did not take is tried again later (retryDeletes). */
  override check() { return this.r2.check(); }

  private async forget(keys: string[]) {
    for (const k of keys) this.store.queueRemoteDelete(k);
    await Promise.all(keys.map(k => this.deleteNow(k)));
  }
  private async deleteNow(key: string) {
    try { await this.r2.delete(key); this.store.remoteDeleted(key); return true; }
    catch (e) {
      const msg = (e as Error).message;
      this.store.remoteDeleteFailed(key, msg);
      console.warn(`[files] ${key} could not be deleted from R2 yet (tried again every six hours): ${msg}`);
      return false;
    }
  }
}

export function createFileStore(config: Config, store: Store, o: { clearTemp?: boolean } = {}): FileStore {
  return config.r2 ? new R2FileStore(config.dataDir, store, new R2(config.r2), o) : new LocalFileStore(config.dataDir, o);
}
