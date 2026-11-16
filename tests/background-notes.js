// Notes written in the background (batch 1, item 3). After a lecture ends, after "Make notes from what was recorded" and
// after "Try again", the app goes straight to the lecture page, which shows "Hal is writing your notes" instead of a
// locked dialog; the lecture is checked in the background and the page updates by itself. On another page a clickable
// notice says the notes are ready (red when they failed). Real-backend mode, fake API by request interception: each
// scenario controls what GET /lectures/:id/status answers (processing, ready, failed or 404) and every request is logged.
// Each status reply is held for a moment, so two loops polling the same lecture would overlap; be.max[id] is the most
// status requests for one lecture that were in flight at once.
const { chromium, ORIGIN, serve, setConfig } = require('./harness');
const results = [];
const check = (name, ok, detail) => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || detail === undefined ? '' : '  -> ' + JSON.stringify(detail)}`); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const WRITING = '.main h3:text-is("Hal is writing your notes")';
const lec = (id, status, extra) => ({ id, course: 'c1', title: 'Lecture ' + id, date: 'Today', duration: 0, status, ...extra });
const DETAIL = withSlides => ({ alerts: [], transcript: [{ t: 0, text: 'line' }], flashcards: [], quiz: [], slides: withSlides ? [{ n: 1, title: 'One' }] : [],
  sections: [{ title: 'Part one', start: 0, end: 300, points: [{ t: 30, text: 'A point', off: false, slide: withSlides ? 1 : null }] }] });

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const errs = [];
  // One browser context with its own fake backend, signed in and on the home page.
  //   be.set(id, s)  what the lecture's status is from now on ('processing', 'ready', 'failed', 404 for a deleted lecture,
  //                  or another error code such as 502 that /status answers for now)
  //   be.polls(id)   how many status requests for that lecture have been received; be.times[id] when each one arrived
  const open = async (lectures, opts = {}) => {
    const cfg = { USE_MOCK: false, POLL_MS: opts.poll ?? 50 };
    const be = { log: [], st: {}, inflight: {}, max: {}, after404: {}, sent404: {}, slides: {}, times: {}, hold: opts.hold ?? 60, finish: opts.finish || 200, lectures };
    const find = id => be.lectures.find(l => l.id === id);
    be.set = (id, s) => { be.st[id] = s; const l = find(id); if (l && typeof s === 'string') l.status = s; };
    be.polls = id => be.log.filter(x => x === `GET /lectures/${id}/status`).length;
    lectures.forEach(l => { be.st[l.id] = l.status; });
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await setConfig(ctx, cfg);
    await ctx.route('**/*', async route => {
      const req = route.request(), u = new URL(req.url()), m = req.method(), j = (o, s = 200) => route.fulfill({ status: s, contentType: 'application/json', body: JSON.stringify(o) }).catch(() => {});
      if (!u.pathname.startsWith('/api/')) return serve(route, cfg);
      const p = u.pathname.slice(4); be.log.push(m + ' ' + p);
      let mm;
      if (p === '/session') return j({ token: 'tok', user: { name: 'T' } });
      if (p === '/home') return j({ user: { name: 'T' }, courses: [{ id: 'c1', code: 'TEST 1001' }], lectures: be.lectures, upcoming: [], settings: { classLanguage: 'en', zhDefault: false } });
      if ((mm = /^\/lectures\/(\w+)\/status$/.exec(p))) {
        const id = mm[1]; if (be.sent404[id]) be.after404[id] = (be.after404[id] || 0) + 1; (be.times[id] = be.times[id] || []).push(Date.now());
        be.inflight[id] = (be.inflight[id] || 0) + 1; be.max[id] = Math.max(be.max[id] || 0, be.inflight[id]);
        await sleep(be.hold); be.inflight[id]--;
        if (be.st[id] === 404) { be.sent404[id] = true; return j({ message: 'This lecture does not exist.' }, 404); }
        if (typeof be.st[id] === 'number') return j({ message: 'Bad gateway' }, be.st[id]);   // the server is restarting, say
        return j({ status: be.st[id] });
      }
      if (m === 'POST' && (mm = /^\/lectures\/(\w+)\/(finish|retry)$/.exec(p))) { if (be.finish !== 200) return j({ message: 'The server is busy.' }, be.finish); be.set(mm[1], 'processing'); return j({ status: 'processing' }); }
      if (m === 'POST' && (mm = /^\/lectures\/(\w+)\/slides$/.exec(p))) { be.set(mm[1], 'processing'); return route.fulfill({ status: 204 }); }
      if (m === 'POST' && p === '/lectures') { const l = lec('lnew', 'recording', { source: 'link' }); be.lectures.unshift(l); be.st.lnew = 'recording'; return j(l); }
      if (m === 'POST' && p === '/lectures/lnew/link') return route.fulfill({ status: 204 });
      if (m === 'GET' && (mm = /^\/lectures\/(\w+)$/.exec(p))) { const l = find(mm[1]); if (!l) return j({ message: 'This lecture does not exist.' }, 404);
        return j({ lecture: l, detail: l.status === 'ready' || l.notes ? DETAIL(!!be.slides[l.id]) : null }); }
      return j({ message: 'Not found' }, 404);
    });
    const page = await ctx.newPage(); page.on('pageerror', e => errs.push(e.message));
    await page.goto(ORIGIN + '/#/signin'); await page.fill('input[name=code]', 'abc'); await page.click('form.auth button'); await page.waitForSelector('.shell');
    return { ctx, page, be };
  };
  const until = async (fn, ms = 5000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await sleep(50); } return false; };
  const lastToast = page => page.evaluate(() => { const el = [...document.querySelectorAll('.toast')].pop(); return el ? { tag: el.tagName, href: el.href || '', text: el.textContent, cls: el.className } : { tag: '', href: '', text: '', cls: '' }; });
  const modals = page => page.locator('#overlay .modal').count();

  console.log('=== a lecture whose notes are being written ===');
  { const { ctx, page, be } = await open([lec('l1', 'recording', { source: 'record' })]);
    await page.goto(ORIGIN + '/#/lecture/l1'); await page.waitForSelector('.main .card h3');
    await page.click('button:text-is("Make notes from what was recorded")');
    await page.waitForSelector(WRITING, { timeout: 5000 }).catch(() => {});
    const h3 = await page.locator('.main .card h3').first().innerText(), m1 = await modals(page);
    check('after "Make notes from what was recorded" the lecture page shows "Hal is writing your notes", with no locked dialog', h3 === 'Hal is writing your notes' && !m1 && be.log.includes('POST /lectures/l1/finish'), { h3, modals: m1 });
    await until(() => be.polls('l1') > 0); be.set('l1', 'ready');
    await page.waitForSelector('.nsec', { timeout: 5000 }).catch(() => {});
    check('the page updates by itself when the notes are ready', (await page.locator('.nsec').count()) > 0 && page.url().endsWith('#/lecture/l1') && !(await modals(page)), { url: page.url(), log: be.log.slice(-4) });
    await ctx.close(); }

  console.log('\n=== notices on other pages ===');
  { const { ctx, page, be } = await open([lec('l2', 'processing'), lec('l5', 'processing'), lec('l10', 'processing'), lec('l11', 'processing')]);
    await until(() => be.polls('l2') > 0 && be.polls('l5') > 0);
    be.set('l2', 'ready'); await page.waitForSelector('a.toast', { timeout: 5000 }).catch(() => {});
    let toast = await lastToast(page);
    check('on another page a ready lecture gives a toast link "Your notes are ready.  Open"', toast.tag === 'A' && toast.href.endsWith('#/lecture/l2') && /Your notes are ready\.\s+Open/.test(toast.text) && !toast.cls.includes('bad'), toast);
    be.set('l5', 'failed'); await page.waitForSelector('.toast.bad', { timeout: 5000 }).catch(() => {});
    toast = await lastToast(page);
    check('a failed lecture gives a red toast', toast.cls.includes('bad') && /could not be written/.test(toast.text) && toast.tag === 'A' && toast.href.endsWith('#/lecture/l5'), toast);
    await page.evaluate(() => { document.querySelectorAll('.toast').forEach(t => t.remove()); window.__sidenote.setLang('zh'); });
    await page.goto(ORIGIN + '/#/lecture/l11'); await page.waitForSelector('.main .card h3');
    const zh = { h3: await page.locator('.main .card h3').first().innerText(), text: (await page.locator('.main .card').first().innerText()).replace(/\s+/g, ' '), home: await page.locator('.main .card a.btn').first().innerText({ timeout: 2000 }).catch(() => '') };
    await page.goto(ORIGIN + '/#/home'); await page.waitForSelector('#lecList');
    be.set('l10', 'ready'); await page.waitForSelector('a.toast', { timeout: 5000 }).catch(() => {});
    zh.toast = (await lastToast(page)).text;
    check('in Chinese the writing card and the notice are translated', zh.h3 === 'Hal 正在寫你的筆記' && zh.text.includes('先整理逐字稿') && zh.text.includes('不用在這裡等') && zh.home === '回到主頁' && zh.toast === '你的筆記整理好了。  開啟', zh);
    await ctx.close(); }

  console.log('\n=== one loop per lecture, also after a reload ===');
  { const { ctx, page, be } = await open([lec('l6', 'recording', { source: 'record' })], { poll: 20, hold: 80 });
    await page.goto(ORIGIN + '/#/lecture/l6'); await page.waitForSelector('.main .card h3');
    await page.click('button:text-is("Make notes from what was recorded")'); await page.waitForSelector(WRITING, { timeout: 5000 }).catch(() => {});
    const roam = async () => { for (const h of ['#/home', '#/lecture/l6', '#/home']) { await page.goto(ORIGIN + '/' + h); await page.waitForSelector('.shell'); await sleep(250); }
      await page.evaluate(() => { S.homeLoaded = false; route(); }); await sleep(250); await page.goto(ORIGIN + '/#/lecture/l6'); await sleep(250);
      await page.evaluate(() => window.__sidenote.watch && window.__sidenote.watch('l6')); await sleep(400); };   // a second start, as another finalize or Try again would make
    await roam(); const before = be.polls('l6');
    await page.reload(); const mark = be.log.length; await page.waitForSelector('.shell'); await sleep(800);
    const statusCallsAfterReload = be.log.slice(mark).filter(x => x === 'GET /lectures/l6/status').length;
    check('reloading during processing starts watching again', statusCallsAfterReload > 0, { before, statusCallsAfterReload });
    await roam();
    const maxInFlight = be.max.l6;
    check('one lecture is never polled twice at once', maxInFlight === 1 && before > 0, { maxInFlight, before, total: be.polls('l6') });
    await ctx.close(); }

  console.log('\n=== watching stops ===');
  { const { ctx, page, be } = await open([lec('l7', 'processing')]);
    be.set('l7', 404);
    const saw404 = await until(() => be.sent404.l7); await sleep(700);
    const callsAfter404 = be.after404.l7 || 0, noToast = (await page.locator('.toast').count()) === 0;
    check('a 404 from /status stops watching quietly', saw404 && callsAfter404 === 0 && noToast && be.polls('l7') === 1, { saw404, callsAfter404, noToast, polls: be.polls('l7') });
    await ctx.close(); }

  { const { ctx, page, be } = await open([lec('l8', 'processing')], { poll: 1, hold: 0 });
    await page.goto(ORIGIN + '/#/lecture/l8'); await page.waitForSelector(WRITING, { timeout: 5000 }).catch(() => {});
    const during = await page.locator('.main button:text-is("Check again")').count();
    let n = -1; await until(async () => { const k = be.polls('l8'); const still = k === n; n = k; await sleep(400); return still && k > 0; }, 30000);
    await page.waitForSelector('.main button:text-is("Check again")', { timeout: 3000 }).catch(() => {});
    const after = await page.locator('.main button:text-is("Check again")').count();
    const checkAgainShown = during === 0 && after === 1 && be.polls('l8') === 600;
    check('watching stops after 600 tries and the page offers "Check again"', checkAgainShown, { during, after, polls: be.polls('l8') });
    // "Check again" reads the lecture again; it is still being written, so it is watched again (this visit stopped
    // watching it without an answer), and the page updates by itself when the notes are ready.
    await page.click('.main button:text-is("Check again")');
    const again = await until(() => be.polls('l8') > 600), hidden = await until(async () => (await page.locator('.main button:text-is("Check again")').count()) === 0);
    be.set('l8', 'ready'); await page.waitForSelector('.nsec', { timeout: 5000 }).catch(() => {});
    const notes = await page.locator('.nsec').count();
    check('after watching stopped, "Check again" starts watching again and the page updates when the notes are ready', again && hidden && notes > 0, { again, hidden, notes, polls: be.polls('l8') });
    await ctx.close(); }

  // Errors (a 502 while the server restarts, the network gone for a minute) do not stop the watch: it asks again, waiting
  // twice as long after each error (up to 20 times POLL_MS, a minute at the usual 3 s), and back at POLL_MS after an answer.
  { const { ctx, page, be } = await open([lec('l12', 'processing')], { poll: 10, hold: 0 });
    be.set('l12', 502);
    await until(() => be.polls('l12') >= 25, 20000);
    const gaps = ts => ts.slice(1).map((x, i) => x - ts[i]), errGaps = gaps(be.times.l12).slice(-5);
    be.set('l12', 'processing'); const mark = be.polls('l12');
    await until(() => be.polls('l12') >= mark + 6, 5000);
    const okGaps = gaps(be.times.l12.slice(mark + 1));
    be.set('l12', 'ready'); await page.waitForSelector('a.toast', { timeout: 5000 }).catch(() => {});
    const toast = await lastToast(page);
    check('errors from /status (more than 20 in a row) do not stop the watch: it waits longer after each one, then the notice still arrives',
      errGaps.length === 5 && errGaps.every(g => g >= 150) && okGaps.length >= 4 && okGaps.every(g => g < 100) && toast.tag === 'A' && toast.href.endsWith('#/lecture/l12') && /Your notes are ready/.test(toast.text),
      { errGaps, okGaps, toast, polls: be.polls('l12') });
    await ctx.close(); }

  console.log('\n=== Try again ===');
  { const { ctx, page, be } = await open([lec('l3', 'failed')]);
    await page.goto(ORIGIN + '/#/lecture/l3'); await page.waitForSelector('.main .card h3');
    await page.click('.main button:text-is("Try again")'); await page.waitForSelector(WRITING, { timeout: 5000 }).catch(() => {});
    const writingCard = (await page.locator(WRITING).count()) === 1, modal = await modals(page);
    await until(() => be.polls('l3') > 0);
    check('Try again on a failed lecture calls /retry and shows the writing card, not a dialog', be.log.includes('POST /lectures/l3/retry') && !be.log.includes('POST /lectures/l3/finish') && writingCard && !modal && be.polls('l3') > 0, { writingCard, modal, log: be.log.filter(x => /l3/.test(x)).slice(0, 4) });
    await ctx.close(); }

  console.log('\n=== adding slides later keeps its own wait ===');
  { const { ctx, page, be } = await open([lec('l4', 'ready', { notes: true })]);
    await page.goto(ORIGIN + '/#/lecture/l4'); await page.waitForSelector('.nsec');
    await page.click('.page-h button:text-is("More")');
    const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.click('#overlay button:text-is("Add slides")')]);
    await fc.setFiles({ name: 'slides.pdf', mimeType: 'application/pdf', buffer: Buffer.alloc(50000, 1) });
    const slidesDialog = await page.waitForSelector('#overlay h3:text-is("Hal is putting the notes under the slides")', { timeout: 5000 }).then(() => true, () => false);
    await until(() => be.polls('l4') > 0);
    // Whatever would start a background check while the slides are being matched: the home data (where the lecture is
    // now processing) and the lecture page itself. The back button would do this too.
    await page.evaluate(() => { S.homeLoaded = false; route(); }); await sleep(600);
    const watched = await page.evaluate(() => !!(window.__sidenote.isWatching && window.__sidenote.isWatching('l4')));
    be.slides.l4 = true; be.set('l4', 'ready');
    await page.waitForSelector('.toast', { timeout: 5000 }).catch(() => {});
    const toast = (await lastToast(page)).text, n = be.polls('l4'); await sleep(500);
    check('adding slides later still waits in its own dialog and the lecture is not polled twice', slidesDialog && be.max.l4 === 1 && !watched && toast === 'Slides added' && be.polls('l4') === n, { slidesDialog, max: be.max.l4, watched, toast, polls: [n, be.polls('l4')] });
    await ctx.close(); }

  console.log('\n=== signing out ===');
  { const { ctx, page, be } = await open([lec('l9', 'processing')]);
    await until(() => be.polls('l9') > 0); const before = be.polls('l9');
    await page.goto(ORIGIN + '/#/settings'); await page.click('button:text-is("Sign out")'); await sleep(150);
    const mark = be.polls('l9'); await sleep(700);
    const callsAfterSignOut = be.polls('l9') - mark;
    check('signing out stops watching', before > 0 && callsAfterSignOut === 0, { before, callsAfterSignOut });
    await ctx.close(); }

  console.log('\n=== the notes cannot be started ===');
  { const { ctx, page } = await open([], { finish: 500 });
    await page.goto(ORIGIN + '/#/new'); await page.waitForSelector('.choice');
    await page.click('.choice button:has-text("Paste a lecture video link")');
    await page.fill('input[type=url]', 'https://www.youtube.com/watch?v=abc'); await page.click('form button.btn.blue');
    await page.waitForSelector('.toast.bad', { timeout: 5000 }).catch(() => {});
    const toast = await lastToast(page);
    check('when /finish fails, a red notice links to the lecture so it can be tried again', toast.tag === 'A' && toast.cls.includes('bad') && toast.href.endsWith('#/lecture/lnew') && /The lecture was saved, but its notes could not be started\. Open it to try again\.\s+Open/.test(toast.text) && !(await modals(page)), toast);
    await ctx.close(); }

  check('no page errors', errs.length === 0, errs);
  await browser.close();
  console.log(`\n${results.filter(Boolean).length} of ${results.length} checks passed`);
})().catch(e => { console.error('SCRIPT ERROR', String(e.message).slice(0, 1200)); process.exit(1); });
