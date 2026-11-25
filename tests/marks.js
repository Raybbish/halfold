// Marks made in class (from the designer's halfold.html, 2026-11-24): "Important" and "Lost me" on the recording page send
// POST /lectures/:id/marks and are kept in this browser too; the lecture page shows "Your marks from class" above the notes
// (the server's detail.marks, plus any kept here that the server does not have), each with the words said then, and a
// time plays from 15 seconds before. Not on the shared page. Chinese. Real-backend mode (fake API by request interception),
// fake microphone, navigator.vibrate counted.
const { chromium, ORIGIN, serve, setConfig } = require('./harness');
const results = [];
const check = (name, ok, detail) => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || detail === undefined ? '' : '  -> ' + JSON.stringify(detail)}`); };

const TRANSCRIPT = [{ t: 1, text: 'Good morning.' }, { t: 95, text: 'The slope of the PPF is the opportunity cost.' }, { t: 400, text: 'This will be on the midterm.' }, { t: 700, text: 'That is all.' }];
const DETAIL = (marks) => ({ alerts: [], sections: [{ title: 'Opportunity cost', start: 0, end: 800, points: [{ t: 95, text: 'The slope is the opportunity cost.' }, { t: 400, text: 'On the midterm.' }] }], slides: [], transcript: TRANSCRIPT, flashcards: [{ q: 'Q?', a: 'A.' }], quiz: [], ...(marks ? { marks } : {}) });

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--no-sandbox'] });
  const errs = [];
  /* be.markStatus: what POST /marks answers. be.marks: detail.marks of lecture l1. */
  async function open(be, o = {}) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, permissions: ['microphone'] });
    await ctx.addInitScript(([lang, keep]) => { try { localStorage.setItem('sidenote.recTip', '1'); localStorage.setItem('sidenote.lastCourse', 'c1'); if (lang) localStorage.setItem('sidenote.lang', lang); if (keep) localStorage.setItem('sidenote.marks.l1', keep); window.__vib = 0; navigator.vibrate = () => { window.__vib++; return true; }; } catch (e) {} }, [o.lang || '', o.keep || '']);
    const cfg = { USE_MOCK: false, POLL_MS: 50, CHUNK_SECONDS: 1 };
    await setConfig(ctx, cfg);
    await ctx.route('**/*', route => {
      const req = route.request(), u = new URL(req.url()), m = req.method(), j = (b, s = 200) => route.fulfill({ status: s, contentType: 'application/json', body: JSON.stringify(b) });
      if (!u.pathname.startsWith('/api/')) return serve(route, cfg);
      const p = u.pathname.slice(4); be.log.push(m + ' ' + p);
      if (p === '/session') return j({ token: 't', user: { name: 'Jasper' } });
      if (p === '/home') return j({ user: { name: 'Jasper' }, courses: [{ id: 'c1', code: 'ECON 1001', name: 'Micro' }], lectures: [{ id: 'l1', course: 'c1', title: 'Week 9', date: 'Tue 10 Nov', duration: 800, status: 'ready', shareUrl: 'x' }, ...(be.lec ? [be.lec] : [])], upcoming: [], settings: { classLanguage: 'en', zhDefault: false }, reviewCount: 1 });
      if (m === 'POST' && p === '/lectures') { const b = JSON.parse(req.postData() || '{}'); be.lec = { id: 'lnew', course: b.courseId, title: b.title, date: 'Today', duration: 0, status: 'recording' }; return j(be.lec); }
      if (m === 'POST' && p === '/lectures/lnew/marks') { be.posted.push(JSON.parse(req.postData())); return be.markStatus ? j({ message: 'Down' }, be.markStatus) : route.fulfill({ status: 204, body: '' }); }
      if (m === 'PATCH' && p === '/lectures/lnew') return route.fulfill({ status: 204, body: '' });
      if (m === 'POST' && /\/chunks$/.test(p)) return j({ segments: [], alerts: [] });
      if (m === 'GET' && p === '/lectures/l1') return j({ lecture: { id: 'l1', course: 'c1', title: 'Week 9', date: 'Tue 10 Nov', duration: 800, status: 'ready' }, detail: DETAIL(be.marks) });
      if (m === 'GET' && p === '/shared/s1') return j({ lecture: { id: 's1', course: 'c1', title: 'Week 9', date: 'Tue 10 Nov', duration: 800, status: 'ready' }, course: { id: 'c1', code: 'ECON 1001' }, detail: DETAIL(null), sharedBy: 'Ann' });
      return j({ message: 'Not found' }, 404);
    });
    const page = await ctx.newPage(); page.on('pageerror', e => errs.push(e.message));
    await page.goto(ORIGIN + '/#/signin'); await page.fill('input[name=code]', 'abc'); await page.click('form.auth button'); await page.waitForSelector('.shell');
    return { ctx, page };
  }
  const record = async page => { await page.evaluate(() => { location.hash = '#/home'; }); await page.waitForSelector('.rec-btn'); await page.click('.rec-btn'); await page.waitForSelector('.markrow', { timeout: 8000 }); await page.waitForTimeout(1300); };
  const lastToast = page => page.locator('.toast').last().innerText().catch(() => '');
  const toasted = (page, text) => page.locator('.toast').allInnerTexts().then(xs => xs.includes(text)).catch(() => false);
  const marksCard = page => page.locator('.card.marks').innerText().then(x => x.replace(/\s+/g, ' ')).catch(() => '');

  /* ---------- the recording page ---------- */
  { const be = { log: [], posted: [] }; const { ctx, page } = await open(be);
    await record(page);
    const row = (await page.innerText('.markrow')).replace(/\s+/g, ' ');
    check('the recording page has "Mark this moment" with Important and Lost me, and says where the marks go', row.includes('Mark this moment') && row.includes('Important') && row.includes('Lost me') && row.includes('One tap. Your marks are waiting at the top of the notes after class.'), row);
    await page.fill('.live-meta input', 'Week 10 draft');
    await page.click('[data-act=mark-important]'); await page.waitForTimeout(300);
    /* Leaving the title box for the button also saves the title ("Saved"). */
    const t1 = await toasted(page, 'Marked as important.'), sec = await page.evaluate(() => window.__sidenote.live.sec);
    check('Important: POST /lectures/:id/marks with the time and kind, a vibration and "Marked as important."', be.posted.length === 1 && be.posted[0].kind === 'important' && typeof be.posted[0].t === 'number' && be.posted[0].t >= 1 && be.posted[0].t <= sec && t1 && await page.evaluate(() => window.__vib) === 1, { posted: be.posted, t1 });
    await page.click('[data-act=mark-lost]'); await page.waitForTimeout(300);
    const t2 = await toasted(page, 'Marked. The notes will point back to this moment.'), count = await page.innerText('#markCount'), title = await page.inputValue('.live-meta input');
    check('Lost me: kind lost and "Marked. The notes will point back to this moment."', be.posted.length === 2 && be.posted[1].kind === 'lost' && t2, { posted: be.posted, t2 });
    check('the row counts the marks, and the page is updated in place (the title box keeps what was typed)', count === '2 marks so far. They are waiting at the top of your notes.' && title === 'Week 10 draft', { count, title });
    const kept = await page.evaluate(() => JSON.parse(localStorage.getItem('sidenote.marks.lnew') || '[]'));
    check('the marks are kept in this browser too (sidenote.marks.<lecture id>)', kept.length === 2 && kept[0].kind === 'important' && kept[1].kind === 'lost', kept);
    await page.click('.live-top button.discard').catch(() => {}); await page.click('#overlay .btn.dark').catch(() => {}); await page.waitForTimeout(400);
    check('discarding the recording forgets its marks here', await page.evaluate(() => localStorage.getItem('sidenote.marks.lnew')) === null);
    await ctx.close(); }

  { const be = { log: [], posted: [], markStatus: 500 }; const { ctx, page } = await open(be);
    await record(page); await page.click('[data-act=mark-lost]'); await page.waitForTimeout(400);
    const bad = await page.locator('.toast.bad').count(), kept = await page.evaluate(() => JSON.parse(localStorage.getItem('sidenote.marks.lnew') || '[]'));
    check('a mark the server could not take: no error shown, still kept here', be.posted.length === 1 && bad === 0 && kept.length === 1 && (await lastToast(page)) === 'Marked. The notes will point back to this moment.', { bad, kept });
    await ctx.close(); }

  /* ---------- the lecture page ---------- */
  { const be = { log: [], posted: [], marks: [{ t: 400, kind: 'important' }, { t: 96, kind: 'lost' }] }; const { ctx, page } = await open(be);
    await page.evaluate(() => { location.hash = '#/lecture/l1'; }); await page.waitForSelector('.card.marks');
    const c = await marksCard(page), order = await page.$$eval('.card.marks .pt .ts', bs => bs.map(b => b.textContent));
    const before = await page.evaluate(() => { const m = document.querySelector('.card.marks'), n = document.querySelector('.nsec'); return !!(m.compareDocumentPosition(n) & Node.DOCUMENT_POSITION_FOLLOWING); });
    check('"Your marks from class" above the notes, by time, each with its kind and the words said then', c.startsWith('Your marks from class') && order.join(',') === '1:36,6:40' && c.includes('Lost me The slope of the PPF is the opportunity cost.') && c.includes('Important This will be on the midterm.') && c.includes('Tap a time to hear it again from 15 seconds before your mark.') && before, { c, order });
    await page.click('.card.marks .pt .ts >> nth=1'); await page.waitForTimeout(300);
    const st = await page.evaluate(() => ({ pos: window.__sidenote.state.pos, tab: window.__sidenote.state.tab }));
    check('a time plays from 15 seconds before the mark (the transcript opens there)', st.pos === 385 && st.tab === 'transcript', st);
    await ctx.close(); }

  { const be = { log: [], posted: [], marks: [{ t: 96, kind: 'lost' }] }; const { ctx, page } = await open(be, { keep: JSON.stringify([{ t: 96, kind: 'lost' }, { t: 700, kind: 'important' }]) });
    await page.evaluate(() => { location.hash = '#/lecture/l1'; }); await page.waitForSelector('.card.marks');
    const order = await page.$$eval('.card.marks .pt .ts', bs => bs.map(b => b.textContent)), keep = await page.evaluate(() => localStorage.getItem('sidenote.marks.l1'));
    check('a mark kept here that the server does not have is shown too, once', order.join(',') === '1:36,11:40' && keep !== null, { order, keep });
    await ctx.close(); }

  { const be = { log: [], posted: [], marks: [{ t: 96, kind: 'lost' }] }; const { ctx, page } = await open(be, { keep: JSON.stringify([{ t: 96, kind: 'lost' }]) });
    await page.evaluate(() => { location.hash = '#/lecture/l1'; }); await page.waitForSelector('.card.marks');
    const order = await page.$$eval('.card.marks .pt .ts', bs => bs.map(b => b.textContent)), keep = await page.evaluate(() => localStorage.getItem('sidenote.marks.l1'));
    check('once the server has every mark kept here, the copy here is dropped', order.join(',') === '1:36' && keep === null, { order, keep });
    await ctx.close(); }

  { const be = { log: [], posted: [] }; const { ctx, page } = await open(be, { keep: JSON.stringify([{ t: 96, kind: 'lost' }]) });
    await page.evaluate(() => { location.hash = '#/lecture/l1'; }); await page.waitForSelector('.nsec');
    const fromHere = await page.locator('.card.marks').count();
    await page.evaluate(() => { location.hash = '#/s/s1'; }); await page.waitForSelector('.nsec');
    const shared = await page.locator('.card.marks').count();
    check('marks kept here show even when the server sent none; the shared page shows no marks', fromHere === 1 && shared === 0, { fromHere, shared });
    await ctx.close(); }

  { const be = { log: [], posted: [] }; const { ctx, page } = await open(be);
    await page.evaluate(() => { location.hash = '#/lecture/l1'; }); await page.waitForSelector('.nsec');
    check('a lecture without marks has no marks card', await page.locator('.card.marks').count() === 0);
    await ctx.close(); }

  /* ---------- Chinese ---------- */
  { const be = { log: [], posted: [], marks: [{ t: 96, kind: 'lost' }, { t: 400, kind: 'important' }] }; const { ctx, page } = await open(be, { lang: 'zh-Hant' });
    await record(page);
    let row = (await page.innerText('.markrow')).replace(/\s+/g, ' ');
    const hint = row.includes('按一下就好。下課後，你的標記會排在筆記最上方。');
    await page.click('[data-act=mark-important]'); await page.waitForTimeout(300);
    row = (await page.innerText('.markrow')).replace(/\s+/g, ' ');
    const toast = await lastToast(page);
    check('Traditional: the row, the count and the notice', row.includes('標記這一刻') && row.includes('重點') && row.includes('沒聽懂') && hint && row.includes('已標記 1 處，下課後會排在筆記最上方。') && toast === '已標記為重點。', { row, toast });
    await page.click('.live-top button.discard').catch(() => {}); await page.click('#overlay .btn.dark').catch(() => {}); await page.waitForTimeout(300);
    await page.evaluate(() => { location.hash = '#/lecture/l1'; }); await page.waitForSelector('.card.marks');
    let c = await marksCard(page);
    check('Traditional: the marks card', c.includes('你在課上的標記') && c.includes('沒聽懂 The slope of the PPF') && c.includes('重點 This will be on the midterm.') && c.includes('點一下時間，就會從你標記前 15 秒重新播放。'), c);
    await page.evaluate(() => window.__sidenote.setLang('zh-Hans')); await page.waitForTimeout(200);
    c = await marksCard(page);
    check('Simplified: the marks card', c.includes('你在课上的标记') && c.includes('没听懂') && c.includes('重点') && c.includes('点一下时间，就会从你标记前 15 秒重新播放。'), c);
    await ctx.close(); }

  check('no page errors', errs.length === 0, errs);
  await browser.close();
  const n = results.filter(Boolean).length; console.log(`\n${n} of ${results.length} checks passed`); process.exit(n === results.length ? 0 : 1);
})().catch(e => { console.error('SCRIPT ERROR', String(e.message).slice(0, 1200)); process.exit(1); });
