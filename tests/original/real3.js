// Retention hooks: what the page shows for audio.keptUntil, audio.expired and usage.audioDays (real-backend mode, fake API).
const fs = require('fs');
const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const SRC = fs.readFileSync(process.argv[2], 'utf8').replace('USE_MOCK: true', 'USE_MOCK: false');
const ORIGIN = 'http://localhost:8765';
const WAV = (() => { const n = 8000 * 5, b = Buffer.alloc(44 + n, 128); b.write('RIFF', 0); b.writeUInt32LE(36 + n, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(8000, 24); b.writeUInt32LE(8000, 28); b.writeUInt16LE(1, 32); b.writeUInt16LE(8, 34); b.write('data', 36); b.writeUInt32LE(n, 40); return b; })();
const results = [];
const check = (name, ok, detail) => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail !== undefined ? '  -> ' + JSON.stringify(detail) : ''}`); };
const DETAIL = audio => ({ audio, alerts: [], sections: [{ title: 'Part one', start: 0, end: 300, points: [{ t: 95, text: 'A point', off: false, slide: null }] }], slides: [],
  transcript: [{ t: 0, text: 'line 0' }, { t: 90, text: 'line 90' }], flashcards: [], quiz: [] });

(async () => {
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
  async function run(audio, usage, fn, viewport = { width: 390, height: 780 }) {
    const ctx = await browser.newContext({ viewport, isMobile: viewport.width < 900, hasTouch: viewport.width < 900, timezoneId: 'Asia/Hong_Kong' });
    const page = await ctx.newPage(); const errs = []; page.on('pageerror', e => errs.push(e.message));
    await page.clock.setFixedTime(new Date('2026-11-11T14:00:00+08:00'));
    await page.route('**/*', route => {
      const u = new URL(route.request().url()), j = o => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
      if (u.pathname.startsWith('/audio/')) return route.fulfill({ status: 200, contentType: 'audio/wav', body: WAV });
      if (!u.pathname.startsWith('/api/')) return route.fulfill({ status: 200, contentType: 'text/html', body: SRC });
      const p = u.pathname.slice(4), lec = { id: 'l1', course: 'c1', title: 'Week 9', date: 'Tue 10 Nov', duration: 300, status: 'ready' };
      if (p === '/session') return j({ token: 't', user: { name: 'Jasper' } });
      if (p === '/home') return j({ user: { name: 'Jasper' }, courses: [{ id: 'c1', code: 'ECON 1001', name: 'Micro' }], lectures: [lec], upcoming: [], settings: { classLanguage: 'en', zhDefault: false }, usage });
      if (p === '/lectures/l1') return j({ lecture: lec, detail: DETAIL(audio) });
      if (p === '/shared/l1') return j({ lecture: lec, course: { id: 'c1', code: 'ECON 1001' }, detail: DETAIL(audio), sharedBy: 'Jasper' });
      return route.fulfill({ status: 404, contentType: 'application/json', body: '{"message":"Not found"}' });
    });
    await page.goto(ORIGIN + '/#/signin'); await page.fill('input[name=code]', 'abc'); await page.click('form.auth button'); await page.waitForSelector('.shell');
    await page.goto(ORIGIN + '/#/lecture/l1'); await page.waitForSelector('.tabs');
    const alerts = async () => (await page.locator('.main .alert').allInnerTexts()).map(s => s.replace(/\s+/g, ' '));
    const more = async () => { await page.click('.page-h button:text-is("More")'); const t = (await page.locator('#overlay').innerText()).replace(/\s+/g, ' '); await page.keyboard.press('Escape'); return t; };
    await fn({ page, alerts, more }); if (errs.length) check('no page errors', false, errs); await ctx.close();
  }
  const url = ORIGIN + '/audio/a.m4a';

  await run({ url }, undefined, async ({ page, alerts, more }) => {
    check('no retention fields: player, no notice, no date in the menu', (await page.locator('#pPlay').count()) === 1 && (await alerts()).length === 0 && !(await more()).includes('kept until'));
    await page.goto(ORIGIN + '/#/settings'); await page.waitForSelector('text=Plan and usage');
    check('settings: no retention line without usage.audioDays', !(await page.locator('.main').innerText()).includes('Recordings are kept'));
  });
  await run({ url, keptUntil: '2026-12-11' }, { minutesToday: 10, minutesLimit: 240, audioDays: 30 }, async ({ page, alerts, more }) => {
    check('30 days left: no notice on the page', (await alerts()).length === 0, await alerts());
    check('30 days left: the More menu shows the date', (await more()).includes('Recording kept until 11 Dec.'));
    await page.goto(ORIGIN + '/#/settings'); await page.waitForSelector('text=Plan and usage');
    check('settings shows the plan\'s retention', (await page.locator('.main').innerText()).includes('Recordings are kept for 30 days on your plan.'));
  });
  await run({ url, keptUntil: '2026-11-16' }, undefined, async ({ page, alerts }) => {
    const a = await alerts(); check('5 days left: notice with the date and days left', a.length === 1 && a[0] === 'Recording The recording of this lecture is kept until 16 Nov, 5 more days. The notes stay after that.' && (await page.locator('#pPlay').count()) === 1, a);
    await page.screenshot({ path: 'shots3/keep-5-days.png' });
  });
  await run({ url, keptUntil: '2026-11-11' }, undefined, async ({ alerts }) => { const a = await alerts(); check('last day: says today', a.length === 1 && a[0].includes('kept until 11 Nov, which is today'), a); });
  await run({ expired: true }, undefined, async ({ page, alerts, more }) => {
    const a = await alerts(); check('expired: notice instead of the player', a.length === 1 && a[0].startsWith('Recording The recording of this lecture is no longer kept.') && (await page.locator('.player').count()) === 0, a);
    check('expired: no download link in the menu', !(await more()).includes('Download recording'));
    await page.locator('.pt .ts').first().click(); await page.waitForTimeout(300);
    check('expired: timestamps still open the transcript line', (await page.locator('.seg-line.hit').getAttribute('id')) === 'seg-90');
    await page.screenshot({ path: 'shots3/keep-expired.png' });
    await page.goto(ORIGIN + '/#/s/l1'); await page.waitForSelector('.shared-bar');
    check('shared page never shows the owner\'s retention notice', (await page.locator('.alert').count()) === 0);
  });
  await browser.close();
  console.log(`\n${results.filter(Boolean).length} of ${results.length} checks passed`);
})().catch(e => { console.error('SCRIPT ERROR', String(e.message).slice(0, 900)); process.exit(1); });
