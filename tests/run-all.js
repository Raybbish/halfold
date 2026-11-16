// One command for every check:  npm test   (or: node tests/run-all.js [--no-build] [--only=real5,zhcheck] [--no-shots])
//   1. builds the app (npm run build: tsc --noEmit and vite build) unless --no-build
//   2. the check scripts, all on the build: real5.js, zhscript.js, real3.js, zhcheck.js, upload.js, backend-text.js, courses.js,
//      slides-later.js, search.js, sharing.js, signin.js, course-picker.js, failed-reason.js, brand.js, zh-hans.js and
//      background-notes.js (counts in EXPECT below)
//   3. overflow5.js (no sideways scrolling at 8 widths, English and Chinese) and printcheck.js (print view)
//   4. shots5.js on the build (animations off): it only has to finish without console or page errors; the screenshots are kept
//      for looking at and are no longer compared with reference/sidenote.html (the product was renamed Halfnote)
// Output (screenshots, logs) goes to tests/output/.
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..'), OUT = path.join(__dirname, 'output');
const flag = n => process.argv.includes('--' + n);
const opt = n => { const a = process.argv.find(x => x.startsWith('--' + n + '=')); return a && a.split('=')[1]; };
const TARGET = 'dist';
const ONLY = opt('only') ? opt('only').split(',') : null;
const want = n => !ONLY || ONLY.includes(n);
const EXPECT = { real5: 65, zhscript: 16, real3: 11, zhcheck: 10, upload: 27, 'backend-text': 13, courses: 18, 'slides-later': 15, search: 20, sharing: 6, signin: 13, 'course-picker': 9, 'failed-reason': 6, brand: 16, 'zh-hans': 19, 'background-notes': 14, 'stuck-lecture': 18, 'quick-record': 17 };
const SCRIPTS = ['real5', 'zhscript', 'real3', 'zhcheck', 'upload', 'backend-text', 'courses', 'slides-later', 'search', 'sharing', 'signin', 'course-picker', 'failed-reason', 'brand', 'zh-hans', 'background-notes', 'stuck-lecture', 'quick-record'];

function run(script, target, extraEnv = {}) {
  const cwd = path.join(OUT, target); fs.mkdirSync(cwd, { recursive: true });
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [path.join(__dirname, script), '--target=' + target], { cwd, env: { ...process.env, ...extraEnv }, encoding: 'utf8', maxBuffer: 1 << 26 });
  const out = (r.stdout || '') + (r.stderr || '');
  fs.writeFileSync(path.join(cwd, script.replace('.js', '.log')), out);
  return { out, code: r.status, secs: Math.round((Date.now() - t0) / 1000) };
}

(async () => {
  const summary = []; let ok = true;
  const line = (name, pass, detail) => { summary.push(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`); if (!pass) ok = false; };

  if (!flag('no-build')) {
    console.log('> npm run build');
    const b = spawnSync('npm', ['run', 'build'], { cwd: ROOT, encoding: 'utf8', shell: process.platform === 'win32' });
    const text = (b.stdout || '') + (b.stderr || ''); process.stdout.write(text);
    line('build (tsc --noEmit, vite build)', b.status === 0 && !/warn/i.test(text), b.status === 0 ? (/warn/i.test(text) ? 'warnings in the build output' : 'no errors, no warnings') : 'build failed');
    if (b.status !== 0) { console.log(summary.join('\n')); process.exit(1); }
  }

  for (const s of SCRIPTS) {
    if (!want(s)) continue;
    console.log(`> ${s}.js (${TARGET})`);
    const r = run(s + '.js', TARGET);
    const m = /(\d+) of (\d+) checks passed/.exec(r.out);
    const fails = r.out.split('\n').filter(l => l.startsWith('FAIL') || l.startsWith('SCRIPT ERROR'));
    fails.forEach(f => console.log('   ' + f.slice(0, 400)));
    const pass = m && m[1] === m[2] && +m[2] === EXPECT[s] && r.code === 0;
    line(`${s}.js`, pass, (m ? `${m[1]} of ${m[2]} checks passed (expected ${EXPECT[s]})` : 'no result line') + ` in ${r.secs}s`);
  }

  if (want('overflow5')) {
    console.log(`> overflow5.js (${TARGET})`); const r = run('overflow5.js', TARGET);
    const pass = /no sideways scrolling at/.test(r.out) && /\nno page errors/.test(r.out) && r.code === 0;
    if (!pass) console.log(r.out);
    line('overflow5.js: no sideways scrolling, 8 widths x 3 languages', pass, pass ? '' : 'see tests/output/' + TARGET + '/overflow5.log');
  }
  if (want('printcheck')) {
    console.log(`> printcheck.js (${TARGET})`); const r = run('printcheck.js', TARGET);
    const m = /print view of the notes page -> (.*) \| main padding: (.*)/.exec(r.out);
    const pass = !!m && !/shown/.test(m[1]) && m[2].trim() === '0px' && r.code === 0;
    line('printcheck.js: nav, player, tabs and buttons hidden in print', pass, m ? m[1] + ' | main padding ' + m[2].trim() : r.out.slice(0, 300));
  }

  // The shots5.js walk at its own sizes (390 and 1280 px), then with the phone at 375 px as the acceptance asks. The
  // screenshots are kept in tests/output/dist/shots5-390 and shots5-375 for looking at; they are not compared with anything.
  if (want('shots') && !flag('no-shots')) for (const phone of ['390', '375']) {
    const tag = 'shots5-' + phone;   // shots5.js writes to shots5/; each width's set is kept under its own name
    console.log(`> shots5.js (dist, phone ${phone} px, animations off)`);
    const dir = path.join(OUT, 'dist', 'shots5'), keep = path.join(OUT, 'dist', tag); fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(keep, { recursive: true, force: true });
    const r = run('shots5.js', 'dist', { SIDENOTE_STABLE: '1', ...(phone === '375' ? { SIDENOTE_PHONE_WIDTH: '375' } : {}) });
    if (fs.existsSync(dir)) fs.renameSync(dir, keep);
    line(`shots5.js (phone ${phone} px): no console or page errors`, /no console\/page errors/.test(r.out) && r.code === 0, /no console\/page errors/.test(r.out) ? '' : r.out.slice(0, 600));
  }

  console.log('\n' + summary.join('\n'));
  process.exit(ok ? 0 : 1);
})();
