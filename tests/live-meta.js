// Recording page (Task 10): a title box and a course list while recording, each saved with PATCH /lectures/:id, and the
// phone vibrates when an exam alert arrives; after End, the waiting page shows what the live transcript heard (test of
// 2026-11-18: it was empty). Real-backend mode, fake microphone, navigator.vibrate counted.
const { chromium, ORIGIN, serve, setConfig } = require('./harness');
const results = [];
const check = (name, ok, detail) => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || detail === undefined ? '' : '  -> ' + JSON.stringify(detail)}`); };

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--no-sandbox'] });
  const errs = [];
  const open = async (courseCount, width = 1280) => {
    const all = [{ id: 'c1', code: 'TEST 1001', name: '' }, { id: 'c2', code: 'TEST 2002', name: '' }];
    const be = { sent: 0, segSent: 0, patches: [], log: [], patchDelay: 0, courses: all.slice(0, courseCount) };
    const ctx = await browser.newContext({ viewport: { width, height: width < 900 ? 780 : 800 }, isMobile: width < 900, hasTouch: width < 900, permissions: ['microphone'] });
    await ctx.addInitScript(() => { try { localStorage.setItem('sidenote.recTip', '1'); localStorage.setItem('sidenote.lastCourse', 'c1'); window.__vib = 0; navigator.vibrate = () => { window.__vib++; return true; }; } catch (e) {} });
    await setConfig(ctx, { USE_MOCK: false, POLL_MS: 50, CHUNK_SECONDS: 1 });
    await ctx.route('**/*', async route => {
      const req = route.request(), u = new URL(req.url()), m = req.method(), j = (o, s = 200) => route.fulfill({ status: s, contentType: 'application/json', body: JSON.stringify(o) });
      if (!u.pathname.startsWith('/api/')) return serve(route, { USE_MOCK: false, POLL_MS: 50, CHUNK_SECONDS: 1 });
      const p = u.pathname.slice(4); be.log.push(m + ' ' + p);
      if (p === '/session') return j({ token: 'tok', user: { name: 'T' } });
      if (p === '/home') return j({ user: { name: 'T' }, courses: be.courses, lectures: be.lec ? [{ ...be.lec, status: be.status || 'recording' }] : [], upcoming: [], settings: { classLanguage: 'en', zhDefault: false } });
      if (m === 'POST' && p === '/lectures') { const b = JSON.parse(req.postData() || '{}'); be.lec = { id: 'lnew', course: b.courseId, title: b.title, date: 'Today', duration: 0, status: 'recording' }; return j(be.lec); }
      if (m === 'PATCH' && p === '/lectures/lnew') { be.patches.push(req.postData()); if (be.patchDelay) await new Promise(r => setTimeout(r, be.patchDelay)); return j(null).catch(() => {}); }
      if (m === 'POST' && p === '/lectures/lnew/finish') return j({ status: 'processing' });
      if (m === 'GET' && p === '/lectures/lnew') return j({ lecture: { id: 'lnew', course: 'c1', title: 'Week 11', date: 'Today', duration: 0, status: 'processing' }, detail: null });
      if (m === 'POST' && /\/chunks$/.test(p)) return j({ segments: be.segs && !be.segSent++ ? be.segs : [], alerts: be.alert && !be.sent++ ? [{ t: 5, kind: 'Exam', text: 'Exam on Friday' }] : [] });
      if (/\/status$/.test(p)) return j({ status: be.status || 'recording' });
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
  // On an iPhone, tapping End with the keyboard up does not take the focus from the title box, so the box is never left:
  // the click is sent from the page here, which keeps the focus in the box. The answer to the PATCH comes late (after
  // /finish) and must not leave a "recording in progress" mark behind.
  { const { ctx, page, be } = await open(2); be.patchDelay = 800;
    await page.fill('.live-meta input', 'Week 11'); await page.waitForTimeout(1200);
    const focused = await page.evaluate(() => document.activeElement === document.querySelector('.live-meta input'));
    await page.evaluate(() => [...document.querySelectorAll('.live-actions button')].find(b => b.textContent.trim() === 'End and make notes').click());
    await page.waitForFunction(() => location.hash.startsWith('#/lecture/'), null, { timeout: 8000 }).catch(() => {}); await page.waitForTimeout(1200);
    const api = be.log.filter(x => /^(PATCH|POST) \/lectures\/lnew(\/finish)?$/.test(x)), mark = await page.evaluate(() => localStorage.getItem('sidenote.live'));
    check('ending the recording while the title box still has the focus sends the title (PATCH) before /finish, and leaves no recording mark', focused && api[0] === 'PATCH /lectures/lnew' && api.includes('POST /lectures/lnew/finish') && be.patches[0] === '{"title":"Week 11"}' && mark === null, { focused, api, patches: be.patches, mark });
    await ctx.close(); }
  { const { ctx, page, be } = await open(1); be.status = 'processing'; be.segs = [{ t: 1, text: 'Today we cover elasticity.' }, { t: 4, text: 'The midterm is on Friday.' }];
    await page.waitForFunction(() => /elasticity/.test(document.body.innerText), null, { timeout: 8000 }).catch(() => {});
    await page.evaluate(() => [...document.querySelectorAll('.live-actions button')].find(b => b.textContent.trim() === 'End and make notes').click());
    await page.waitForSelector('.main .card.wait', { timeout: 8000 }).catch(() => {});
    const heard = { h: await page.locator('.main h2').first().innerText().catch(() => ''), lines: await page.locator('.main .stream .seg-line').allInnerTexts() };
    check('after End, the page that waits for the notes shows what the live transcript heard', heard.h === 'What was said, as heard live' && heard.lines.length === 2 && heard.lines[0].includes('Today we cover elasticity.'), heard);
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
  for (const w of [375, 390]) { const { ctx, page } = await open(2, w);
    const r = await page.evaluate(() => { const i = document.querySelector('.live-meta input'), ph = getComputedStyle(i, '::placeholder'), cs = getComputedStyle(i), c = document.createElement('canvas').getContext('2d');
      c.font = `${ph.fontStyle} ${ph.fontWeight} ${ph.fontSize} ${ph.fontFamily}`; const inner = i.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight); return { text: c.measureText(i.placeholder).width, inner, font: c.font }; });
    check(`at ${w} px the placeholder of the title box fits inside the box (not clipped)`, r.text <= r.inner, r);
    await ctx.close(); }
  check('no page errors', errs.length === 0, errs);
  await browser.close();
  console.log(`\n${results.filter(Boolean).length} of ${results.length} checks passed`);
  process.exit(results.every(Boolean) ? 0 : 1);
})();
