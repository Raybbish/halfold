// One command for every check:  npm test   (or: node tests/run-all.js [--target=dist|legacy] [--no-build] [--only=real5,zhcheck] [--no-shots])
//   1. builds the app (npm run build: tsc --noEmit and vite build) unless --no-build or --target=legacy
//   2. the four check scripts: real5.js (65), zhscript.js (16), real3.js (11), zhcheck.js (10)
//   3. overflow5.js (no sideways scrolling at 8 widths, English and Chinese) and printcheck.js (print view)
//   4. shots5.js against the original file and against the build, compared pixel by pixel (animations off)
// Output (screenshots, logs, diff images) goes to tests/output/.
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { compare } = require('./compare-shots');

const ROOT = path.resolve(__dirname, '..'), OUT = path.join(__dirname, 'output');
const flag = n => process.argv.includes('--' + n);
const opt = n => { const a = process.argv.find(x => x.startsWith('--' + n + '=')); return a && a.split('=')[1]; };
const TARGET = opt('target') || 'dist';
const ONLY = opt('only') ? opt('only').split(',') : null;
const want = n => !ONLY || ONLY.includes(n);
const EXPECT = { real5: 65, zhscript: 16, real3: 11, zhcheck: 10 };

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

  if (TARGET === 'dist' && !flag('no-build')) {
    console.log('> npm run build');
    const b = spawnSync('npm', ['run', 'build'], { cwd: ROOT, encoding: 'utf8', shell: process.platform === 'win32' });
    const text = (b.stdout || '') + (b.stderr || ''); process.stdout.write(text);
    line('build (tsc --noEmit, vite build)', b.status === 0 && !/warn/i.test(text), b.status === 0 ? (/warn/i.test(text) ? 'warnings in the build output' : 'no errors, no warnings') : 'build failed');
    if (b.status !== 0) { console.log(summary.join('\n')); process.exit(1); }
  }

  for (const s of ['real5', 'zhscript', 'real3', 'zhcheck']) {
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
    line('overflow5.js: no sideways scrolling, 8 widths x 2 languages', pass, pass ? '' : 'see tests/output/' + TARGET + '/overflow5.log');
  }
  if (want('printcheck')) {
    console.log(`> printcheck.js (${TARGET})`); const r = run('printcheck.js', TARGET);
    const m = /print view of the notes page -> (.*) \| main padding: (.*)/.exec(r.out);
    const pass = !!m && !/shown/.test(m[1]) && m[2].trim() === '0px' && r.code === 0;
    line('printcheck.js: nav, player, tabs and buttons hidden in print', pass, m ? m[1] + ' | main padding ' + m[2].trim() : r.out.slice(0, 300));
  }

  if (TARGET === 'dist' && want('shots') && !flag('no-shots')) {
    for (const t of ['legacy', 'dist']) {
      console.log(`> shots5.js (${t}, animations off)`);
      const dir = path.join(OUT, t, 'shots5'); fs.rmSync(dir, { recursive: true, force: true });
      const r = run('shots5.js', t, { SIDENOTE_STABLE: '1' });
      line(`shots5.js on ${t === 'legacy' ? 'sidenote.html' : 'the build'}: no console or page errors`, /no console\/page errors/.test(r.out) && r.code === 0, /no console\/page errors/.test(r.out) ? '' : r.out.slice(0, 600));
    }
    const rows = await compare(path.join(OUT, 'legacy', 'shots5'), path.join(OUT, 'dist', 'shots5'), path.join(OUT, 'shots-diff'));
    const differ = rows.filter(r => r.missing || (r.diff && !r.noise)), noisy = rows.filter(r => r.noise);
    rows.forEach(r => { if (r.missing || r.diff) console.log(`   ${r.missing ? 'MISSING' : r.noise ? 'NOISE' : 'DIFF'}  ${r.name}${r.diff ? `  ${r.diff} px, max channel delta ${r.maxDelta}, in box ${JSON.stringify(r.box)}` : ''}`); });
    line(`screenshots: ${rows.length - differ.length - noisy.length} of ${rows.length} identical to sidenote.html` + (noisy.length ? `, ${noisy.length} differ only by anti-aliasing noise` : ''), differ.length === 0, differ.length ? 'diff images in tests/output/shots-diff/' : '');
  }

  console.log('\n' + summary.join('\n'));
  process.exit(ok ? 0 : 1);
})();
