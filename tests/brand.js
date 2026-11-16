// The product is called Halfnote and the mascot Hal. Real-backend mode (fake API by request interception): the page title and
// the home-screen name, the logo (the split sticky note), the tag on a point that is not on the slides and the filter for it, no
// leftover "Sidenote" or "Sid" on the main pages in English and Chinese, and the internal storage name still sidenote.session.
const { chromium, ORIGIN, serve, setConfig } = require('./harness');
const results = [];
const check = (name, ok, detail) => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || detail === undefined ? '' : '  -> ' + JSON.stringify(detail)}`); };

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const errs = [];
  const lec = { id: 'l1', course: 'c1', title: 'Week 1', date: 'Today', duration: 300, status: 'ready' };
  const detail = { alerts: [], transcript: [{ t: 0, text: 'line' }], flashcards: [], quiz: [], slides: [],
    sections: [{ title: 'Part one', start: 0, end: 300, points: [{ t: 30, text: 'Supply shifts right when costs fall', off: false }, { t: 90, text: 'The exam is open book', off: true }] }] };
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await setConfig(ctx, { USE_MOCK: false, POLL_MS: 50 });
  await ctx.route('**/*', async route => {
    const req = route.request(), u = new URL(req.url()), m = req.method(), j = (o, s = 200) => route.fulfill({ status: s, contentType: 'application/json', body: JSON.stringify(o) });
    if (!u.pathname.startsWith('/api/')) return serve(route, { USE_MOCK: false, POLL_MS: 50 });
    const p = u.pathname.slice(4);
    if (p === '/session') return j({ token: 'tok', user: { name: 'T' } });
    if (p === '/home') return j({ user: { name: 'T' }, courses: [{ id: 'c1', code: 'TEST 1001' }], lectures: [lec], upcoming: [], settings: { classLanguage: 'en', zhDefault: false } });
    if (m === 'GET' && p === '/lectures/l1') return j({ lecture: lec, detail });
    return j({ message: 'Not found' }, 404);
  });
  const page = await ctx.newPage(); page.on('pageerror', e => errs.push(e.message));
  await page.goto(ORIGIN + '/#/signin'); await page.fill('input[name=code]', 'abc'); await page.click('form.auth button'); await page.waitForSelector('.shell');

  const logoText = (await page.locator('.logo').first().innerText()).trim();
  check('title and home-screen name say Halfnote', /^Halfnote: /.test(await page.title()) && await page.getAttribute('meta[name=apple-mobile-web-app-title]', 'content') === 'Halfnote', await page.title());
  const logoSvg = page.locator('.logo').first().locator('svg');
  const shape = await logoSvg.evaluate(svg => ({ left: [...svg.querySelectorAll('path')].some(p => p.getAttribute('d') === 'M3 3h13v26H3z' && p.getAttribute('fill') === '#FFD93B'), right: [...svg.querySelectorAll('path')].some(p => p.getAttribute('d') === 'M16 3h13v17l-9 9h-4z' && p.getAttribute('fill') === '#16233B'), eyes: svg.querySelectorAll('circle.eye').length, ellipses: svg.querySelectorAll('ellipse').length }));
  check('logo text is "halfnote" and the logo is the yellow half, the navy half, two eyes and no ellipse', logoText === 'halfnote' && shape.left && shape.right && shape.eyes === 2 && shape.ellipses === 0, { logoText, shape });
  const icon = decodeURIComponent(await page.getAttribute('link[rel=icon]', 'href'));
  check('the favicon is the new logo (has the yellow left half)', icon.includes("d='M3 3h13v26H3z'") && !icon.includes('ellipse'), icon);
  const weight = await page.locator('.logo').first().evaluate(e => getComputedStyle(e).fontWeight);
  check('the wordmark is font-weight 800', weight === '800', weight);

  await page.goto(ORIGIN + '/#/lecture/l1'); await page.waitForSelector('.pt.off');
  const offTag = (await page.locator('.pt.off .tag').first().innerText()).trim(), toolsText = await page.locator('.tools').innerText();
  check('a point not on the slides is tagged "Not on slides"', offTag === 'Not on slides', offTag);
  check('the filter says "Only what is not on the slides"', /Only what is not on the slides/.test(toolsText), toolsText);

  const pages = [['the landing page', '#/'], ['home', '#/home'], ['a lecture', '#/lecture/l1'], ['settings', '#/settings'], ['new lecture', '#/new']];
  for (const lang of ['en', 'zh']) {
    await page.evaluate(l => window.__sidenote.setLang(l), lang);
    for (const [name, hash] of pages) {
      await page.goto(ORIGIN + '/' + hash); await page.waitForSelector('.shell, .landing, h1', { timeout: 10000 }); await page.waitForTimeout(250);
      const body = await page.innerText('body');
      check(`no "Sidenote" or "Sid " on ${name} (${lang === 'en' ? 'English' : 'Chinese'})`, !/Sidenote|\bSid\b|旁註/.test(body), body.match(/.{0,30}(Sidenote|\bSid\b|旁註).{0,30}/));
    }
  }
  check('the session is still stored under sidenote.session', await page.evaluate(() => !!localStorage.getItem('sidenote.session')));
  check('no page errors', errs.length === 0, errs);
  await browser.close();
  console.log(`\n${results.filter(Boolean).length} of ${results.length} checks passed`);
})().catch(e => { console.error('SCRIPT ERROR', String(e.message).slice(0, 1200)); process.exit(1); });
