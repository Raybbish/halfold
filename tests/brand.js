// The product is called Halfold and the mascot Hal. Real-backend mode (fake API by request interception): the page title and
// the home-screen name, the logo (Hal drawn as the original sticky note with a folded corner, its mood shown by its mouth),
// the tag on a point that is not on the slides and the filter for it, no
// leftover "Sidenote" or "Sid" on the main pages in English and Chinese, and the internal storage name still sidenote.session.
const { chromium, ORIGIN, serve, setConfig } = require('./harness');
const results = [];
const check = (name, ok, detail) => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || detail === undefined ? '' : '  -> ' + JSON.stringify(detail)}`); };

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const errs = [];
  const lec = { id: 'l1', course: 'c1', title: 'Week 1', date: 'Today', duration: 300, status: 'ready' };
  /* A point is "off" the slides only when there are slides (the filter is not offered without them since the retest of 2026-11-23). */
  const detail = { alerts: [], transcript: [{ t: 0, text: 'line' }], flashcards: [], quiz: [], slides: [{ n: 1, title: 'Supply', image: null }],
    sections: [{ title: 'Part one', slides: 'Slide 1', start: 0, end: 300, points: [{ t: 30, text: 'Supply shifts right when costs fall', off: false, slide: 1 }, { t: 90, text: 'The exam is open book', off: true, slide: null }] }] };
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
  check('title and home-screen name say Halfold', /^Halfold: /.test(await page.title()) && await page.getAttribute('meta[name=apple-mobile-web-app-title]', 'content') === 'Halfold', await page.title());
  const logoSvg = page.locator('.logo').first().locator('svg');
  const shape = await logoSvg.evaluate(svg => { const ps = [...svg.querySelectorAll('path')], d = x => ps.find(p => p.getAttribute('d') === x);
    const note = d('M3 3h26v17l-9 9H3z'), fold = d('M29 20h-9v9');
    return { note: !!note && note.getAttribute('fill') === '#FFD93B' && note.getAttribute('stroke') === '#16233B', fold: !!fold, eyes: [...svg.querySelectorAll('circle.eye')].map(c => c.getAttribute('cx') + ',' + c.getAttribute('cy')).join(' '), halves: ps.some(p => p.getAttribute('d') === 'M3 3h13v26H3z' || p.getAttribute('d') === 'M16 3h13v17l-9 9h-4z') }; });
  check('logo text is "halfold" and the logo is the yellow sticky note with a folded corner and two eyes (not the split note)', logoText === 'halfold' && shape.note && shape.fold && shape.eyes === '11.5,13 20.5,13' && !shape.halves, { logoText, shape });
  const icon = decodeURIComponent(await page.getAttribute('link[rel=icon]', 'href'));
  check('the favicon is the same sticky note with two eyes', icon.includes("d='M3 3h26v17l-9 9H3z'") && icon.includes("cx='11.5'") && icon.includes("cx='20.5'") && !icon.includes("M3 3h13v26H3z"), icon);
  const weight = await page.locator('.logo').first().evaluate(e => getComputedStyle(e).fontWeight);
  check('the wordmark is font-weight 800', weight === '800', weight);
  /* Hal's mood is its mouth: smiling beside the greeting on home, sad on a page that does not exist. */
  const smile = await page.locator('.page-h svg.sid path').evaluateAll(ps => ps.some(p => p.getAttribute('d') === 'M12.5 18.5q3.5 3 7 0'));
  await page.goto(ORIGIN + '/#/nowhere'); await page.waitForSelector('.card h3');
  const sad = await page.locator('.card svg.sid path').evaluateAll(ps => ps.some(p => p.getAttribute('d') === 'M12.5 20.5q3.5 -3 7 0'));
  check('Hal shows its mood: a smile beside the greeting on home, a sad mouth on a missing page', smile && sad, { smile, sad });

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
      check(`no "Halfnote", "Sidenote" or "Sid " on ${name} (${lang === 'en' ? 'English' : 'Chinese'})`, !/Halfnote|Sidenote|\bSid\b|旁註/.test(body), body.match(/.{0,30}(Halfnote|Sidenote|\bSid\b|旁註).{0,30}/));
    }
  }
  check('the session is still stored under sidenote.session', await page.evaluate(() => !!localStorage.getItem('sidenote.session')));
  check('no page errors', errs.length === 0, errs);
  await browser.close();
  console.log(`\n${results.filter(Boolean).length} of ${results.length} checks passed`);
})().catch(e => { console.error('SCRIPT ERROR', String(e.message).slice(0, 1200)); process.exit(1); });
