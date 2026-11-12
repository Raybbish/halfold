// Builds the bundle for the real-device walkthrough (acceptance item 5): the original sidenote.html and the React
// build side by side, each on its own HTTPS host, with a Caddyfile and the tester's instructions.
//
//   npm run walkthrough -- --old=old.example.com --new=new.example.com [--api=127.0.0.1:8000] [--root=/srv/sidenote-walkthrough]
//
// Without --api both versions run on sample data (USE_MOCK true). With --api both talk to that backend under /api,
// switched on the same way for both: in the original's CONFIG block and through window.SIDENOTE_CONFIG in the build.
// Output: deploy/walkthrough/out/sidenote-walkthrough/ and deploy/walkthrough/out/sidenote-walkthrough.tar.gz
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url)), ROOT = path.resolve(HERE, "../..");
const opt = n => { const a = process.argv.find(x => x.startsWith("--" + n + "=")); return a ? a.slice(n.length + 3) : null; };
const OLD = opt("old") || "old.example.com", NEW = opt("new") || "new.example.com", API = opt("api"), SRV = opt("root") || "/srv/sidenote-walkthrough";
const NAME = "sidenote-walkthrough", OUT = path.join(HERE, "out"), DIR = path.join(OUT, NAME);
const fail = m => { console.error("make-bundle: " + m); process.exit(1); };

const dist = path.join(ROOT, "dist"), legacy = path.join(ROOT, "reference", "sidenote.html");
if (!fs.existsSync(path.join(dist, "index.html"))) fail("dist/index.html is missing: run npm run build first");
if (OLD === NEW) fail("--old and --new must be different hosts: on one host the two versions share localStorage and IndexedDB");
for (const h of [OLD, NEW]) if (!/^[a-z0-9.-]+(:\d+)?$/i.test(h)) fail("not a host name: " + h);

fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(path.join(DIR, "old"), { recursive: true });

/* The original page. For a real backend the CONFIG block is edited, the same way the old check scripts did it. */
let old = fs.readFileSync(legacy, "utf8");
if (API) { if (old.split("USE_MOCK: true,").length !== 2) fail("USE_MOCK not found in sidenote.html"); old = old.replace("USE_MOCK: true,", "USE_MOCK: false,"); }
fs.writeFileSync(path.join(DIR, "old", "index.html"), old);

/* The React build, unchanged except for the runtime configuration. */
fs.cpSync(dist, path.join(DIR, "new"), { recursive: true });
if (API) {
  const f = path.join(DIR, "new", "index.html"); let h = fs.readFileSync(f, "utf8");
  const at = h.indexOf("<script type=\"module\""); if (at < 0) fail("module script not found in dist/index.html");
  h = h.slice(0, at) + "<script>window.SIDENOTE_CONFIG = { USE_MOCK: false };</script>\n" + h.slice(at);
  fs.writeFileSync(f, h);
}

const api = API ? `\treverse_proxy /api/* ${API}\n` : "";
fs.writeFileSync(path.join(DIR, "Caddyfile"), `# Sidenote real-device walkthrough: the original page and the React build, each on its own HTTPS host.
# Caddy fetches the certificates itself: both names must point to this server, with ports 80 and 443 open.
# Mode: ${API ? "real backend at " + API + " (requests keep their /api prefix)" : "sample data, no backend"}

${OLD} {
	root * ${SRV}/old
	header Cache-Control "no-store"
${api}	file_server
}

${NEW} {
	root * ${SRV}/new
	header Cache-Control "no-store"
${api}	file_server
}
`);

fs.copyFileSync(path.join(HERE, "README.md"), path.join(DIR, "README.md"));

const sha = f => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex").slice(0, 16);
let commit = "unknown"; try { commit = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: ROOT }).toString().trim(); } catch (e) {}
const files = [["old/index.html", path.join(DIR, "old", "index.html")], ...fs.readdirSync(path.join(DIR, "new"), { recursive: true }).filter(p => fs.statSync(path.join(DIR, "new", p)).isFile()).sort().map(p => ["new/" + p, path.join(DIR, "new", p)])];
fs.writeFileSync(path.join(DIR, "VERSION.txt"), [
  "Sidenote real-device walkthrough bundle",
  "made:   " + new Date().toISOString(),
  "commit: " + commit,
  "mode:   " + (API ? "real backend, " + API : "sample data"),
  "old:    https://" + OLD + "/   (reference/sidenote.html)",
  "new:    https://" + NEW + "/   (dist/)",
  "", "sha256 (first 16 hex):", ...files.map(([n, f]) => "  " + sha(f) + "  " + n), ""].join("\n"));

/* No macOS extended attributes or ._ files in the archive: Linux tar would warn about them on extraction. */
execFileSync("tar", ["--no-xattrs", "-czf", path.join(OUT, NAME + ".tar.gz"), "-C", OUT, NAME], { env: { ...process.env, COPYFILE_DISABLE: "1" } });
console.log(`bundle: ${path.relative(ROOT, DIR)}/\narchive: ${path.relative(ROOT, path.join(OUT, NAME + ".tar.gz"))}\nmode: ${API ? "real backend at " + API : "sample data"}\nold: https://${OLD}/\nnew: https://${NEW}/\nserver folder: ${SRV}`);
if (!opt("old") || !opt("new")) console.log("note: --old and --new were not given, so the Caddyfile uses placeholder host names. Run again with your two host names.");
