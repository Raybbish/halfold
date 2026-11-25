/* Cloudflare R2 through its S3 API: the four calls Halfold needs (upload a file, read its size and ETag, delete it, a
   presigned link to read it), signed with AWS Signature Version 4 by hand. @aws-sdk/client-s3 would bring dozens of
   packages for these four calls, and its newer versions send checksum headers R2 has not always accepted; the signing
   is checked against AWS's own published examples (test/r2.test.ts).
   Requests go to <endpoint>/<bucket>/<key> (path style), region "auto" as R2 asks. */
import fs from "node:fs";
import { createHash, createHmac } from "node:crypto";

export interface R2Settings {
  accountId: string; accessKeyId: string; secretAccessKey: string; bucket: string;
  endpoint: string;   // https://<accountId>.r2.cloudflarestorage.com unless R2_ENDPOINT says otherwise (an EU bucket, tests)
}

export interface Credentials { accessKeyId: string; secretAccessKey: string; region: string; service?: string }

const EMPTY_SHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
export const UNSIGNED = "UNSIGNED-PAYLOAD";
const MAX_LINK_SECONDS = 7 * 86400;   // the longest a presigned link may work (S3 and R2)

/* RFC 3986 encoding, as SigV4 wants it: only A-Z a-z 0-9 - . _ ~ stay as they are. */
const enc = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, c => "%" + c.charCodeAt(0).toString(16).toUpperCase());
const hmac = (key: string | Buffer, data: string) => createHmac("sha256", key).update(data).digest();
const sha256 = (data: string) => createHash("sha256").update(data).digest("hex");
/* 20130524T000000Z */
const amzDate = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

function canonicalQuery(params: URLSearchParams) {
  return [...params].map(([k, v]) => [enc(k), enc(v)]).sort(([a, x], [b, y]) => a < b ? -1 : a > b ? 1 : x < y ? -1 : x > y ? 1 : 0).map(([k, v]) => `${k}=${v}`).join("&");
}

/* The signature of one request: the canonical request, the string to sign, and the key for that day, region and service. */
function signature(c: Credentials, method: string, url: URL, query: URLSearchParams, headers: [string, string][], payload: string, when: string) {
  const day = when.slice(0, 8), service = c.service || "s3", scope = `${day}/${c.region}/${service}/aws4_request`;
  const sorted = headers.map(([k, v]) => [k.toLowerCase(), v.trim().replace(/\s+/g, " ")] as const).sort(([a], [b]) => a < b ? -1 : 1);
  const signed = sorted.map(([k]) => k).join(";");
  const request = [method, url.pathname, canonicalQuery(query), sorted.map(([k, v]) => `${k}:${v}\n`).join(""), signed, payload].join("\n");
  const toSign = ["AWS4-HMAC-SHA256", when, scope, sha256(request)].join("\n");
  const key = hmac(hmac(hmac(hmac("AWS4" + c.secretAccessKey, day), c.region), service), "aws4_request");
  return { scope, signed, signature: createHmac("sha256", key).update(toSign).digest("hex") };
}

/* The headers that sign a request: Authorization, x-amz-date and x-amz-content-sha256 (the payload's SHA-256, or
   UNSIGNED-PAYLOAD), plus the ones given, all of them signed. Host comes from the URL, as fetch sends it. */
export function signedHeaders(c: Credentials, method: string, url: URL, headers: Record<string, string>, payload: string, now = new Date()) {
  const when = amzDate(now);
  const all: Record<string, string> = { ...headers, "x-amz-content-sha256": payload, "x-amz-date": when };
  const s = signature(c, method, url, url.searchParams, [["host", url.host], ...Object.entries(all)], payload, when);
  return { ...all, Authorization: `AWS4-HMAC-SHA256 Credential=${c.accessKeyId}/${s.scope}, SignedHeaders=${s.signed}, Signature=${s.signature}` };
}

/* A link that works without credentials for `seconds` (at most 7 days): the signature is in the query string. Other
   query parameters already on the URL (response-content-disposition and the like) are signed with it. */
export function presign(c: Credentials, method: string, url: URL, seconds: number, now = new Date()) {
  const when = amzDate(now), day = when.slice(0, 8), out = new URL(url);
  const q = out.searchParams;
  q.set("X-Amz-Algorithm", "AWS4-HMAC-SHA256");
  q.set("X-Amz-Credential", `${c.accessKeyId}/${day}/${c.region}/${c.service || "s3"}/aws4_request`);
  q.set("X-Amz-Date", when);
  q.set("X-Amz-Expires", String(Math.max(1, Math.min(MAX_LINK_SECONDS, Math.floor(seconds)))));
  q.set("X-Amz-SignedHeaders", "host");
  const s = signature(c, method, out, q, [["host", out.host]], UNSIGNED, when);
  out.search = canonicalQuery(q) + "&X-Amz-Signature=" + s.signature;
  return out.toString();
}

export class R2Error extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}

export interface PresignOptions {
  method?: "GET" | "HEAD";
  seconds: number;
  type?: string;            // Content-Type of the reply
  disposition?: string;     // Content-Disposition of the reply
  cacheControl?: string;    // Cache-Control of the reply
}

/* Hashes a file in one pass: SHA-256 to sign the upload with (R2 refuses bytes that do not match it), MD5 to compare
   with the ETag R2 gives back. */
export async function hashFile(file: string) {
  const a = createHash("sha256"), b = createHash("md5");
  let size = 0;
  for await (const chunk of fs.createReadStream(file)) { a.update(chunk as Buffer); b.update(chunk as Buffer); size += (chunk as Buffer).length; }
  return { sha256: a.digest("hex"), md5: b.digest("hex"), size };
}

export class R2 {
  private readonly c: Credentials;
  constructor(private readonly s: R2Settings) {
    this.c = { accessKeyId: s.accessKeyId, secretAccessKey: s.secretAccessKey, region: "auto" };
  }
  get bucket() { return this.s.bucket; }

  private url(key: string) {
    return new URL(`${this.s.endpoint}/${enc(this.s.bucket)}/${key.split("/").map(enc).join("/")}`);
  }

  private async send(method: string, key: string, o: { headers?: Record<string, string>; payload?: string; body?: Blob; timeoutMs: number; signal?: AbortSignal }) {
    const url = this.url(key);
    const headers = signedHeaders(this.c, method, url, o.headers || {}, o.payload || EMPTY_SHA256);
    const signal = o.signal ? AbortSignal.any([o.signal, AbortSignal.timeout(o.timeoutMs)]) : AbortSignal.timeout(o.timeoutMs);
    try { return await fetch(url, { method, headers, body: o.body, signal }); }
    catch (e) {
      /* fetch says only "fetch failed"; the reason (ECONNREFUSED, a DNS failure, a timeout) is its cause. */
      const c = (e as { cause?: { code?: string; message?: string } }).cause;
      throw new Error(`R2 could not be reached: ${c?.code || c?.message || (e as Error).message}`, { cause: e });
    }
  }

  private async failed(r: Response, what: string, body?: string): Promise<never> {
    const text = body ?? await r.text().catch(() => "");
    const code = /<Code>([^<]*)<\/Code>/.exec(text)?.[1] || "";
    const message = /<Message>([^<]*)<\/Message>/.exec(text)?.[1] || "";
    throw new R2Error(r.status, code, `R2 ${what} replied ${r.status}${code ? " " + code : ""}${message ? ": " + message : ""}`);
  }

  /* Whether these settings reach the bucket (at start, so a wrong key or bucket name shows in the log at once): reads an
     object that is not there, for which the right answer is 404 NoSuchKey. */
  async check() {
    const r = await this.send("GET", "kept/.check", { timeoutMs: 15_000 });
    const text = await r.text().catch(() => "");
    if (r.ok || (r.status === 404 && text.includes("<Code>NoSuchKey</Code>"))) return;
    await this.failed(r, "check", text);
  }

  /* Uploads a file whole (one PUT: R2 takes up to 5 GB that way; a recording is well under 1 GB). The body is read
     from disk as it is sent. */
  async put(key: string, file: string, type: string, signal?: AbortSignal) {
    const h = await hashFile(file);
    const body = await fs.openAsBlob(file, { type });
    /* A slow link gets time in proportion: at least 2 minutes, and 100 KB/s. */
    const r = await this.send("PUT", key, { headers: { "content-type": type }, payload: h.sha256, body, signal, timeoutMs: Math.max(120_000, h.size / 100) });
    if (!r.ok) await this.failed(r, "upload");
    await r.arrayBuffer().catch(() => {});
    return h;
  }

  /* Size and ETag (quotes removed) of an object, or null when there is none. */
  async head(key: string, signal?: AbortSignal) {
    const r = await this.send("HEAD", key, { signal, timeoutMs: 30_000 });
    if (r.status === 404) return null;
    if (!r.ok) await this.failed(r, "check");
    return { size: Number(r.headers.get("content-length")), etag: (r.headers.get("etag") || "").replace(/"/g, "") };
  }

  /* Deleting what is not there is not an error (S3 answers 204 either way). */
  async delete(key: string, signal?: AbortSignal) {
    /* Short: deleting a lecture waits for this. One that times out is tried again later (files.ts retryDeletes). */
    const r = await this.send("DELETE", key, { signal, timeoutMs: 15_000 });
    if (!r.ok && r.status !== 404) await this.failed(r, "delete");
    await r.arrayBuffer().catch(() => {});
  }

  presign(key: string, o: PresignOptions, now = new Date()) {
    const url = this.url(key);
    if (o.type) url.searchParams.set("response-content-type", o.type);
    if (o.disposition) url.searchParams.set("response-content-disposition", o.disposition);
    if (o.cacheControl) url.searchParams.set("response-cache-control", o.cacheControl);
    return presign(this.c, o.method || "GET", url, o.seconds, now);
  }
}
