/* =====================================================================
   API LAYER: the one place that talks to the network
   ===================================================================== */
import { CONFIG } from "../config";
import { S, session } from "../state/app";

export type HttpError = Error & { status?: number };

/* anon = a public endpoint: no token is sent and a 401 is an ordinary error.
   Endpoints with nothing to return may answer 204 or an empty 200: both resolve to null. */
export async function http(method: string, path: string, body?: unknown, anon?: boolean): Promise<any> {
  const isForm = body instanceof FormData;
  const headers: Record<string, string> = {};
  if (S.token && !anon) headers.Authorization = "Bearer " + S.token;
  if (body && !isForm) headers["Content-Type"] = "application/json";
  const r = await fetch(CONFIG.API_BASE + path, { method, headers, body: isForm ? body : body ? JSON.stringify(body) : undefined });
  return reply(r.status, r.statusText, r.status === 204 ? "" : await r.text(), anon);
}

/* What a reply means, for http() and upload() alike. */
function reply(status: number, statusText: string, text: string, anon?: boolean) {
  if (status === 401 && !anon) { session.clear(); if (location.hash !== "#/signin") S.next = location.hash; location.hash = "#/signin"; throw Object.assign(new Error("Please sign in again."), { status: 401 }); }
  if (status < 200 || status > 299) { let m = statusText; try { m = JSON.parse(text).message || m; } catch (e) {} throw Object.assign(new Error(m || "Request failed"), { status }); }
  if (!text.trim()) return null;   // endpoints with nothing to return may answer 204 or an empty 200
  try { return JSON.parse(text); } catch (e) { throw new Error("The server sent a reply Sidenote could not read."); }
}

export interface UploadOptions {
  onProgress?: (loaded: number, total: number) => void;   // bytes of this request's body sent so far
  signal?: AbortSignal;                                    // abort() cancels the upload; the promise rejects with an AbortError
}
export const abortError = () => new DOMException("The upload was cancelled.", "AbortError");

/* POST a multipart form and report how much of it has been sent. fetch() cannot report upload progress, so this uses
   XMLHttpRequest, with the same rules as http() for the token, 401, error messages and empty replies. */
export function upload(path: string, form: FormData, opts: UploadOptions = {}): Promise<any> {
  return new Promise((resolve, reject) => {
    if (opts.signal && opts.signal.aborted) return reject(abortError());
    const x = new XMLHttpRequest();
    x.open("POST", CONFIG.API_BASE + path);
    if (S.token) x.setRequestHeader("Authorization", "Bearer " + S.token);
    if (opts.onProgress) x.upload.onprogress = e => { if (e.lengthComputable) opts.onProgress!(e.loaded, e.total); };
    const stop = () => x.abort();
    if (opts.signal) opts.signal.addEventListener("abort", stop, { once: true });
    const done = () => { if (opts.signal) opts.signal.removeEventListener("abort", stop); };
    x.onabort = () => { done(); reject(abortError()); };
    x.onerror = () => { done(); reject(new TypeError("Failed to fetch")); };   // what fetch() reports when the network fails
    x.onload = () => { done(); try { resolve(reply(x.status, x.statusText, x.status === 204 ? "" : x.responseText)); } catch (e) { reject(e); } };
    x.send(form);
  });
}
export const form1 = (k: string, v: string | Blob, extra?: Record<string, string | number>) => { const f = new FormData(); f.append(k, v); Object.entries(extra || {}).forEach(([a, b]) => f.append(a, String(b))); return f; };
