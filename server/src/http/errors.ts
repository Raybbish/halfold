/* Every error reply is {message}: the front end shows that sentence to the student as it is. */
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

export class HttpError extends Error {
  constructor(readonly status: ContentfulStatusCode, message: string) { super(message); }
}
export const fail = (status: ContentfulStatusCode, message: string): never => { throw new HttpError(status, message); };

export function onError(err: Error, c: Context) {
  if (err instanceof HttpError) return c.json({ message: err.message }, err.status);
  console.error("[http]", c.req.method, c.req.path, err);
  return c.json({ message: "Something went wrong on the server. Please try again." }, 500);
}

/* Reads a JSON body. A missing or broken body is a 400, not a 500. */
export async function jsonBody(c: Context): Promise<Record<string, unknown>> {
  let body: unknown;
  try { body = await c.req.json(); } catch { fail(400, "The request was not valid JSON."); }
  if (!body || typeof body !== "object" || Array.isArray(body)) fail(400, "The request was not valid JSON.");
  return body as Record<string, unknown>;
}
