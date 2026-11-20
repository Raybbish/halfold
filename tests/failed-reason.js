// Why a lecture failed, when the backend knows (API-CHANGES.md section 9: lecture.error), such as a video link that
// needs a sign-in. Real-backend mode (fake API by request interception): the reason is shown instead of "Your recording
// is safe", Try again still asks the backend again, a failed lecture without a reason keeps the old sentence, and in
// Chinese the reason is shown as the backend sent it (never translated, even when it equals a dictionary key), except our
// own server's sentences about links, which are in Chinese (SERVER in src/i18n/zh.ts, test of 2026-11-18). And a
// link the backend refuses when it is sent leaves no empty lecture behind (it would count toward the month's lectures).
const { chromium, ORIGIN, serve, setConfig } = require('./harness');
const results = [];
const check = (name, ok, detail) => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || detail === undefined ? '' : '  -> ' + JSON.stringify(detail)}`); };

const REASON = 'This video needs a sign-in or permission to watch, so it could not be downloaded. Record it with Record an online class while it plays, or download the video and upload the file.';
const SAFE = 'Your recording is safe. Hal can try again from it.';

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const errs = [], log = [];
  const lec = (id, extra) => ({ id, course: 'c1', title: 'Week 9 replay', date: 'Today', status: 'failed', ...extra });
  const LECTURES = [lec('l1', { link: 'https://www.youtube.com/watch?v=abc', error: REASON }), lec('l2', {}), lec('l3', { link: 'https://vimeo.com/1', error: 'Try again' })];
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await setConfig(ctx, { USE_MOCK: false, POLL_MS: 50 });
  await ctx.route('**/*', async route => {
    const req = route.request(), u = new URL(req.url()), m = req.method(), j = (o, s = 200) => route.fulfill({ status: s, contentType: 'application/json', body: JSON.stringify(o) });
    if (!u.pathname.startsWith('/api/')) return serve(route, { USE_MOCK: false, POLL_MS: 50 });
    const p = u.pathname.slice(4); log.push(m + ' ' + p);
    if (p === '/session') return j({ token: 'tok', user: { name: 'T' } });
    if (p === '/home') return j({ user: { name: 'T' }, courses: [{ id: 'c1', code: 'TEST 1001' }], lectures: LECTURES, upcoming: [], settings: { classLanguage: 'en', zhDefault: false } });
    const one = /^\/lectures\/(l\d)$/.exec(p);
    if (m === 'GET' && one) return j({ lecture: LECTURES.find(x => x.id === one[1]), detail: null });
    if (m === 'POST' && /^\/lectures\/l\d\/retry$/.test(p)) return j({ status: 'processing' });
    if (m === 'POST' && p === '/lectures') return j({ id: 'lnew', course: 'c1', title: 'Untitled lecture', date: 'Today', status: 'recording' });
    if (m === 'POST' && p === '/lectures/lnew/link') return j({ message: 'Only public links can be opened. This one points to a private network.' }, 400);
    if (m === 'DELETE' && p === '/lectures/lnew') return route.fulfill({ status: 204 });
    if (/^\/lectures\/l\d\/status$/.test(p)) return j({ status: 'processing' });
    return j({ message: 'Not found' }, 404);
  });
  const page = await ctx.newPage(); page.on('pageerror', e => errs.push(e.message));
  await page.goto(ORIGIN + '/#/signin'); await page.fill('input[name=code]', 'abc'); await page.click('form.auth button'); await page.waitForSelector('.shell');
  const box = async id => {
    await page.goto(ORIGIN + '/#/lecture/' + id); await page.waitForSelector('.main .card h3'); await page.waitForTimeout(200);
    return { h: await page.locator('.main .card h3').first().innerText(), p: await page.locator('.main .card p.muted').first().innerText(), btn: await page.locator('.main .card .btn.primary').first().innerText() };
  };

  const a = await box('l1');
  check('a failed lecture with a reason from the backend shows that reason instead of "Your recording is safe"', a.h === 'These notes could not be written' && a.p === REASON, a);
  await page.click('.main .card .btn.primary'); await page.waitForTimeout(300);
  check('Try again is still there and asks the backend to try again', a.btn === 'Try again' && log.includes('POST /lectures/l1/retry'), { btn: a.btn, log: log.filter(x => x.startsWith('POST')) });

  const b = await box('l2');
  check('a failed lecture without a reason keeps the old sentence', b.p === SAFE, b);

  await page.evaluate(() => window.__sidenote.setLang('zh'));
  const c = await box('l3');
  check('in Chinese the heading is translated but the reason is shown as the backend sent it', c.h !== 'These notes could not be written' && c.p === 'Try again', c);
  const d = await box('l1');
  check('in Chinese, a reason that is one of our server\'s own sentences is shown in Chinese', d.p === '這段影片要登入或取得權限才能觀看，所以無法下載。可以在播放時用「錄網上課堂」錄下來，或自行下載影片後上載檔案。', d);

  await page.evaluate(() => window.__sidenote.setLang('en'));
  await page.goto(ORIGIN + '/#/new'); await page.waitForSelector('.choice');
  await page.click('.choice button:has-text("Paste a lecture video link")');
  await page.fill('input[type=url]', 'https://intranet.example/week9.mp4');
  await page.click('form button.btn.blue');
  await page.waitForSelector('.toast', { timeout: 10000 }); await page.waitForTimeout(300);
  const refused = { toast: await page.locator('.toast').last().innerText(), url: page.url(), link: await page.inputValue('input[type=url]'), log: log.filter(x => /lnew|POST \/lectures$/.test(x)) };
  check('a link the backend refuses: its message is shown, the empty lecture is deleted, the form keeps the link', /Only public links/.test(refused.toast) && refused.log.includes('DELETE /lectures/lnew') && refused.url.endsWith('#/new') && refused.link === 'https://intranet.example/week9.mp4', refused);

  check('no page errors', errs.length === 0, errs);
  await browser.close();
  console.log(`\n${results.filter(Boolean).length} of ${results.length} checks passed`);
})().catch(e => { console.error('SCRIPT ERROR', String(e.message).slice(0, 1200)); process.exit(1); });
