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
  if (r.status === 401 && !anon) { session.clear(); if (location.hash !== "#/signin") S.next = location.hash; location.hash = "#/signin"; throw Object.assign(new Error("Please sign in again."), { status: 401 }); }
  if (!r.ok) { let m = r.statusText; try { m = (await r.json()).message || m; } catch (e) {} throw Object.assign(new Error(m || "Request failed"), { status: r.status }); }
  const text = r.status === 204 ? "" : await r.text();
  if (!text.trim()) return null;   // endpoints with nothing to return may answer 204 or an empty 200
  try { return JSON.parse(text); } catch (e) { throw new Error("The server sent a reply Sidenote could not read."); }
}
export const form1 = (k: string, v: string | Blob, extra?: Record<string, string | number>) => { const f = new FormData(); f.append(k, v); Object.entries(extra || {}).forEach(([a, b]) => f.append(a, String(b))); return f; };
