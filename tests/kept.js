// Features of ours that batch 1 had to leave alone ("Keep our own" in docs/superpowers/specs/2026-11-16-halfnote-batch1-design.md)
// and that no other script watched: the phone top bar, bottom navigation and #/courses; the "See plans" link in the recording
// retention notice; the share window saying the recording stays private; the shared page's own checks are elsewhere
// (real5.js:236 no recording; server/test/links.test.ts: no link, error or source). Real-backend mode (fake API by request interception), built app only.
const { chromium, ORIGIN, serve, setConfig } = require('./harness');
const results = [];
const check = (name, ok, detail) => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || detail === undefined ? '' : '  -> ' + JSON.stringify(detail)}`); };

const LEC = { id: 'l1', course: 'c1', title: 'Week 9', date: 'Tue 10 Nov', duration: 300, status: 'ready', link: 'https://www.youtube.com/watch?v=SECRETLINK', error: 'SECRETREASON needs a sign-in' };
const DETAIL = audio => ({ audio, alerts: [], sections: [{ title: 'Part one', start: 0, end: 300, points: [{ t: 95, text: 'A point', off: false, slide: null }] }], slides: [], transcript: [{ t: 0, text: 'line 0' }], flashcards: [], quiz: [] });

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const errs = [];
  async function open(opts, fn) {
    const viewport = opts.viewport || { width: 390, height: 780 };
    const ctx = await browser.newContext({ viewport, isMobile: viewport.width < 900, hasTouch: viewport.width < 900, timezoneId: 'Asia/Hong_Kong' });
    await setConfig(ctx, { USE_MOCK: false, POLL_MS: 50, ...(opts.config || {}) });
    await ctx.route('**/*', route => {
      const u = new URL(route.request().url()), j = (o, s = 200) => route.fulfill({ status: s, contentType: 'application/json', body: JSON.stringify(o) });
      if (u.pathname.startsWith('/audio/')) return route.fulfill({ status: 404, body: '' });
      if (!u.pathname.startsWith('/api/')) return serve(route, { USE_MOCK: false, POLL_MS: 50, ...(opts.config || {}) });
      const p = u.pathname.slice(4);
      if (p === '/session') return j({ token: 't', user: { name: 'Jasper' } });
      if (p === '/home') return j({ user: { name: 'Jasper' }, courses: [{ id: 'c1', code: 'ECON 1001', name: 'Micro' }, { id: 'c2', code: 'MATH 2011', name: '' }], lectures: [LEC], upcoming: [], settings: { classLanguage: 'en', zhDefault: false }, usage: opts.usage });
      if (p === '/lectures/l1') return j({ lecture: LEC, detail: DETAIL(opts.audio) });
      if (p === '/shared/sh1') return j({ lecture: { ...LEC, id: 'sh1', status: 'ready', shareUrl: null }, course: { id: 'c1', code: 'ECON 1001' }, detail: DETAIL(undefined), sharedBy: 'Jasper' });
      if (p === '/lectures/l1/share') return j({ url: ORIGIN + '/#/s/sh1' });
      return j({ message: 'Not found' }, 404);
    });
    const page = await ctx.newPage(); page.on('pageerror', e => errs.push(e.message));
    await page.goto(ORIGIN + '/#/signin'); await page.fill('input[name=code]', 'abc'); await page.click('form.auth button'); await page.waitForSelector('.shell');
    try { await fn(page); } finally { await ctx.close(); }
  }
  const vis = (page, sel) => page.evaluate(s => { const e = document.querySelector(s); return !!e && getComputedStyle(e).display !== 'none' && e.offsetHeight > 0; }, sel);

  // Phone: top bar, bottom navigation, the course list page
  await open({}, async page => {
    await page.goto(ORIGIN + '/#/home'); await page.waitForSelector('.mtop');
    const nav = await page.locator('.mnav a').evaluateAll(a => a.map(x => [x.getAttribute('href'), x.innerText.replace(/\s+/g, ' ').trim()]));
    check('phone: the top bar and the bottom navigation are shown and the sidebar is not', await vis(page, '.mtop') && await vis(page, '.mnav') && !(await vis(page, '.side')));
    check('phone: the bottom navigation is Home, New lecture, Courses, each linking to its page', JSON.stringify(nav) === '[["#/home","Home"],["#/new","New lecture"],["#/courses","Courses"]]', nav);
    check('phone: the top bar has the logo, the language button and Settings', (await page.locator('.mtop .logo').count()) === 1 && (await page.locator('.mtop .lang').count()) === 1 && (await page.locator('.mtop a[href="#/settings"]').count()) === 1);
    await page.click('.mnav a[href="#/courses"]'); await page.waitForSelector('.page-h h1:text-is("Courses")');
    const cards = await page.locator('.courses a').evaluateAll(a => a.map(x => x.getAttribute('href')));
    check('#/courses lists every course, each linking to its page, with Courses highlighted in the navigation', page.url().endsWith('#/courses') && (await page.locator('.page-h h1').innerText()) === 'Courses' && JSON.stringify(cards) === '["#/course/c1","#/course/c2"]' && (await page.locator('.mnav a.t.on').innerText()).trim() === 'Courses', { cards, h1: await page.locator('.page-h h1').innerText(), on: await page.locator('.mnav a.t.on').allInnerTexts(), url: page.url() });
  });
  await open({ viewport: { width: 1280, height: 800 } }, async page => {
    await page.goto(ORIGIN + '/#/home'); await page.waitForSelector('.side');
    check('desktop: the sidebar is shown and the phone bars are not', await vis(page, '.side') && !(await vis(page, '.mtop')) && !(await vis(page, '.mnav')));
  });

  // Retention notice: "See plans" appears only once the backend reports a plan limit
  const url = ORIGIN + '/audio/a.m4a';
  const notice = async page => { await page.goto(ORIGIN + '/#/lecture/l1'); await page.waitForSelector('.tabs'); return { n: await page.locator('.main .alert').count(), href: await page.locator('.main .alert a:text-is("See plans")').count() ? await page.locator('.main .alert a:text-is("See plans")').getAttribute('href') : null }; };
  await open({ audio: { url, expired: true }, usage: { minutesToday: 0, minutesLimit: 240, audioDays: 30 } }, async page => {
    const r = await notice(page); check('expired recording on a plan with a limit: the notice has a See plans link to Settings', r.n === 1 && r.href === '#/settings', r);
  });
  await open({ audio: { url, expired: true } }, async page => {
    const r = await notice(page); check('expired recording without a reported plan limit: the notice has no See plans link', r.n === 1 && r.href === null, r);
  });

  // Share window and shared page
  await open({ viewport: { width: 1280, height: 800 }, audio: { url } }, async page => {
    await page.goto(ORIGIN + '/#/lecture/l1'); await page.waitForSelector('.tabs'); await page.click('.page-h button:text-is("Share with class")'); await page.waitForSelector('#overlay h3');
    const txt = (await page.locator('#overlay').innerText()).replace(/\s+/g, ' ');
    check('the share window says the recording stays private', txt.includes('Share with your class') && txt.includes('The recording stays private'), txt);
  });

  check('no page errors', errs.length === 0, errs);
  await browser.close();
  const n = results.filter(Boolean).length; console.log(`\n${n} of ${results.length} checks passed`); process.exit(n === results.length ? 0 : 1);
})().catch(e => { console.error('SCRIPT ERROR', e.message); process.exit(1); });
