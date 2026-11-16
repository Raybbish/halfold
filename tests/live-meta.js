// Recording page (Task 10): a title box and a course list while recording, each saved with PATCH /lectures/:id, and the
// phone vibrates when an exam alert arrives. Real-backend mode, fake microphone, navigator.vibrate counted.
const { chromium, ORIGIN, serve, setConfig } = require('./harness');
const results = [];
const check = (name, ok, detail) => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || detail === undefined ? '' : '  -> ' + JSON.stringify(detail)}`); };

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--no-sandbox'] });
  const errs = [];
  const open = async courseCount => {
    const all = [{ id: 'c1', code: 'TEST 1001', name: '' }, { id: 'c2', code: 'TEST 2002', name: '' }];
    const be = { sent: 0, patches: [], courses: all.slice(0, courseCount) };
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, permissions: ['microphone'] });
    await ctx.addInitScript(() => { try { localStorage.setItem('sidenote.recTip', '1'); localStorage.setItem('sidenote.lastCourse', 'c1'); window.__vib = 0; navigator.vibrate = () => { window.__vib++; return true; }; } catch (e) {} });
    await setConfig(ctx, { USE_MOCK: false, POLL_MS: 50, CHUNK_SECONDS: 1 });
    await ctx.route('**/*', async route => {
      const req = route.request(), u = new URL(req.url()), m = req.method(), j = (o, s = 200) => route.fulfill({ status: s, contentType: 'application/json', body: JSON.stringify(o) });
      if (!u.pathname.startsWith('/api/')) return serve(route, { USE_MOCK: false, POLL_MS: 50, CHUNK_SECONDS: 1 });
      const p = u.pathname.slice(4);
      if (p === '/session') return j({ token: 'tok', user: { name: 'T' } });
      if (p === '/home') return j({ user: { name: 'T' }, courses: be.courses, lectures: [], upcoming: [], settings: { classLanguage: 'en', zhDefault: false } });
      if (m === 'POST' && p === '/lectures') { const b = JSON.parse(req.postData() || '{}'); return j({ id: 'lnew', course: b.courseId, title: b.title, date: 'Today', duration: 0, status: 'recording' }); }
      if (m === 'PATCH' && p === '/lectures/lnew') { be.patches.push(req.postData()); return j(null); }
      if (m === 'POST' && /\/chunks$/.test(p)) return j({ segments: [], alerts: be.alert && !be.sent++ ? [{ t: 5, kind: 'Exam', text: 'Exam on Friday' }] : [] });
      if (/\/status$/.test(p)) return j({ status: 'recording' });
      return j({ message: 'Not found' }, 404);
    });
    const page = await ctx.newPage(); page.on('pageerror', e => errs.push(e.message));
    await page.goto(ORIGIN + '/#/signin'); await page.fill('input[name=code]', 'abc'); await page.click('form.auth button'); await page.waitForSelector('.shell');
    await page.evaluate(() => { location.hash = '#/home'; }); await page.waitForSelector('.rec-btn', { timeout: 5000 }); await page.waitForTimeout(300);
    await page.click('.rec-btn'); await page.waitForFunction(() => location.hash === '#/live', null, { timeout: 8000 }).catch(() => {}); await page.waitForSelector('.live-top', { timeout: 5000 }).catch(() => {});
    return { ctx, page, be };
  };

  { const { ctx, page, be } = await open(2);
    const ph = await page.getAttribute('.live-meta input', 'placeholder').catch(() => null), val = await page.inputValue('.live-meta input').catch(() => null);
    const courseOpts = await page.locator('.live-meta select option').count().catch(() => 0);
    check('the recording page has a title box "Name this lecture (optional, you can do it later)" and a course list', ph === 'Name this lecture (optional, you can do it later)' && val === '' && courseOpts === 2, { ph, val, courseOpts });
    await page.fill('.live-meta input', 'Week 10'); await page.press('.live-meta input', 'Tab'); await page.waitForTimeout(400);
    check('typing a title and leaving the box saves it', be.patches[0] === '{"title":"Week 10"}', be.patches);
    await page.selectOption('.live-meta select', 'c2'); await page.waitForTimeout(400);
    const top = await page.innerText('.live-top'), lc = await page.evaluate(() => localStorage.getItem('sidenote.lastCourse'));
    check('choosing another course saves it, shows its code and remembers it', be.patches[1] === '{"course":"c2"}' && /TEST 2002/.test(top) && lc === 'c2', { p: be.patches, top, lc });
    await page.focus('.live-meta input'); await page.fill('.live-meta input', ''); await page.press('.live-meta input', 'Tab'); await page.waitForTimeout(300);
    check('the dated title is not sent again when the box is left empty', be.patches.length === 2, be.patches);
    await ctx.close(); }
  { const { ctx, page } = await open(1);
    const n = await page.locator('.live-meta select').count(), input = await page.locator('.live-meta input').count();
    check('with one course there is no course list', n === 0 && input === 1, { n, input });
    await ctx.close(); }
  { const { ctx, page, be } = await open(2); be.alert = true;
    await page.waitForFunction(() => window.__vib >= 1, null, { timeout: 8000 }).catch(() => {}); await page.waitForTimeout(1500);
    const v = await page.evaluate(() => window.__vib);
    check('an exam alert vibrates the phone', v === 1, v);
    await ctx.close(); }
  check('no page errors', errs.length === 0, errs);
  await browser.close();
  console.log(`\n${results.filter(Boolean).length} of ${results.length} checks passed`);
  process.exit(results.every(Boolean) ? 0 : 1);
})();
