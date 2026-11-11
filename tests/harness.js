// Shared set-up for the check scripts. The scripts were written for the single sidenote.html; this file is what
// lets them run against the built React app (dist/) without touching their assertions. It does four things:
//   1. Serves the page at http://localhost:8765 by request interception. The build is made of module scripts,
//      which cannot run from file://, so every script now opens ORIGIN instead of a file path.
//   2. Sets configuration through page.addInitScript(window.SIDENOTE_CONFIG = ...) instead of editing the source text.
//   3. Makes the names the scripts read as page globals (S, route, pl, live ...) resolve to window.__sidenote.
//   4. Launches the Playwright browser installed in this project instead of /usr/bin/google-chrome.
//
// The same scripts also run against the original file: --target=legacy (or SIDENOTE_TARGET=legacy) serves
// reference/sidenote.html with the configuration written into its CONFIG block, the way the scripts used to.
const fs = require('fs');
const path = require('path');
const pw = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const arg = process.argv.find(a => a.startsWith('--target='));
const TARGET = (arg && arg.split('=')[1]) || process.env.SIDENOTE_TARGET || 'dist';
if (!['dist', 'legacy'].includes(TARGET)) throw new Error('target must be dist or legacy');
const DIST = path.join(ROOT, 'dist');
const LEGACY = path.join(ROOT, 'reference', 'sidenote.html');
const ORIGIN = 'http://localhost:8765';
// SIDENOTE_STABLE=1 turns animations off (prefers-reduced-motion) so two runs can be compared pixel by pixel.
const STABLE = process.env.SIDENOTE_STABLE === '1';

// Names the check scripts use as globals of sidenote.html. In the React app they live on window.__sidenote.
const GLOBALS = ['S', 'route', 'state', 'trs', 'today', 'dayMon', 'pl', 'live', 'rec', 'outbox', 'idb', 'DATA', 'notesMarkdown', 'api', 'mockDb'];

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.txt': 'text/plain' };

if (TARGET === 'dist' && !fs.existsSync(path.join(DIST, 'index.html'))) throw new Error('dist/index.html is missing: run npm run build first');

// The original file with configuration values written into its CONFIG block, as the scripts used to do with String.replace.
function legacyHtml(cfg) {
  let h = fs.readFileSync(LEGACY, 'utf8');
  for (const [k, v] of Object.entries(cfg || {})) {
    const re = new RegExp('(\\n  ' + k + ': )[^,\\s]+');
    if (!re.test(h)) throw new Error('CONFIG key not found in sidenote.html: ' + k);
    h = h.replace(re, '$1' + JSON.stringify(v));
  }
  return h;
}

// Answer a page request (anything that is not /api/ or /audio/) with the app.
async function serve(route, cfg) {
  if (TARGET === 'legacy') return route.fulfill({ status: 200, contentType: 'text/html', body: legacyHtml(cfg) });
  let p = decodeURIComponent(new URL(route.request().url()).pathname);
  if (p.endsWith('/')) p += 'index.html';
  const f = path.join(DIST, path.normalize(p));
  if (!f.startsWith(DIST + path.sep) || !fs.existsSync(f) || !fs.statSync(f).isFile()) return route.fulfill({ status: 404, contentType: 'text/plain', body: 'Not found' });
  return route.fulfill({ status: 200, contentType: TYPES[path.extname(f)] || 'application/octet-stream', body: fs.readFileSync(f) });
}

// Configuration for one browser context. The React build reads window.SIDENOTE_CONFIG; for the original file
// serve() writes the same values into the source, so this is a no-op there.
async function setConfig(ctx, cfg) {
  if (TARGET === 'dist' && cfg && Object.keys(cfg).length) await ctx.addInitScript(c => { window.SIDENOTE_CONFIG = Object.assign(window.SIDENOTE_CONFIG || {}, c); }, cfg);
}

function shim(names) {
  for (const k of names) {
    if (k in window) continue;
    Object.defineProperty(window, k, { configurable: true, get() { return window.__sidenote ? window.__sidenote[k] : undefined; } });
  }
}

const chromium = {
  async launch(opts = {}) {
    const { executablePath, ...rest } = opts;   // the scripts named a system Chrome; the browser installed with Playwright is used instead
    const browser = await pw.chromium.launch(rest);
    const newContext = browser.newContext.bind(browser);
    browser.newContext = async (o = {}) => {
      const ctx = await newContext(STABLE ? { reducedMotion: 'reduce', ...o } : o);
      if (TARGET === 'dist') await ctx.addInitScript(shim, GLOBALS);
      // Default for scripts that open the page in sample mode. A script's own ctx.route or page.route takes precedence.
      await ctx.route(ORIGIN + '/**', r => serve(r, {}));
      return ctx;
    };
    return browser;
  }
};

module.exports = { chromium, ORIGIN, TARGET, ROOT, serve, setConfig, legacyHtml };
