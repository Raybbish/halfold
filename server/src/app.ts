/* The HTTP app: the API under /api, and (when WEB_DIR is set) the built front end at "/" on the same origin. */
import fs from "node:fs";
import path from "node:path";
import { Hono } from "hono";
import { onError } from "./http/errors";
import { privateRoutes, publicRoutes, type AppEnv, type Deps } from "./routes";

/* The front end reads window.SIDENOTE_CONFIG at start (src/config.ts). The example share is hidden: phase 1 has no shared pages. */
export const WEB_CONFIG = { USE_MOCK: false, API_BASE: "/api", EXAMPLE_SHARE_ID: null };

export function createApp(deps: Deps) {
  const app = new Hono();
  app.onError(onError);

  const api = new Hono<AppEnv>();
  api.route("/", publicRoutes(deps));
  /* Every other endpoint needs the token from POST /session. A 401 makes the front end sign in again. */
  api.use("*", async (c, next) => {
    const m = /^Bearer\s+(\S+)$/i.exec(c.req.header("authorization") || "");
    const user = m ? deps.store.userByToken(m[1]) : undefined;
    if (!user) return c.json({ message: "Please sign in again." }, 401);
    c.set("user", user);
    await next();
  });
  api.route("/", privateRoutes(deps));
  api.notFound(c => c.json({ message: "This is not available yet." }, 404));
  api.onError(onError);
  app.route("/api", api);

  if (deps.config.webDir && fs.existsSync(path.join(deps.config.webDir, "index.html"))) serveWeb(app, deps.config.webDir);
  app.notFound(c => c.json({ message: "Not found." }, 404));
  return app;
}

const TYPES: Record<string, string> = { ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".html": "text/html; charset=utf-8",
  ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".json": "application/json", ".woff2": "font/woff2" };

function serveWeb(app: Hono, webDir: string) {
  const root = path.resolve(webDir);
  const tag = `<script>window.SIDENOTE_CONFIG = ${JSON.stringify(WEB_CONFIG)};</script>\n`;
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
