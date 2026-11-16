// Adapted from tests/original/shots5.js for the React build (see tests/harness.js). Only how the page is loaded and configured changed; the checks are as they were,
// except one wait: before the transcript-playing shot, the page's smooth scroll is let finish (scrolled() below), so that shot no longer depends on timing.
const { chromium, ORIGIN } = require('./harness');   // was: playwright from /opt/npm-tools
const FILE = ORIGIN + '/';   // was: 'file://' + argv[2]
(async () => {
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true,
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--no-sandbox'] });
  const errors = [];
  async function run(name, opts, zh) {
    const ctx = await browser.newContext({ deviceScaleFactor: 1, permissions: ['microphone'], ...opts });
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(name + ' pageerror: ' + e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(name + ' console: ' + m.text()); });
    const shot = async (n, full = false) => { await page.waitForTimeout(600); await page.screenshot({ path: `shots5/${name}-${n}.png`, fullPage: full }); };
    // Waits until the page has not scrolled for 10 frames in a row. A timestamp starts a smooth scroll to its line; clicking
    // Play while that runs made Playwright scroll the button into view mid-way, so where the page stopped depended on timing.
    const scrolled = () => page.evaluate(() => new Promise(done => { let y = scrollY, still = 0; const f = () => { if (scrollY !== y) { y = scrollY; still = 0; } else if (++still >= 10) return done(); requestAnimationFrame(f); }; requestAnimationFrame(f); }));
    await page.goto(FILE + '#/'); if (zh) await page.selectOption('.lang', 'zh-Hant'); await shot('01-landing');
    await page.goto(FILE + '#/signin'); await shot('02-signin');
    await page.fill('input[name=code]', 'a3f9c2'); await page.click('form.auth button'); await page.waitForSelector('.shell'); await shot('03-home');
    await page.goto(FILE + '#/lecture/econ-w9'); await page.waitForSelector('.tabs'); await shot('04-notes');
    await page.locator('.tools input[type=checkbox]').nth(2).check(); await page.evaluate(() => window.scrollTo(0, 620)); await shot('04b-edit-mode');
    await page.locator('.tools input[type=checkbox]').nth(2).uncheck();
    await page.click('.pt .ts >> nth=4'); await scrolled(); await page.click('#pPlay'); await page.waitForTimeout(1500); await shot('05-transcript-playing'); await page.click('#pPlay');
    await page.click('.tabs button:nth-child(2)'); await shot('06-slides');
    await page.click('.tabs button:nth-child(4)'); await shot('07-cards');
    await page.click('.tabs button:nth-child(5)'); await page.click('.qz .opt:nth-of-type(1)'); await shot('08-quiz');
    await page.evaluate(() => window.scrollTo(0, 0)); await page.click('.page-h button >> nth=0'); await shot('09-more'); await page.keyboard.press('Escape');
    await page.click('.page-h button >> nth=1'); await shot('10-share'); await page.keyboard.press('Escape');
    await page.goto(FILE + '#/courses'); await shot('11-courses');
    await page.goto(FILE + '#/course/econ1001'); await shot('12-course');
    await page.goto(FILE + '#/pack/econ1001'); await page.waitForSelector('.page-h'); await page.click('.main .card button.btn.primary'); await page.waitForSelector('.pk', { timeout: 20000 }); await shot('13-pack'); await page.evaluate(() => window.scrollTo(0, 99999)); await shot('13b-pack-bottom');
    await page.goto(FILE + '#/new'); await shot('14-new');
    await page.click('form button.btn.blue'); await shot('14b-before-you-record'); await page.click('#overlay button.btn.primary'); await page.waitForSelector('.live-top'); await page.waitForTimeout(6500); await page.click('.catch .btn'); await page.waitForTimeout(1200); await shot('15-live');
    await page.goto(FILE + '#/home'); await page.waitForSelector('#lecList'); await shot('16-home-while-recording');
    await page.goto(FILE + '#/settings'); await page.waitForSelector('form'); await shot('17-settings', true);
    await page.goto(FILE + '#/live'); await page.click('.live-actions .btn.dark'); await page.waitForSelector('.tabs', { timeout: 20000 }); await shot('18-after-end');
    await page.goto(FILE + '#/s/econ-w9'); await page.waitForSelector('.shared-bar'); await shot('19-shared');
    await ctx.close();
  }
  for (const zh of [false, true]) {
    await run('m-' + (zh ? 'zh' : 'en'), { viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true }, zh);
    await run('d-' + (zh ? 'zh' : 'en'), { viewport: { width: 1280, height: 800 } }, zh);
  }
  console.log(errors.length ? errors.join('\n') : 'no console/page errors');
  await browser.close();
})().catch(e => { console.error('SCRIPT ERROR', String(e.message).slice(0, 900)); process.exit(1); });
