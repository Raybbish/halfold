// Review across lectures (from the designer's halfold.html, 2026-11-24): "Review" in the sidebar and a card on the home
// page with the number of flashcards not known yet (GET /home reviewCount); #/review goes through them (GET /review) one
// at a time: Space flips, the right arrow / "I know this" marks it known (PUT /lectures/:id/cards/known), the down arrow /
// "Again later" leaves it. The end says how many were known and can go through the rest again. A card known on a lecture
// page is one fewer; one known in Review shows as known on its lecture. Chinese. Real-backend mode by request
// interception, and the sample build.
const { chromium, ORIGIN, serve, setConfig } = require('./harness');
const results = [];
const check = (name, ok, detail) => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || detail === undefined ? '' : '  -> ' + JSON.stringify(detail)}`); };

const CARDS = { l1: [{ q: 'What is opportunity cost?', a: 'The next best alternative given up.' }, { q: 'What is a sunk cost?', a: 'A cost already paid.' }], l2: [{ q: 'What does the PPF show?', a: 'The most two goods can be made.' }] };
const TITLE = { l1: 'Week 9', l2: 'Week 8' };

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const errs = [];
  /* The fake server keeps what is known: be.known = {l1: [..], l2: [..]}. be.putStatus: what PUT cards/known answers. */
  async function open(be, o = {}) {
    const ctx = await browser.newContext({ viewport: { width: o.width || 1280, height: 800 } });
    if (o.lang) await ctx.addInitScript(l => { try { localStorage.setItem('sidenote.lang', l); } catch (e) {} }, o.lang);
    const cfg = { USE_MOCK: false, POLL_MS: 100 };
    await setConfig(ctx, cfg);
    const left = () => Object.keys(CARDS).flatMap(id => CARDS[id].map((c, index) => ({ lectureId: id, lecture: TITLE[id], index, ...c })).filter(c => !(be.known[id] || []).includes(c.index)));
    await ctx.route('**/*', route => {
      const req = route.request(), u = new URL(req.url()), m = req.method(), j = (b, s = 200) => route.fulfill({ status: s, contentType: 'application/json', body: JSON.stringify(b) });
      if (!u.pathname.startsWith('/api/')) return serve(route, cfg);
      const p = u.pathname.slice(4); be.log.push(m + ' ' + p);
      if (p === '/session') return j({ token: 't', user: { name: 'Jasper' } });
      if (p === '/home') return j({ user: { name: 'Jasper' }, courses: [{ id: 'c1', code: 'ECON 1001', name: 'Micro' }], lectures: ['l1', 'l2'].map(id => ({ id, course: 'c1', title: TITLE[id], date: 'Tue 10 Nov', duration: 300, status: 'ready' })), upcoming: [], settings: { classLanguage: 'en', zhDefault: false },
        week: { lectures: 2, known: 0, quiz: 0, days: [1, 0, 0, 0, 0] }, ...(be.noCount ? {} : { reviewCount: left().length }) });
      if (m === 'GET' && p === '/review') return j({ cards: left() });
      const known = /^\/lectures\/(l\d)\/cards\/known$/.exec(p);
      if (m === 'PUT' && known) { const b = JSON.parse(req.postData()); be.puts.push([known[1], b]); if (be.putStatus) return j({ message: 'This flashcard is no longer there. Open the lecture again to see its cards.' }, be.putStatus);
        const k = new Set(be.known[known[1]] || []); if (b.known) k.add(b.index); else k.delete(b.index); be.known[known[1]] = [...k]; return route.fulfill({ status: 204, body: '' }); }
      const prog = /^\/lectures\/(l\d)\/progress$/.exec(p);
      if (m === 'PUT' && prog) { be.known[prog[1]] = JSON.parse(req.postData()).known; return route.fulfill({ status: 204, body: '' }); }
      const lec = /^\/lectures\/(l\d)$/.exec(p);
      if (m === 'GET' && lec) return j({ lecture: { id: lec[1], course: 'c1', title: TITLE[lec[1]], date: 'Tue 10 Nov', duration: 300, status: 'ready' },
        detail: { alerts: [], sections: [{ title: 'T', start: 0, end: 300, points: [{ t: 10, text: 'A point.' }] }], slides: [], transcript: [], flashcards: CARDS[lec[1]], quiz: [], progress: { known: be.known[lec[1]] || [] } } });
      return j({ message: 'Not found' }, 404);
    });
    const page = await ctx.newPage(); page.on('pageerror', e => errs.push(e.message));
    await page.goto(ORIGIN + '/#/signin'); await page.fill('input[name=code]', 'abc'); await page.click('form.auth button'); await page.waitForSelector('.shell');
    return { ctx, page };
  }
  const side = page => page.locator('.side a.n[href="#/review"]').innerText().then(x => x.replace(/\s+/g, ' ')).catch(() => '');
  const homeCard = page => page.locator('.today a[href="#/review"]').innerText().then(x => x.replace(/\s+/g, ' ')).catch(() => '');
  const main = page => page.locator('.main .inner').innerText().then(x => x.replace(/\s+/g, ' ')).catch(() => '');
  const goReview = async page => { await page.evaluate(() => { location.hash = '#/review'; }); await page.waitForSelector('.fc, .result, .main .card h3'); await page.waitForTimeout(150); };
  const counter = page => page.locator('.page-h .tag').innerText().catch(() => '');

  { const be = { log: [], puts: [], known: {} }; const { ctx, page } = await open(be);
    await page.evaluate(() => { location.hash = '#/home'; }); await page.waitForSelector('.today');
    const card = await homeCard(page), sb = await side(page);
    check('home: a Review card with the number of cards to go over; the sidebar has Review with the number', card === 'Review 3 cards to go over From all your lectures: the ones you have not marked as known.' && sb === 'Review 3', { card, sb });
    await page.click('.today a[href="#/review"]'); await page.waitForSelector('.fc');
    let t = await main(page);
    check('#/review: the first card, "1 / 3", where it is from, and the keys', be.log.includes('GET /review') && t.includes('Cards from all your lectures that you have not marked as known.') && await counter(page) === '1 / 3' && t.includes('What is opportunity cost?') && t.includes('From Week 9') && t.includes('Space flips the card. Right arrow: I know this. Down arrow: again later.'), t);
    check('the sidebar marks Review as the page on screen', await page.locator('.side a.n.on[href="#/review"]').count() === 1);
    await page.keyboard.press('Space'); await page.waitForTimeout(150);
    check('Space flips the card', await page.locator('.fc .flip.on').count() === 1);
    await page.keyboard.press('ArrowRight'); await page.waitForTimeout(300);
    check('the right arrow: known on its lecture (PUT /lectures/:id/cards/known {index, known: true}); the next card, unflipped; the sidebar counts one fewer', JSON.stringify(be.puts) === '[["l1",{"index":0,"known":true}]]' && await counter(page) === '2 / 3' && await page.locator('.fc .flip.on').count() === 0 && (await main(page)).includes('What is a sunk cost?') && await side(page) === 'Review 2', { puts: be.puts, side: await side(page) });
    await page.keyboard.press('ArrowDown'); await page.waitForTimeout(200);
    check('the down arrow: again later, nothing sent', be.puts.length === 1 && await counter(page) === '3 / 3' && (await main(page)).includes('From Week 8'));
    await page.click('[data-act=rvknow]'); await page.waitForSelector('.result');
    t = await main(page);
    check('the end: how many were known, the rest come back, go through the rest again', t.includes('2 of 3 marked as known') && t.includes('The rest come back the next time you open Review.') && await page.locator('.result button:text-is("Go through the rest again")').count() === 1 && be.puts.length === 2, t);
    const gets = be.log.filter(x => x === 'GET /review').length;
    await page.click('.result button:text-is("Go through the rest again")'); await page.waitForSelector('.fc');
    check('going through the rest again asks the server again: only the card left', be.log.filter(x => x === 'GET /review').length === gets + 1 && await counter(page) === '1 / 1' && (await main(page)).includes('What is a sunk cost?'));
    await page.click('[data-act=rvknow]'); await page.waitForSelector('.result');
    t = await main(page);
    check('all known: "Nothing left to review", and home', t.includes('1 of 1 marked as known') && t.includes('Nothing left to review. Record another lecture to get more.') && await page.locator('.result button').count() === 0 && await page.locator('.result a.btn.primary[href="#/home"]').count() === 1, t);
    await page.evaluate(() => { location.hash = '#/home'; }); await page.waitForSelector('.today');
    check('home afterwards: "No cards waiting"', (await homeCard(page)) === 'Review No cards waiting Flashcards from your lectures collect here.' && await side(page) === 'Review', await homeCard(page));
    await page.evaluate(() => { location.hash = '#/review'; }); await page.waitForSelector('.main .card h3');
    check('nothing to review: "No cards to review"', (await main(page)).includes('No cards to review') && (await main(page)).includes('Flashcards from your lectures collect here until you mark them as known.'));
    await ctx.close(); }

  /* The lecture page and Review agree. */
  { const be = { log: [], puts: [], known: {} }; const { ctx, page } = await open(be);
    await page.evaluate(() => { location.hash = '#/lecture/l1'; }); await page.waitForSelector('.tabs');
    await page.click('.tabs [role=tab]:has-text("Flashcards")'); await page.waitForSelector('.fc');
    await page.click('.fc .ctl .btn:text-is("I know this")'); await page.waitForTimeout(200);
    check('"I know this" on a lecture page: one fewer in the sidebar', await side(page) === 'Review 2', await side(page));
    await page.click('.fc .ctl .btn:text-is("I know this")'); await page.waitForTimeout(200);
    await page.click('.fc .ctl .btn:text-is("I know this")'); await page.waitForTimeout(200);   // the first card again: already known, not one fewer
    check('a card already known does not count twice', await side(page) === 'Review 1', await side(page));
    await goReview(page);
    check('Review then has only the other lecture\'s card', await counter(page) === '1 / 1' && (await main(page)).includes('From Week 8'));
    await page.evaluate(() => { location.hash = '#/lecture/l2'; }); await page.waitForSelector('.tabs');
    await goReview(page); await page.keyboard.press('ArrowRight'); await page.waitForTimeout(200);
    await page.evaluate(() => { location.hash = '#/lecture/l2'; }); await page.waitForSelector('.tabs');
    await page.click('.tabs [role=tab]:has-text("Flashcards")'); await page.waitForSelector('.fc');
    const pips = await page.$$eval('.fc .pips i', is => is.map(i => i.className));
    check('a card known in Review shows as known on its lecture (opened earlier in this visit)', (await page.innerText('.fc')).includes('1 of 1 marked as known') || pips.join(',') === 'c', { pips, txt: await page.innerText('.fc') });
    await ctx.close(); }

  { const be = { log: [], puts: [], known: {}, putStatus: 404 }; const { ctx, page } = await open(be);
    await goReview(page); await page.click('[data-act=rvknow]'); await page.waitForSelector('.toast.bad', { timeout: 3000 }).catch(() => {});
    const msg = await page.locator('.toast.bad').innerText().catch(() => '');
    check('a card the server no longer has: its message, in red; the review goes on', msg === 'This flashcard is no longer there. Open the lecture again to see its cards.' && await counter(page) === '2 / 3', msg);
    await ctx.close(); }

  { const be = { log: [], puts: [], known: {}, noCount: true }; const { ctx, page } = await open(be);
    await page.evaluate(() => { location.hash = '#/home'; }); await page.waitForSelector('.today');
    check('a server that sends no reviewCount: "Go over your flashcards", no number in the sidebar', (await homeCard(page)).includes('Go over your flashcards') && await side(page) === 'Review', await homeCard(page));
    await ctx.close(); }

  { const be = { log: [], puts: [], known: {} }; const { ctx, page } = await open(be, { lang: 'zh-Hant' });
    await page.evaluate(() => { location.hash = '#/home'; }); await page.waitForSelector('.today');
    const card = await homeCard(page), sb = await side(page);
    await goReview(page);
    const t1 = await main(page);
    await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowDown'); await page.waitForSelector('.result');
    const t2 = await main(page);
    check('Traditional: home card, sidebar, the page and the end', card.includes('溫習') && card.includes('3 張閃卡待溫習') && sb === '溫習 3' && t1.includes('主頁 / 溫習') && t1.includes('來自你所有課堂、還沒標記為「記得」的閃卡。') && t1.includes('來自 Week 9') && t1.includes('稍後再看') && t1.includes('我記得') && t2.includes('已記得 2／3 張') && t2.includes('把剩下的再看一遍'), { card, sb, t1: t1.slice(0, 300), t2: t2.slice(0, 200) });
    await page.evaluate(() => window.__sidenote.setLang('zh-Hans')); await page.waitForTimeout(200);
    const t3 = await main(page);
    /* The Simplified table reads 溫習 as 复习, and 「」 as “”. */
    check('Simplified: the end', t3.includes('主页 / 复习') && t3.includes('已记得 2／3 张') && t3.includes('把剩下的再看一遍') && t3.includes('其余的，下次打开“复习”时会再出现。'), t3.slice(0, 300));
    await ctx.close(); }

  /* The sample build: the sample lecture's six cards. Its home data has no reviewCount (tests/api-parity.js keeps it as
     sidenote.html gave it), so the number appears once Review has counted the cards. */
  { const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } }); const page = await ctx.newPage(); page.on('pageerror', e => errs.push(e.message));
    await page.goto(ORIGIN + '/#/signin'); await page.fill('input[name=code]', 'abc'); await page.click('form.auth button'); await page.waitForSelector('.shell');
    await page.evaluate(() => { location.hash = '#/home'; }); await page.waitForSelector('.today');
    const card = await homeCard(page);
    await goReview(page); const six = await counter(page); await page.keyboard.press('ArrowRight'); await page.waitForTimeout(200);
    await page.evaluate(() => { location.hash = '#/home'; }); await page.waitForSelector('.today');
    check('sample build: Review has the sample lecture\'s six cards', six === '1 / 6', six);
    check('sample build: "Go over your flashcards" at first; Review finds the six cards, and one known leaves five', card.includes('Go over your flashcards') && await side(page) === 'Review 5' && (await homeCard(page)).includes('5 cards to go over'), { card, side: await side(page) });
    await ctx.close(); }

  /* A phone: no sidebar; the home card leads to Review, which fits. */
  { const be = { log: [], puts: [], known: {} }; const { ctx, page } = await open(be, { width: 390 });
    await page.evaluate(() => { location.hash = '#/home'; }); await page.waitForSelector('.today');
    await page.click('.today a[href="#/review"]'); await page.waitForSelector('.fc');
    const w = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
    check('on a phone the home card opens Review, with no sideways scrolling', w);
    await ctx.close(); }

  check('no page errors', errs.length === 0, errs);
  await browser.close();
  const n = results.filter(Boolean).length; console.log(`\n${n} of ${results.length} checks passed`); process.exit(n === results.length ? 0 : 1);
})().catch(e => { console.error('SCRIPT ERROR', String(e.message).slice(0, 1200)); process.exit(1); });
