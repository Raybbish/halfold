/* The HTTP app: the API under /api, and (when WEB_DIR is set) the built front end at "/" on the same origin. */
import fs from "node:fs";
import path from "node:path";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { onError } from "./http/errors";
import { privateRoutes, publicRoutes, type AppEnv, type Deps } from "./routes";
import { libraryRoutes, sharedRoutes } from "./library";
import { studyRoutes } from "./study";
import { loginRoutes } from "./login";
import { accountRoutes, webhookRoutes } from "./account";
import { profileRoutes } from "./profile";
import type { Config } from "./config";

/* The front end reads window.SIDENOTE_CONFIG at start (src/config.ts). "Example notes" on the public pages opens the
   shared lecture EXAMPLE_SHARE_ID, and is hidden when it is not set. SIGN_IN picks the sign-in page: email and code
   (phase 4) or the invite code alone. CONTACT_EMAIL is the address on the Privacy page, only when it is set. */
export const webConfig = (config: Pick<Config, "exampleShareId" | "signIn" | "contactEmail">) =>
  ({ USE_MOCK: false, API_BASE: "/api", EXAMPLE_SHARE_ID: config.exampleShareId, SIGN_IN: config.signIn, ...(config.contactEmail ? { CONTACT_EMAIL: config.contactEmail } : {}) });

export function createApp(deps: Deps) {
  const app = new Hono();
  app.onError(onError);

  const api = new Hono<AppEnv>();
  /* JSON requests are small. Without a limit, one huge body to the public sign-in endpoint would be read into memory.
     File uploads stream to disk with their own limits (MAX_UPLOAD_MB, and MAX_CHUNK_MB for a piece of a live recording). */
  const small = bodyLimit({ maxSize: 64 * 1024, onError: c => c.json({ message: "The request is too large." }, 413) });
  const stripe = bodyLimit({ maxSize: 1024 * 1024, onError: c => c.json({ message: "The request is too large." }, 413) });
  api.use("*", (c, next) => /\/(recording|slides|chunks)$/.test(c.req.path) ? next() : c.req.path.endsWith("/stripe/webhook") ? stripe(c, next) : small(c, next));
  api.route("/", loginRoutes(deps));
  api.route("/", publicRoutes(deps));
  api.route("/", sharedRoutes(deps));
  api.route("/", webhookRoutes(deps));
  /* Every other endpoint needs the token from POST /session. A 401 makes the front end sign in again. */
  api.use("*", async (c, next) => {
    const m = /^Bearer\s+(\S+)$/i.exec(c.req.header("authorization") || "");
    const user = m ? deps.store.userByToken(m[1], deps.config.login.sessionDays) : undefined;
    if (!user) return c.json({ message: "Please sign in again." }, 401);
    c.set("user", user);
    await next();
  });
  api.route("/", privateRoutes(deps));
  api.route("/", libraryRoutes(deps));
  api.route("/", studyRoutes(deps));
  api.route("/", accountRoutes(deps));
  api.route("/", profileRoutes(deps));
  api.notFound(c => c.json({ message: "This is not available yet." }, 404));
  api.onError(onError);
  app.route("/api", api);

  if (deps.config.webDir && fs.existsSync(path.join(deps.config.webDir, "index.html"))) serveWeb(app, deps.config.webDir, webConfig(deps.config));
  app.notFound(c => c.json({ message: "Not found." }, 404));
  return app;
}

const TYPES: Record<string, string> = { ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".html": "text/html; charset=utf-8",
  ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".json": "application/json", ".woff2": "font/woff2" };

function serveWeb(app: Hono, webDir: string, config: ReturnType<typeof webConfig>) {
  const root = path.resolve(webDir);
  const tag = `<script>window.SIDENOTE_CONFIG = ${JSON.stringify(config)};</script>\n`;
  const page = () => {
    const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
    const at = html.search(/<script type="module"/i);
    return at >= 0 ? html.slice(0, at) + tag + html.slice(at) : html.replace("</head>", tag + "</head>");
  };
  app.get("/", c => c.html(page(), 200, { "Cache-Control": "no-cache" }));
  app.get("/index.html", c => c.html(page(), 200, { "Cache-Control": "no-cache" }));
  app.get("/assets/*", c => {
    const file = path.resolve(root, "." + decodeURIComponent(c.req.path));
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return c.json({ message: "Not found." }, 404);
    /* Vite puts a content hash in every asset name, so they can be cached for good. */
    return c.body(fs.readFileSync(file), 200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream", "Cache-Control": "public, max-age=31536000, immutable" });
  });
}
