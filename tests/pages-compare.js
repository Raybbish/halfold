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
  ['not-found', async p => { await p.goto(O + '/#/nowhere'); await p.waitForSelector('.main .card'); }],
  ['lecture', async p => { await p.goto(O + '/#/lecture/econ-w9'); await p.waitForSelector('.tabs'); }],
  ['lecture-zh-edit', async p => { await p.locator('.tools input[type=checkbox]').nth(1).check(); await p.locator('.tools input[type=checkbox]').nth(2).check(); }],
  ['lecture-hans', async p => { await p.locator('.seg2 button').nth(1).click(); }],
  ['-reset', async p => { await p.locator('.seg2 button').nth(0).click(); await p.locator('.tools input[type=checkbox]').nth(1).uncheck(); await p.locator('.tools input[type=checkbox]').nth(2).uncheck(); }],
  ['lecture-only-off', async p => { await p.locator('.tools input[type=checkbox]').nth(0).check(); }],
  ['-reset2', async p => { await p.locator('.tools input[type=checkbox]').nth(0).uncheck(); }],
  ['slides', async p => { await p.click('.tabs button:nth-child(2)'); }],
  ['transcript-jump', async p => { await p.click('.tabs button:nth-child(1)'); await p.click('.pt .ts >> nth=4'); await p.waitForTimeout(800); }],
  ['transcript-search', async p => { await p.fill('#trList', '').catch(() => {}); await p.fill('input.search', 'midterm'); }],
  ['cards', async p => { await p.click('.tabs button:nth-child(4)'); }],
  ['cards-flipped', async p => { await p.click('.flip'); await p.waitForTimeout(600); }],
  ['cards-known', async p => { await p.click('.fc .ctl .btn:nth-child(2)'); }],
  ['quiz', async p => { await p.click('.tabs button:nth-child(5)'); }],
  ['quiz-wrong', async p => { await p.click('.qz .opt >> nth=0'); }],
  ['quiz-right', async p => { await p.click('.qz .btn.primary'); await p.click('.qz .opt >> nth=1'); }],
  ['quiz-result', async p => { for (let i = 0; i < 3; i++) { await p.click('.qz .btn.primary'); await p.click('.qz .opt >> nth=1'); } await p.click('.qz .btn.primary'); await p.waitForSelector('.result'); await p.waitForTimeout(2000); }],
  ['more', async p => { await p.evaluate(() => window.scrollTo(0, 0)); await p.click('.page-h button >> nth=0'); }],
  ['rename', async p => { await p.click('#overlay button:text-is("Rename"), #overlay button:text-is("重新命名")'); }],
  ['-close1', async p => { await p.keyboard.press('Escape'); }],
  ['delete', async p => { await p.click('.page-h button >> nth=0'); await p.click('#overlay .btn.plain >> nth=-1'); }],
  ['-close2', async p => { await p.keyboard.press('Escape'); }],
  ['share', async p => { await p.click('.page-h button >> nth=1'); await p.waitForSelector('#shareUrl'); }],
  ['-close3', async p => { await p.keyboard.press('Escape'); await p.click('.tabs button:nth-child(1)'); }],
  ['feedback', async p => { await p.click('.main p.noprint .ts'); }],
  ['-close4', async p => { await p.keyboard.press('Escape'); }],
  ['lecture-no-notes', async p => { await p.goto(O + '/#/lecture/econ-w8'); await p.waitForSelector('.main .card h3'); }],
  ['shared', async p => { await p.goto(O + '/#/s/econ-w9'); await p.waitForSelector('.shared-bar'); }],
  ['new', async p => { await p.goto(O + '/#/new'); await p.waitForSelector('.choice'); }],
  ['new-upload', async p => { await p.click('.choice button:nth-child(2)'); }],
  ['new-upload-file', async p => { await p.setInputFiles('#fRec', { name: 'week10-lecture.mp3', mimeType: 'audio/mpeg', buffer: Buffer.alloc(1258291) }); }],
  ['new-link-error', async p => { await p.click('.choice button:nth-child(3)'); await p.fill('input[type=url]', 'https://lecture'); await p.click('form button.btn.blue'); await p.waitForSelector('.err'); }],
  ['new-tab', async p => { await p.click('.choice button:nth-child(4)'); }],
  ['new-rec-tip', async p => { await p.click('.choice button:nth-child(1)'); await p.click('form button.btn.blue'); await p.waitForSelector('#overlay .modal'); }],
  ['-close5', async p => { await p.keyboard.press('Escape'); }]
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
  let same = 0, noise = 0, expected = 0, total = 0;
  for (const [w, zh] of [[375, 0], [375, 1], [1280, 0], [1280, 1]]) {
    const tag = `${w}-${zh ? 'zh' : 'en'}`;
    const SELF = process.argv.includes('--self'), e1 = run('legacy', w, zh), e2 = run(SELF ? 'legacy2' : 'dist', w, zh);
    if (e1.length || e2.length) console.log(`errors ${tag}:`, JSON.stringify({ legacy: e1, dist: e2 }));
    const rows = await compare(path.join(OUT, 'legacy', tag), path.join(OUT, SELF ? 'legacy2' : 'dist', tag), path.join(OUT, 'diff', tag), tag + '/');
    for (const r of rows) { total++; if (!r.missing && !r.diff) same++; else { if (r.noise) noise++; else if (r.expected) expected++; console.log(`${r.missing ? 'MISSING' : r.noise ? 'NOISE' : r.expected ? 'EXPECTED' : 'DIFF'}  ${tag}/${r.name}${r.diff ? `  ${r.diff} px, max channel delta ${r.maxDelta}, in box ${JSON.stringify(r.box)} sizes ${JSON.stringify(r.size)}` : ''}${r.expected ? '  (' + r.expected + ')' : ''}`); } }
  }
  console.log(`\n${same} of ${total} screenshots identical, ${noise} differ only by anti-aliasing noise, ${expected} differ on purpose (tests/known-differences.js), ${total - same - noise - expected} differ`);
})();
