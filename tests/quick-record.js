// One tap from the home page (Task 8): the "Class starting?" card with a course list that remembers the last course
// used and a Record button, a dated default title (with autoTitle), "Pick up where you left off", and the lecture
// that is deleted again when the microphone is refused. Real-backend mode (fake API by request interception), with a
// fake microphone (as tests/real5.js).
const { chromium, ORIGIN, serve, setConfig } = require('./harness');
const results = [];
const check = (name, ok, detail) => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || detail === undefined ? '' : '  -> ' + JSON.stringify(detail)}`); };

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--no-sandbox'] });
  const errs = [];
  const COURSES = [{ id: 'c1', code: 'TEST 1001', name: '' }, { id: 'c2', code: 'TEST 2002', name: '' }];
  const LECS = [{ id: 'w9', course: 'c1', title: 'Week 9 replay', date: 'Today', duration: 300, status: 'ready' }];
  // opts: courses, lectures, init (init script), store ({key: value} put in localStorage as sidenote.<key>)
  const open = async (opts = {}) => {
    const be = { log: [], posts: [], courses: (opts.courses || COURSES).map(c => ({ ...c })), lectures: (opts.lectures || LECS).map(l => ({ ...l })) };
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, permissions: ['microphone'] });
    await ctx.addInitScript(s => { try { localStorage.setItem('sidenote.recTip', '1'); for (const k in s) localStorage.setItem('sidenote.' + k, s[k]); } catch (e) {} }, opts.store || {});
    if (opts.init) await ctx.addInitScript(opts.init);
    await setConfig(ctx, { USE_MOCK: false, POLL_MS: 50 });
    await ctx.route('**/*', async route => {
      const req = route.request(), u = new URL(req.url()), m = req.method(), j = (o, s = 200) => route.fulfill({ status: s, contentType: 'application/json', body: JSON.stringify(o) });
      if (!u.pathname.startsWith('/api/')) return serve(route, { USE_MOCK: false, POLL_MS: 50 });
      const p = u.pathname.slice(4); be.log.push(m + ' ' + p); const body = () => { try { return JSON.parse(req.postData() || '{}'); } catch (e) { return {}; } };
      if (p === '/session') return j({ token: 'tok', user: { name: 'T' } });
      if (p === '/home') return j({ user: { name: 'T' }, courses: be.courses, lectures: be.lectures, upcoming: [], usage: opts.usage, settings: { classLanguage: 'en', zhDefault: false } });
      if (m === 'POST' && p === '/courses') { await new Promise(r => setTimeout(r, 400)); const b = body(); be.courseBody = b; const c = { id: 'cn' + be.courses.length, code: b.code, name: b.name || '' }; be.courses.push(c); return j(c); }
      if (m === 'POST' && p === '/lectures') { const b = body(); be.posts.push(b); return j({ id: 'lnew', course: b.courseId, title: b.title, date: 'Today', duration: 0, status: 'recording' }); }
      const one = /^\/lectures\/([\w-]+)$/.exec(p);
      if (m === 'GET' && one) return j({ lecture: be.lectures.find(x => x.id === one[1]), detail: null });
      if (m === 'DELETE' && one) return route.fulfill({ status: 204 });
      if (m === 'POST' && /\/chunks$/.test(p)) return j({ segments: [], alerts: [] });
      if (/\/status$/.test(p)) return j({ status: 'recording' });
      return j({ message: 'Not found' }, 404);
    });
    const page = await ctx.newPage(); page.on('pageerror', e => errs.push(e.message));
    await page.goto(ORIGIN + '/#/signin'); await page.fill('input[name=code]', 'abc'); await page.click('form.auth button'); await page.waitForSelector('.shell');
    await page.evaluate(() => { location.hash = '#/home'; }); await page.waitForSelector('.page-h, .center', { timeout: 5000 }); await page.waitForTimeout(300);
    return { ctx, page, be };
  };
  const hero = page => page.evaluate(() => { const h = document.querySelector('.rec-hero'), s = h && h.querySelector('select'); return h ? { h2: h.querySelector('h2').textContent, text: h.innerText, opts: s ? [...s.options].map(o => o.value) : [], selected: s ? s.value : null, record: !!h.querySelector('button.rec-btn') } : null; });
  const newSelected = page => page.evaluate(() => { const s = document.querySelector('#fCourse'); return s ? s.value : null; });

  console.log('=== home card and Record ===');
  { const { ctx, page, be } = await open({ store: { lastCourse: 'c2' } });
    const hr = await hero(page);
    check('home shows "Class starting?" with a course list and a Record button', hr && hr.h2 === 'Class starting?' && hr.opts.length === 2 && hr.record, hr);
    check('the course list starts at the last course used', hr && hr.selected === 'c2', hr);
    await page.click('.rec-btn'); await page.waitForFunction(() => location.hash === '#/live', null, { timeout: 8000 }).catch(() => {}); await page.waitForTimeout(300);
    const body = be.posts[0] || {};
    check('Record creates a recording lecture in that course with a dated title (day and time, so two lectures of one day differ) and autoTitle', body.courseId === 'c2' && body.source === 'record' && body.autoTitle === true && /^Lecture, \w{3} \d{1,2} \w{3}, \d{2}:\d{2}$/.test(body.title), body);
    check('and goes to the recording page', page.url().endsWith('#/live'), page.url());
    await page.evaluate(() => { location.hash = '#/home'; }); await page.waitForSelector('.rec-hero'); await page.waitForTimeout(200);
    const on = await hero(page);
    check('while recording the home card says "Recording <code>" and "Return to the recording"', on && /^Recording TEST 2/.test(on.text) && /Return to the recording/.test(on.text), on);
    await ctx.close(); }
  { const { ctx, page, be } = await open({ store: { lastCourse: 'c1' } });
    await page.selectOption('.rec-hero select', 'c2');
    const kept = await page.evaluate(() => localStorage.getItem('sidenote.lastCourse'));
    check('choosing a course in the card remembers it', kept === 'c2', kept);
    await ctx.close(); }

  console.log('\n=== no course, no lectures ===');
  { const { ctx, page, be } = await open({ courses: [], lectures: [] });
    const hr = await hero(page);
    check('a student with no lectures yet also gets the Record card', hr && hr.h2 === 'Class starting?' && hr.record, hr);
    await page.click('.rec-btn'); await page.waitForFunction(() => location.hash === '#/live', null, { timeout: 8000 }).catch(() => {});
    check('with no course yet, Record first adds a course called "My classes"', be.log.indexOf('POST /courses') >= 0 && be.log.indexOf('POST /courses') < be.log.indexOf('POST /lectures') && be.courseBody && be.courseBody.code === 'My classes', { log: be.log, c: be.courseBody });
    await ctx.close(); }

  { const { ctx, page, be } = await open({ courses: [], lectures: [] });
    await page.click('.rec-btn'); await page.click('.rec-btn').catch(() => {}); await page.waitForFunction(() => location.hash === '#/live', null, { timeout: 8000 }).catch(() => {}); await page.waitForTimeout(500);
    const n = be.log.filter(x => x === 'POST /courses').length;
    check('with no course, two quick taps on Record create exactly one course', n === 1, { n, log: be.log });
    await ctx.close(); }

  console.log('\n=== daily limit ===');
  { const { ctx, page, be } = await open({ usage: { minutesToday: 60, minutesLimit: 60 } });
    await page.click('.rec-btn'); await page.waitForSelector('.toast', { timeout: 4000 }).catch(() => {}); await page.waitForTimeout(300);
    const cls = await page.locator('.toast').last().getAttribute('class').catch(() => ''), txt = await page.locator('.toast').last().innerText().catch(() => '');
    check('with the daily minutes used up, Record on home shows the limit as a red notice and creates no lecture', /bad/.test(cls) && /used today's recording minutes/.test(txt) && !be.log.includes('POST /lectures') && page.url().indexOf('#/live') < 0, { cls, txt, log: be.log });
    await page.evaluate(() => { location.hash = '#/new'; }); await page.waitForSelector('form.card'); await page.waitForTimeout(300);
    const stale = await page.locator('form.card .err').count();
    check('New lecture afterwards shows no stale error', stale === 0, stale);
    await ctx.close(); }

  console.log('\n=== microphone refused ===');
  { const { ctx, page, be } = await open({ init: () => { try { navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('no', 'NotAllowedError')); } catch (e) {} } });
    await page.click('.rec-btn'); await page.waitForSelector('.toast', { timeout: 8000 }).catch(() => {}); await page.waitForTimeout(300);
    const errText = await page.locator('.toast').last().innerText().catch(() => ''), inList = await page.evaluate(() => window.__sidenote.S.lectures.some(l => l.id === 'lnew'));
    check('when the microphone is refused, the new lecture is deleted and the reason shown', be.log.includes('DELETE /lectures/lnew') && /Microphone access was blocked/.test(errText) && !inList && !page.url().endsWith('#/live'), { log: be.log, errText, inList });
    await ctx.close(); }

  console.log('\n=== New lecture page ===');
  const startOnNew = async (title, extra) => {
    const o = await open({ store: { lastCourse: 'c2' }, ...extra }); const { page } = o;
    await page.evaluate(() => { location.hash = '#/new'; }); await page.waitForSelector('form.card'); await page.waitForTimeout(200);
    o.sel = await newSelected(page);
    if (title) await page.fill('form.card input[placeholder]', title);
    await page.click('form.card button.btn.blue'); await page.waitForFunction(() => location.hash === '#/live', null, { timeout: 8000 }).catch(() => {}); await page.waitForTimeout(200);
    return o; };
  { const a = await startOnNew('', {}), b = await startOnNew('Week 10', {});
    const blank = a.be.posts[0] || {}, typed = b.be.posts[0] || {};
    check('New lecture: an empty title becomes the dated title with autoTitle; a typed title is sent as typed with autoTitle false', blank.autoTitle === true && /^Lecture, /.test(blank.title) && typed.title === 'Week 10' && typed.autoTitle === false, { blank, typed });
    check('New lecture starts at the last course used', a.sel === 'c2' && blank.courseId === 'c2', { sel: a.sel, blank });
    await a.ctx.close(); await b.ctx.close(); }

  console.log('\n=== Chinese ===');
  { const a = await open({ store: { lang: 'zh-Hant' } }), b = await open({ store: { lang: 'zh-Hans' } });
    for (const o of [a, b]) { await o.page.click('.rec-btn'); await o.page.waitForFunction(() => location.hash === '#/live', null, { timeout: 8000 }).catch(() => {}); }
    const zhTitle = (a.be.posts[0] || {}).title || '', hansTitle = (b.be.posts[0] || {}).title || '';
    check('in Chinese the dated title ends with the time and 課堂 (课堂 in Simplified)', / \d{2}:\d{2} 課堂$/.test(zhTitle) && / \d{2}:\d{2} 课堂$/.test(hansTitle), { zhTitle, hansTitle });
    await a.ctx.close(); await b.ctx.close(); }

  console.log('\n=== Pick up where you left off ===');
  { const { ctx, page } = await open();
    await page.evaluate(() => { location.hash = '#/lecture/w9'; }); await page.waitForSelector('.main .card, .crumb', { timeout: 5000 }); await page.waitForTimeout(400);
    await page.evaluate(() => { location.hash = '#/home'; }); await page.waitForSelector('.rec-hero'); await page.waitForTimeout(200);
    const card = async () => page.evaluate(() => { const c = document.querySelector('.tcard'); return c && /Pick up where you left off/.test(c.innerText) ? c.querySelector('b').textContent : null; });
    const lastCard = await card();
    await page.evaluate(() => { const S = window.__sidenote.S; S.lectures = S.lectures.filter(l => l.id !== 'w9'); location.hash = '#/courses'; });
    await page.waitForTimeout(200); await page.evaluate(() => { location.hash = '#/home'; }); await page.waitForTimeout(300);
    const lastCardAfterDelete = await card();
    check('"Pick up where you left off" shows the last lecture opened, and not after it is deleted', lastCard === 'Week 9 replay' && !lastCardAfterDelete, { lastCard, lastCardAfterDelete });
    await ctx.close(); }

  check('no page errors', errs.length === 0, errs);
  await browser.close();
  console.log(`\n${results.filter(Boolean).length} of ${results.length} checks passed`);
  process.exit(results.every(Boolean) ? 0 : 1);
})();
