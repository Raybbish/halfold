/* Where lecture files live. Phase 1 keeps them on the local disk under DATA_DIR/lectures/<id>/; the pipeline needs
   local paths anyway (ffmpeg reads and writes files). Moving to object storage later means another FileStore. */
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { randomId } from "./db";

export interface FileStore {
  /* A fresh path for a file being received. Nothing is visible to the pipeline until commit(). */
  tempPath(): string;
  /* Moves a fully received temp file into the lecture's folder under `name`, replacing what was there. */
  commit(tempPath: string, lectureId: string, name: string): Promise<string>;
  path(lectureId: string, name: string): string;
  exists(lectureId: string, name: string): boolean;
  remove(lectureId: string, name: string): Promise<void>;
  removeLecture(lectureId: string): Promise<void>;
  discard(tempPath: string): Promise<void>;
  /* Live recordings: the pieces the browser sends, one file each, named by their order (seq). */
  chunkDir(lectureId: string): string;
  chunkName(seq: number): string;
  commitChunk(tempPath: string, lectureId: string, seq: number): Promise<void>;
  removeChunks(lectureId: string): Promise<void>;
}

export class LocalFileStore implements FileStore {
  private readonly root: string;
  private readonly tmp: string;
  constructor(dataDir: string) {
    this.root = path.join(dataDir, "lectures"); this.tmp = path.join(dataDir, "tmp");
    fs.mkdirSync(this.root, { recursive: true }); fs.mkdirSync(this.tmp, { recursive: true });
    /* Temp files left by a crash are never complete: drop them. */
    for (const f of fs.readdirSync(this.tmp)) fs.rmSync(path.join(this.tmp, f), { force: true, recursive: true });
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
  exists(lectureId: string, name: string) { return fs.existsSync(this.path(lectureId, name)); }
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
}
