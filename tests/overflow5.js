// Adapted from tests/original/overflow5.js for the React build (see tests/harness.js). Only how the page is loaded and configured changed; the checks are as they were.
// Mock mode: look for sideways scrolling and elements hidden under the fixed bars at several phone and tablet widths.
const { chromium, ORIGIN } = require('./harness');   // was: playwright from /opt/npm-tools
const FILE = ORIGIN + '/';   // was: 'file://' + argv[2]
(async () => {
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--no-sandbox'] });
  const bad = [], errors = [];
  for (const [w, zh] of [[320, 0], [320, 1], [360, 0], [390, 1], [430, 0], [768, 1], [900, 0], [901, 1], [1280, 0]]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: 760 }, isMobile: w < 900, hasTouch: w < 900, permissions: ['microphone'] });
    const page = await ctx.newPage(); page.on('pageerror', e => errors.push(w + ': ' + e.message)); await ctx.addInitScript(() => { try { localStorage.setItem('sidenote.recTip', '1'); } catch (e) {} });
    const probe = async name => { await page.waitForTimeout(250); const r = await page.evaluate(() => {
        const sw = document.documentElement.scrollWidth, iw = innerWidth, wide = [];
        if (sw > iw) document.querySelectorAll('#app *').forEach(el => { const b = el.getBoundingClientRect(); if (b.right > iw + 1 && b.width > 0 && !el.closest('.tabs') && !el.closest('.stream')) wide.push(el.tagName + '.' + String(el.className).slice(0, 30) + ' right=' + Math.round(b.right)); });
        return { sw, iw, wide: wide.slice(0, 4) }; });
      if (r.sw > r.iw) bad.push(`${w}px ${zh ? 'zh' : 'en'} ${name}: page is ${r.sw}px wide -> ${r.wide.join(' | ')}`); };
    await page.goto(FILE + '#/'); if (zh) await page.click('.lang'); await probe('landing');
    await page.goto(FILE + '#/signin'); await probe('signin'); await page.fill('input[name=code]', 'x'); await page.click('form.auth button'); await page.waitForSelector('.shell'); await probe('home');
    await page.goto(FILE + '#/courses'); await probe('courses'); await page.goto(FILE + '#/course/econ1001'); await probe('course'); await page.goto(FILE + '#/pack/econ1001'); await page.waitForSelector('.page-h'); await page.click('.main .card button.btn.primary'); await page.waitForSelector('.pk', { timeout: 20000 }); await probe('pack');
    await page.goto(FILE + '#/lecture/econ-w9'); await page.waitForSelector('.tabs');
    for (const i of [1, 2, 3, 4, 5]) { await page.click(`.tabs button:nth-child(${i})`); await probe('lecture tab ' + i); }
    await page.click('.tabs button:nth-child(1)'); await page.locator('.tools input[type=checkbox]').nth(1).check(); await page.locator('.tools input[type=checkbox]').nth(2).check(); await probe('edit mode with 中文解釋'); await page.click('.tabs button:nth-child(5)');
    await page.click('.qz .opt:nth-of-type(2)'); await probe('quiz answered');
    await page.goto(FILE + '#/new'); await probe('new'); await page.click('.choice button:nth-child(2)'); await probe('new upload'); await page.click('.choice button:nth-child(1)');
    await page.click('form button.btn.blue'); await page.waitForSelector('.live-top'); await page.waitForTimeout(3500); await page.click('.catch .btn'); await page.waitForTimeout(900); await probe('live');
    await page.goto(FILE + '#/home'); await probe('home while recording'); await page.goto(FILE + '#/settings'); await probe('settings');
    await page.goto(FILE + '#/live'); await page.click('.live-actions .btn.dark'); await page.waitForSelector('.tabs', { timeout: 15000 }); await probe('notes after recording');
    await page.goto(FILE + '#/s/econ-w9'); await page.waitForSelector('.shared-bar'); await probe('shared, signed in');
    await ctx.close();
  }
  console.log(bad.length ? bad.join('\n') : 'no sideways scrolling at 320, 360, 390, 430, 768, 900, 901, 1280 px (English and Chinese)');
  console.log(errors.length ? errors.join('\n') : 'no page errors');
  await browser.close();
})().catch(e => { console.error('SCRIPT ERROR', String(e.message).slice(0, 600)); process.exit(1); });
