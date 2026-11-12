// Searching the notes of every lecture from the home page (added after the migration).
// Sample mode: notes of a lecture not opened yet are found, one search per pause in typing, words in any order, the
// lecture list, opening a result at its point, the student's own note, no match, Chinese, phone width.
// Real-backend mode (fake API by request interception): what is sent, a backend without the endpoint, a server error,
// a late reply for an older query, a result whose text changed since.
const { chromium, ORIGIN, serve, setConfig } = require('./harness');
const results = [];
const check = (name, ok, detail) => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || detail === undefined ? '' : '  -> ' + JSON.stringify(detail)}`); };

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const errs = [];
  const open = async (cfg, route, viewport = { width: 1280, height: 800 }) => {
    const ctx = await browser.newContext({ viewport });
    if (cfg) await setConfig(ctx, cfg);
    if (route) await ctx.route('**/*', route);
    const page = await ctx.newPage(); page.on('pageerror', e => errs.push(e.message));
    await page.goto(ORIGIN + '/#/signin'); await page.fill('input[name=code]', 'abc'); await page.click('form.auth button'); await page.waitForSelector('.shell');
    if (!page.url().endsWith('#/home')) { await page.goto(ORIGIN + '/#/home'); }
    await page.waitForSelector('input.search');
    return { ctx, page };
  };
  const box = 'input.search';
  const snips = page => page.locator('.hits .snip').allInnerTexts();
  const marks = page => page.locator('.hits mark').allInnerTexts();
  const listText = page => page.locator('#lecList').innerText();
  const settle = page => page.waitForTimeout(900);   // the pause before searching (300 ms), the sample reply (250 ms) and some room
  // Count the searches the page makes in sample mode.
  const spy = page => page.evaluate(() => { const api = window.__sidenote.api, f = api.searchNotes; window.__q = []; api.searchNotes = q => { window.__q.push(q); return f.call(api, q); }; });

  console.log('=== sample data ===');
  { const { ctx, page } = await open();
    await spy(page);
    const opened = await page.evaluate(() => Object.keys(window.__sidenote.S.detail));
    await page.click(box); await page.type(box, 'sunk', { delay: 60 });
    const early = await listText(page);
    await settle(page);
    const s1 = { opened, early, snips: await snips(page), marks: await marks(page), list: await listText(page), calls: await page.evaluate(() => window.__q), focus: await page.evaluate(() => document.activeElement && document.activeElement.matches('input.search')) };
    check('notes of a lecture not opened yet are found, with the word marked', opened.length === 0 && s1.snips.length === 1 && s1.snips[0].startsWith('A sunk cost cannot be recovered') && s1.marks.join() === 'sunk', s1);
    check('while the search is on its way the list says so, then lists the lecture whose notes matched', early === 'Searching the notes' && s1.list.includes('Opportunity cost and comparative advantage') && !s1.list.includes('No lecture matches'), { early, list: s1.list });
    check('one search after typing pauses, not one per letter; the box keeps focus', JSON.stringify(s1.calls) === '["sunk"]' && s1.focus, s1);

    await page.fill(box, 's'); await settle(page);
    const s2 = { hits: await page.locator('.hits').count(), calls: await page.evaluate(() => window.__q.length) };
    check('one letter: no search of the notes', s2.hits === 0 && s2.calls === 1, s2);

    await page.fill(box, 'Slope  OPPORTUNITY'); await settle(page);
    const s3 = { snips: await snips(page), marks: await marks(page), calls: await page.evaluate(() => window.__q.slice(-1)) };
    check('several words in any order, any case; each one marked', s3.snips.length === 1 && s3.snips[0].startsWith('The slope of the PPF') && s3.marks.map(x => x.toLowerCase()).sort().join() === 'opportunity,slope' && s3.calls[0] === 'slope opportunity', s3);

    await page.fill(box, 'zzzz'); await settle(page);
    check('nothing matches: the list says so and there is no notes section', (await listText(page)) === 'No lecture matches that search.' && (await page.locator('.hits, .hits-note').count()) === 0);

    // Open a result: the lecture opens at that point, marked and in view, with the recording at its time
    await page.fill(box, 'bowed'); await settle(page);
    const meta = await page.locator('.hits li').first().innerText();
    await page.click('.hits .snip'); await page.waitForSelector('.pt.found');
    const s4 = await page.evaluate(() => { const el = document.querySelector('.pt.found'), r = el.getBoundingClientRect(); return { url: location.hash, text: el.querySelector('.body').innerText, n: document.querySelectorAll('.pt.found').length, inView: r.top >= 0 && r.bottom <= innerHeight, scrolled: scrollY > 100, pos: window.__sidenote.state.pos }; });
    check('a result shows the course, lecture and time', meta.includes('ECON 1001, Opportunity cost and comparative advantage') && meta.includes('31:05'), meta);
    check('opening a result goes to that point in the lecture: marked, scrolled into view, recording at its time', s4.url === '#/lecture/econ-w9' && s4.n === 1 && s4.text.startsWith('A bowed-out PPF') && s4.inView && s4.scrolled && s4.pos === 1865, s4);

    // The student's own note, then back home: the box still has the text and the notes are searched again
    await page.click('.tools label:has-text("Edit notes") input'); await page.click('.nsec >> nth=1 >> button:text-is("Add a note")');
    await page.fill('#overlay textarea[name=t]', 'My revision plan for the midterm'); await page.click('#overlay button:text-is("Save note")'); await page.waitForTimeout(300);
    await page.click('.tools label:has-text("Edit notes") input');
    await page.goto(ORIGIN + '/#/home'); await page.waitForSelector(box); await settle(page);
    const back = { value: await page.inputValue(box), snips: await snips(page), last: await page.evaluate(() => window.__q.slice(-1)[0]) };
    await page.fill(box, 'revision plan'); await settle(page);
    const mine = { snips: await snips(page), time: await page.locator('.hits li .num').count() };
    await page.click('.hits .snip'); await page.waitForSelector('.pt.found');
    const mineFound = await page.locator('.pt.found').innerText();
    check('back on the home page the text is still in the box and the notes are searched again', back.value === 'bowed' && back.snips.length === 1 && back.last === 'bowed', back);
    check('the student\'s own note is found (no time) and opens at that note', mine.snips.join() === 'My revision plan for the midterm' && mine.time === 0 && mineFound.includes('My revision plan for the midterm') && mineFound.includes('You'), { mine, mineFound });

    // A lecture opened without a search result has no marked point
    await page.goto(ORIGIN + '/#/home'); await page.waitForSelector(box); await page.click('#lecList a.t:text-is("Opportunity cost and comparative advantage")'); await page.waitForSelector('.nsec');
    check('opening the lecture from the list (not a result) marks nothing', (await page.locator('.pt.found').count()) === 0);

    await ctx.close(); }

  // Chinese, in a new visit so that no lecture's notes are loaded yet
  { const { ctx, page } = await open();
    await page.evaluate(() => window.__sidenote.setLang('zh')); await page.click(box); await page.type(box, 'sunk', { delay: 30 });
    const zEarly = await listText(page); await settle(page);
    const zh = { early: zEarly, h: await page.locator('.hits h3').innerText(), snips: await snips(page) };
    check('in Chinese: the heading and the searching line; the notes themselves are not translated', zh.early === '正在搜尋筆記' && zh.h === '在筆記裡找到' && zh.snips[0].startsWith('A sunk cost'), zh);
    await ctx.close(); }

  { const { ctx, page } = await open(null, null, { width: 375, height: 760 });
    await page.fill(box, 'opportunity cost'); await settle(page);
    const ph = await page.evaluate(() => ({ n: document.querySelectorAll('.hits li').length, wide: document.documentElement.scrollWidth > innerWidth }));
    check('phone width: the matches fit without sideways scrolling', ph.n > 1 && !ph.wide, ph);
    await ctx.close(); }

  console.log('\n=== real backend (fake API) ===');
  const lec = { id: 'l1', course: 'c1', title: 'Week 1', date: 'Today', duration: 300, status: 'ready' };
  const detail = { alerts: [], transcript: [{ t: 0, text: 'line' }], flashcards: [], quiz: [], slides: [],
    sections: [{ title: 'Part one', start: 0, end: 300, points: [{ t: 30, text: 'Supply shifts right when costs fall', off: false }, { t: 90, text: 'Demand is a schedule', off: false }] }] };
  const backend = be => async route => {
    const req = route.request(), u = new URL(req.url()), m = req.method(), j = (o, s = 200) => route.fulfill({ status: s, contentType: 'application/json', body: JSON.stringify(o) });
    if (!u.pathname.startsWith('/api/')) return serve(route, { USE_MOCK: false });
    const p = u.pathname.slice(4); be.log.push(m + ' ' + p + u.search);
    if (p === '/session') return j({ token: 'tok', user: { name: 'T' } });
    if (p === '/home') return j({ user: { name: 'T' }, courses: [{ id: 'c1', code: 'TEST 1001' }], lectures: [lec], upcoming: [], settings: { classLanguage: 'en', zhDefault: false } });
    if (p === '/search') {
      const q = u.searchParams.get('q'); be.auth = req.headers()['authorization'] || '';
      if (be.status) return j({ message: 'Search is down for maintenance.' }, be.status);
      if (be.slow && q === be.slow) await new Promise(r => setTimeout(r, 1200));
      return j({ results: (be.results || (q => [{ lecture: 'l1', text: 'Supply shifts right when costs fall', t: 30 }, { lecture: 'gone', text: 'In a lecture that is not on the list', t: 5 }]))(q) });
    }
    if (m === 'GET' && p === '/lectures/l1') return j({ lecture: lec, detail });
    return j({ message: 'Not found' }, 404);
  };
  const searches = be => be.log.filter(x => x.startsWith('GET /search'));

  { const be = { log: [] }; const { ctx, page } = await open({ USE_MOCK: false }, backend(be));
    await page.fill(box, 'Supply  costs'); await settle(page);
    const r = { log: searches(be), auth: be.auth, snips: await snips(page), list: await listText(page) };
    check('sends GET /search?q= with the query and the token; a result for a lecture not on the list is left out', JSON.stringify(r.log) === '["GET /search?q=supply%20costs"]' && r.auth === 'Bearer tok' && r.snips.join('|') === 'Supply shifts right when costs fall' && r.list.includes('Week 1'), r);
    await page.click('.hits .snip'); await page.waitForSelector('.pt.found');
    check('opening the result loads the lecture and marks the point', (await page.locator('.pt.found .body').innerText()) === 'Supply shifts right when costs fall' && be.log.includes('GET /lectures/l1'));
    await ctx.close(); }

  { const be = { log: [], results: () => [{ lecture: 'l1', text: 'Demand is a list of prices and quantities', t: 90 }] }; const { ctx, page } = await open({ USE_MOCK: false }, backend(be));
    await page.fill(box, 'demand'); await settle(page); await page.click('.hits .snip'); await page.waitForSelector('.pt.found');
    check('a result whose wording changed since is found by its time', (await page.locator('.pt.found .body').innerText()) === 'Demand is a schedule');
    await ctx.close(); }

  { const be = { log: [], status: 404 }; const { ctx, page } = await open({ USE_MOCK: false }, backend(be));
    await page.fill(box, 'supply'); await settle(page);
    const a = { list: await listText(page), hits: await page.locator('.hits, .hits-note').count() };
    await page.fill(box, 'demand'); await settle(page); await page.fill(box, 'week'); await settle(page);
    const b = { list: await listText(page), n: searches(be).length };
    check('a backend without the search endpoint: the box works as before, no error, asked only once', a.list === 'No lecture matches that search.' && a.hits === 0 && b.list.includes('Week 1') && b.n === 1, { a, b });
    await ctx.close(); }

  { const be = { log: [], status: 500 }; const { ctx, page } = await open({ USE_MOCK: false }, backend(be));
    await page.fill(box, 'supply'); await settle(page);
    const e = { note: await page.locator('.hits-note').innerText().catch(() => ''), list: await listText(page) };
    check('a server error: says the notes could not be searched; the list still works', e.note === 'The notes could not be searched just now. Try again in a moment.' && e.list === 'No lecture matches that search.', e);
    await ctx.close(); }

  { const be = { log: [], slow: 'old query', results: q => [{ lecture: 'l1', text: q === 'old query' ? 'Demand is a schedule' : 'Supply shifts right when costs fall', t: q === 'old query' ? 90 : 30 }] };
    const { ctx, page } = await open({ USE_MOCK: false }, backend(be));
    await page.fill(box, 'old query'); await page.waitForTimeout(500); await page.fill(box, 'new query'); await page.waitForTimeout(1800);
    const l = { snips: await snips(page), marks: await marks(page), log: searches(be) };
    check('a late reply for an older query does not replace the newer one', l.snips.join() === 'Supply shifts right when costs fall' && l.log.length === 2, l);
    await ctx.close(); }

  check('no page errors', errs.length === 0, errs);
  await browser.close();
  console.log(`\n${results.filter(Boolean).length} of ${results.length} checks passed`);
})().catch(e => { console.error('SCRIPT ERROR', String(e.message).slice(0, 1200)); process.exit(1); });
