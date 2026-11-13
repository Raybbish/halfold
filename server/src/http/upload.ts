/* Receiving one file from a multipart form without holding it in memory (recordings go up to MAX_UPLOAD_MB).
   The file is streamed to a temp path. If the request is cut off, the file is too big, or anything else goes wrong,
   the temp file is deleted and nothing is left behind (API-CHANGES.md section 2). */
import fs from "node:fs";
import { Readable } from "node:stream";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import busboy from "busboy";
import type { FileStore } from "../files";
import { HttpError } from "./errors";

export interface Received { tempPath: string; filename: string; mimeType: string; bytes: number }

const tooBig = (maxBytes: number) => new HttpError(413, `That file is larger than ${Math.round(maxBytes / 1048576)} MB.`);

export async function receiveFile(req: Request, files: FileStore, field: string, maxBytes: number): Promise<Received> {
  const type = req.headers.get("content-type") || "";
  if (!/^multipart\/form-data/i.test(type)) throw new HttpError(400, "Send the file as multipart/form-data.");
  /* The browser sends Content-Length: refuse a file that is too big before reading any of it. The form framing adds a little. */
  const length = Number(req.headers.get("content-length"));
  if (Number.isFinite(length) && length > maxBytes + 64 * 1024) throw tooBig(maxBytes);
  if (!req.body) throw new HttpError(400, "No file was sent.");

  const tempPath = files.tempPath();
  let bb: busboy.Busboy;
  try { bb = busboy({ headers: { "content-type": type }, limits: { files: 1, fields: 20, fileSize: maxBytes } }); }
  catch { throw new HttpError(400, "Send the file as multipart/form-data."); }

  return new Promise<Received>((resolve, reject) => {
    let settled = false, got: Omit<Received, "tempPath" | "bytes"> | null = null, bytes = 0, overLimit = false;
    let out: fs.WriteStream | null = null, written: Promise<void> = Promise.resolve();
    const source = Readable.fromWeb(req.body as unknown as WebReadableStream<Uint8Array>);
    const stop = (err: Error) => {
      if (settled) return; settled = true;
      source.unpipe(bb); source.destroy(); out?.destroy();
      files.discard(tempPath).finally(() => reject(err));
    };
    bb.on("file", (name, stream, info) => {
      if (name !== field || got) { stream.resume(); return; }
      got = { filename: info.filename || "", mimeType: info.mimeType || "application/octet-stream" };
      out = fs.createWriteStream(tempPath);
      written = new Promise((ok, bad) => { out!.on("finish", ok); out!.on("error", bad); });
      written.catch(e => stop(e));
      stream.on("data", (d: Buffer) => { bytes += d.length; });
      stream.on("limit", () => { overLimit = true; stop(tooBig(maxBytes)); });
      stream.on("error", e => stop(e));
      stream.pipe(out);
    });
    bb.on("error", () => stop(new HttpError(400, "The upload did not finish, or the form could not be read. Please try again.")));
    bb.on("close", () => {
      if (settled) return;
      if (overLimit) return stop(tooBig(maxBytes));
      if (!got) return stop(new HttpError(400, "No file was sent."));
      written.then(() => { if (settled) return; settled = true; resolve({ tempPath, bytes, ...got! }); }, e => stop(e));
    });
    /* The request was cut off (the student cancelled, or the connection dropped): an ordinary error, not a server fault. */
    const cutOff = () => stop(new HttpError(400, "The upload did not finish. Please try again."));
    source.on("error", cutOff);
    source.on("aborted", cutOff);
    source.pipe(bb);
  });
}
