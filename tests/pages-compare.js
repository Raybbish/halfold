// Extra visual check used during the migration: full-page screenshots of every screen, on the original file and on
// the build, at 375 and 1280 px in English and Chinese, compared pixel by pixel (animations off).
// usage: node tests/pages-compare.js [--only=landing,home] [--keep]   (output in tests/output/pages/)
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { compare } = require('./compare-shots');

const OUT = path.join(__dirname, 'output', 'pages');
const only = (process.argv.find(a => a.startsWith('--only=')) || '').slice(7).split(',').filter(Boolean);

// Each step: [name, async (page, ORIGIN) => {...}]. A name starting with '-' is a step without a screenshot.
const STEPS = `[
  ['landing', async p => { await p.goto(O + '/#/'); }],
  ['signin', async p => { await p.goto(O + '/#/signin'); await p.waitForSelector('form.auth'); }],
  ['signin-error', async p => { await p.fill('input[name=code]', '   '); await p.click('form.auth button'); await p.waitForSelector('.err'); }],
  ['-sign in', async p => { await p.fill('input[name=code]', 'a3f9c2'); await p.click('form.auth button'); await p.waitForSelector('.shell'); }],
  ['home', async p => { await p.goto(O + '/#/home'); await p.waitForSelector('#lecList'); }],
  ['home-search', async p => { await p.fill('.search', 'opp'); }],
  ['home-search-none', async p => { await p.fill('.search', 'zzzz'); }],
  ['-clear search', async p => { await p.fill('.search', ''); }],
  ['add-course', async p => { await p.click('.courses .addcard'); await p.waitForSelector('#overlay .modal'); }],
  ['-close', async p => { await p.keyboard.press('Escape'); }],
  ['courses', async p => { await p.goto(O + '/#/courses'); await p.waitForSelector('.courses'); }],
  ['course', async p => { await p.goto(O + '/#/course/econ1001'); await p.waitForSelector('.page-h'); }],
  ['pack-none', async p => { await p.goto(O + '/#/pack/econ1001'); await p.waitForSelector('.main .card button.btn.primary'); }],
  ['pack-ready', async p => { await p.click('.main .card button.btn.primary'); await p.waitForSelector('.pk', { timeout: 20000 }); await p.evaluate(() => document.querySelectorAll('.pk details').forEach((d, i) => { if (i < 2) d.open = true; })); }],
  ['pack-math', async p => { await p.goto(O + '/#/pack/math2011'); await p.waitForSelector('.main .card button.btn.primary'); await p.click('.main .card button.btn.primary'); await p.waitForSelector('.main .card h3', { timeout: 20000 }); await p.waitForTimeout(300); }],
  ['settings', async p => { await p.goto(O + '/#/settings'); await p.waitForSelector('select[name=zs]'); }],
  ['not-found', async p => { await p.goto(O + '/#/nowhere'); await p.waitForSelector('.main .card'); }]
]`;

function run(target, w, zh) {
  const dir = path.join(OUT, target, `${w}-${zh ? 'zh' : 'en'}`); fs.mkdirSync(dir, { recursive: true });
  const code = `
    process.argv.push('--target=${target === 'legacy2' ? 'legacy' : target}');
    const { chromium, ORIGIN: O } = require(${JSON.stringify(path.join(__dirname, 'harness.js'))});
    const ONLY = ${JSON.stringify(only)};
    (async () => {
      const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: ${w}, height: 800 }, isMobile: ${w < 900}, hasTouch: ${w < 900}, deviceScaleFactor: 1, reducedMotion: 'reduce' });
      const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
      await p.goto(O + '/#/'); await p.waitForSelector('.lang'); ${zh ? "await p.click('.lang');" : ''}
      for (const [name, fn] of ${STEPS}) {
        await fn(p); await p.mouse.move(${w} / 2, 1); await p.waitForTimeout(450);   // park the pointer where nothing reacts to hover, so hover states do not depend on timing
        if (name[0] !== '-' && (!ONLY.length || ONLY.includes(name))) await p.screenshot({ path: ${JSON.stringify(dir)} + '/' + name + '.png', fullPage: true });
      }
      process.stdout.write(JSON.stringify(errs)); await b.close();
    })().catch(e => { console.error(e); process.exit(1); });`;
  return JSON.parse(execFileSync(process.execPath, ['-e', code], { cwd: __dirname, maxBuffer: 1 << 26 }).toString() || '[]');
}

(async () => {
  let same = 0, total = 0;
  for (const [w, zh] of [[375, 0], [375, 1], [1280, 0], [1280, 1]]) {
    const tag = `${w}-${zh ? 'zh' : 'en'}`;
    const SELF = process.argv.includes('--self'), e1 = run('legacy', w, zh), e2 = run(SELF ? 'legacy2' : 'dist', w, zh);
    if (e1.length || e2.length) console.log(`errors ${tag}:`, JSON.stringify({ legacy: e1, dist: e2 }));
    const rows = await compare(path.join(OUT, 'legacy', tag), path.join(OUT, SELF ? 'legacy2' : 'dist', tag), path.join(OUT, 'diff', tag));
    for (const r of rows) { total++; if (!r.missing && !r.diff) same++; else console.log(`${r.missing ? 'MISSING' : 'DIFF'}  ${tag}/${r.name}${r.diff ? `  ${r.diff} px in box ${JSON.stringify(r.box)} sizes ${JSON.stringify(r.size)}` : ''}`); }
  }
  console.log(`\n${same} of ${total} screenshots identical`);
})();
