// Sharing with a real backend (added after the migration, from what backend phase 3 found). Fake API by request interception.
// 1. Stopping sharing forgets the shared page this visit had loaded. The backend's link has its own share id, not the
//    lecture's id, so the old link must be asked for again (and is then gone), not drawn from what was loaded before.
// 2. "You" marks only the points the student added to their own lecture. A point the sharer added, seen on the shared
//    page, and the same point in a reader's saved copy have no time either, but the reader did not write them.
const { chromium, ORIGIN, serve, setConfig } = require('./harness');
const results = [];
const check = (name, ok, detail) => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || detail === undefined ? '' : '  -> ' + JSON.stringify(detail)}`); };

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const errs = [];
  const course = { id: 'c1', code: 'TEST 1001', name: 'Testing' };
  const lec = { id: 'l1', course: 'c1', title: 'Week 1', date: 'Today', duration: 300, status: 'ready', shareUrl: null };
  const copy = { id: 'l2', course: 'c1', title: 'Week 1 from a classmate', date: 'Today', duration: 300, status: 'ready', shareUrl: null };
  const OWN = 'My own summary of week one';
  // mine: true is how the backend marks a point the student added. The saved copy has the same point without it.
  const detail = own => ({ alerts: [], transcript: [{ t: 0, text: 'line' }], flashcards: [], quiz: [], slides: [],
    sections: [{ title: 'Part one', start: 0, end: 300, points: [{ t: 30, text: 'Supply shifts right when costs fall', off: false }, own ? { t: null, text: OWN, mine: true, off: false } : { t: null, text: OWN, off: false }] }] });
  const backend = be => async route => {
    const req = route.request(), u = new URL(req.url()), m = req.method(), j = (o, s = 200) => route.fulfill({ status: s, contentType: 'application/json', body: JSON.stringify(o) });
    if (!u.pathname.startsWith('/api/')) return serve(route, { USE_MOCK: false });
    const p = u.pathname.slice(4); be.log.push(m + ' ' + p);
    if (p === '/session') return j({ token: 'tok', user: { name: 'T' } });
    if (p === '/home') return j({ user: { name: 'T' }, courses: [course], lectures: [lec, copy], upcoming: [], settings: { classLanguage: 'en', zhDefault: false } });
    if (m === 'GET' && p === '/lectures/l1') return j({ lecture: lec, detail: detail(true) });
    if (m === 'GET' && p === '/lectures/l2') return j({ lecture: copy, detail: detail(false) });
    if (m === 'POST' && p === '/lectures/l1/share') { be.shared = true; return j({ url: ORIGIN + '/#/s/sh-abc' }); }
    if (m === 'DELETE' && p === '/lectures/l1/share') { be.shared = false; return route.fulfill({ status: 204, body: '' }); }
    // The shared page as the backend sends it: the share id as lecture.id, and the sharer's own point still marked mine.
    if (m === 'GET' && p === '/shared/sh-abc') return be.shared ? j({ lecture: { ...lec, id: 'sh-abc' }, course, detail: detail(true), sharedBy: 'T' }) : j({ message: 'This link is no longer shared.' }, 404);
    return j({ message: 'Not found' }, 404);
  };
  const open = async (be, hash) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await setConfig(ctx, { USE_MOCK: false }); await ctx.route('**/*', backend(be));
    const page = await ctx.newPage(); page.on('pageerror', e => errs.push(e.message));
    await page.goto(ORIGIN + '/#/signin'); await page.fill('input[name=code]', 'abc'); await page.click('form.auth button'); await page.waitForSelector('.shell');
    await go(page, hash);
    return { ctx, page };
  };
  const go = async (page, hash) => { await page.evaluate(h => { location.hash = h; }, hash); await page.waitForFunction(h => location.hash === h && !document.querySelector('.skel, .loader'), hash).catch(() => {}); await page.waitForTimeout(400); };
  // What stands where the time would be, for the point the student added, and whether its text lines up with the others.
  const ownPoint = page => page.evaluate(own => {
    const pts = [...document.querySelectorAll('.pt')], p = pts.find(x => x.querySelector('.body').textContent.includes(own)), q = pts.find(x => x !== p);
    if (!p || !q) return null;
    return { mark: p.firstElementChild === p.querySelector('.body') ? '' : p.firstElementChild.textContent, aligned: p.querySelector('.body').getBoundingClientRect().left === q.querySelector('.body').getBoundingClientRect().left };
  }, OWN);

  console.log('=== "You" marks only the student\'s own points ===');
  { const be = { log: [], shared: true }; const { ctx, page } = await open(be, '#/lecture/l1'); await page.waitForSelector('.pt');
    const mine = await ownPoint(page);
    check('in the student\'s own lecture, a point they added says You', mine && mine.mark === 'You' && mine.aligned, mine);
    await go(page, '#/s/sh-abc'); await page.waitForSelector('.shared-bar');
    const sh = await ownPoint(page);
    check('on the shared page, the point the sharer added does not say You, and its text lines up with the others', sh && sh.mark === '' && sh.aligned, sh);
    await ctx.close(); }
  { const be = { log: [] }; const { ctx, page } = await open(be, '#/lecture/l2'); await page.waitForSelector('.pt');
    const cp = await ownPoint(page);
    check('in a saved copy of someone else\'s lecture, their added point does not say You', cp && cp.mark === '' && cp.aligned, cp);
    await ctx.close(); }

  console.log('\n=== stopping sharing ===');
  { const be = { log: [] }; const { ctx, page } = await open(be, '#/lecture/l1'); await page.waitForSelector('.pt');
    await page.click('.page-h button.btn.primary'); await page.waitForSelector('#shareUrl');
    const url = await page.inputValue('#shareUrl');
    await page.click('#overlay a.btn.plain'); await page.waitForSelector('.shared-bar');
    const previewed = await page.locator('.page-h h1').innerText();
    await go(page, '#/lecture/l1'); await page.click('.page-h button.btn.primary'); await page.waitForSelector('#shareUrl');
    await page.click('#overlay button:has-text("Stop sharing")'); await page.waitForSelector('#overlay', { state: 'detached' }).catch(() => {});
    const before = be.log.filter(x => x === 'GET /shared/sh-abc').length;
    await go(page, '#/s/sh-abc');
    const after = { asked: be.log.filter(x => x === 'GET /shared/sh-abc').length - before, bar: await page.locator('.shared-bar').count(), text: await page.locator('main, .main, body').first().innerText() };
    check('the share link is the backend\'s, with its own id, and the preview opens it', url === ORIGIN + '/#/s/sh-abc' && previewed === 'Week 1' && be.log.includes('DELETE /lectures/l1/share'), { url, previewed });
    check('after stopping sharing, the old link is asked for again and says it is no longer shared', after.asked === 1 && after.bar === 0 && after.text.includes('This link is no longer shared.'), after);
    await ctx.close(); }

  check('no page errors', errs.length === 0, errs);
  await browser.close();
  const passed = results.filter(Boolean).length;
  console.log(`\n${passed} of ${results.length} checks passed`);
  process.exit(passed === results.length ? 0 : 1);
})().catch(e => { console.error('SCRIPT ERROR', e.message); process.exit(1); });
