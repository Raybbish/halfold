// Uploading a recording in the background (batch 1, item 4). New lecture -> Upload creates the lecture and goes straight
// to its page, which shows the upload (file name, bar, Cancel upload) instead of a locked dialog; every other page shows a
// small "Uploading N%" link at the top. When the file (and the slides) are in, the notes are started without leaving the
// page the student is on: the lecture page switches to "Hal is writing your notes", any other page gets a notice that
// links to the lecture. A failed upload can be sent again from the lecture page (same lecture, same file) or the lecture
// deleted; Cancel upload deletes it. Leaving the page or signing out while the file is going is not allowed to lose it.
// Real-backend mode (fake API by request interception, every request logged): each recording upload answers as the
// scenario says (at once, or held until the script answers it: ok, a server error or a dropped connection).
// The last scenario is the sample build: one bar for the recording and the slides together, then the notes.
const { chromium, ORIGIN, serve, setConfig } = require('./harness');
const results = [];
const check = (name, ok, detail) => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || detail === undefined ? '' : '  -> ' + JSON.stringify(detail)}`); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const KB = 1024, MB = 1048576;
const file = (name, size, mimeType) => ({ name, mimeType, buffer: Buffer.alloc(size, 1) });
const WRITING = '.main h3:text-is("Hal is writing your notes")';
const FAILED = '.main h3:text-is("The upload did not finish")';
const DETAIL = { alerts: [], transcript: [{ t: 0, text: 'line' }], flashcards: [], quiz: [], slides: [], sections: [{ title: 'Part one', start: 0, end: 300, points: [{ t: 30, text: 'A point', off: false, slide: null }] }] };
const SERVER_ERR = 'The server could not store the file.';

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const errs = [];
  // One browser context with its own fake backend, signed in.
  //   be.next      how the next recording uploads answer, in turn: 'ok', 'hold' (wait for be.answer(x)), 'abort'
  //                (connection dropped) or { status, message }; 'ok' once the list is empty
  //   be.answer(x) answers the recording upload being held; set while one is held
  //   be.created   how many lectures were created (POST /lectures)
  const open = async (opts = {}) => {
    const cfg = { USE_MOCK: false, POLL_MS: 50, MAX_UPLOAD_MB: 1 };
    const be = { log: [], posts: [], next: opts.next || [], answer: null, slidesFail: !!opts.slidesFail, created: 0, lectures: [] };
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await setConfig(ctx, cfg);
    // Every notice the page shows, as it appears (they go after a few seconds).
    await ctx.addInitScript(() => { window.__toasts = []; new MutationObserver(ms => ms.forEach(m => m.addedNodes.forEach(n => { if (n.nodeType === 1 && n.classList.contains('toast')) window.__toasts.push({ tag: n.tagName, text: n.textContent, href: n.href || '', bad: n.classList.contains('bad') }); }))).observe(document, { childList: true, subtree: true }); });
    await ctx.route('**/*', async route => {
      const req = route.request(), u = new URL(req.url()), m = req.method(), j = (o, s = 200) => route.fulfill({ status: s, contentType: 'application/json', body: JSON.stringify(o) }).catch(() => {});
      if (!u.pathname.startsWith('/api/')) return serve(route, cfg);
      const p = u.pathname.slice(4); be.log.push(m + ' ' + p);
      const l = be.lectures.find(x => x.id === 'lnew');
      let mm;
      if (p === '/session') return j({ token: 'tok', user: { name: 'T' } });
      if (p === '/home') return j({ user: { name: 'T' }, courses: [{ id: 'c1', code: 'TEST 1001' }], lectures: be.lectures, upcoming: [], settings: { classLanguage: 'en', zhDefault: false } });
      if (m === 'POST' && p === '/lectures') { be.created++; const n = { id: 'lnew', course: 'c1', title: 'Untitled lecture', date: 'Today', duration: 0, status: 'recording', source: 'upload' }; be.lectures.unshift(n); return j(n); }
      if (m === 'POST' && (mm = /^\/lectures\/lnew\/(recording|slides)$/.exec(p))) {
        const body = req.postDataBuffer() || Buffer.alloc(0), h = req.headers();
        be.posts.push({ path: p, auth: h['authorization'] || '', type: h['content-type'] || '', size: body.length, hasFile: body.includes('name="file"'), name: (/filename="([^"]+)"/.exec(body.toString('latin1')) || [])[1] });
        if (mm[1] === 'slides') return be.slidesFail ? j({ message: 'The PDF could not be read.' }, 500) : route.fulfill({ status: 204 }).catch(() => {});
        let r = be.next.length ? be.next.shift() : 'ok';
        if (r === 'hold') r = await new Promise(res => { be.answer = x => { be.answer = null; res(x); }; });
        if (r === 'abort') return route.abort('connectionreset').catch(() => {});
        if (r === 'ok') return route.fulfill({ status: 204 }).catch(() => {});
        return j({ message: r.message }, r.status);
      }
      if (m === 'POST' && p === '/lectures/lnew/finish') { if (l) l.status = 'processing'; return j({ status: 'processing' }); }
      if (m === 'GET' && p === '/lectures/lnew/status') return l ? j({ status: l.status }) : j({ message: 'This lecture does not exist.' }, 404);
      if (m === 'GET' && p === '/lectures/lnew') return l ? j({ lecture: l, detail: l.status === 'ready' ? DETAIL : null }) : j({ message: 'This lecture does not exist.' }, 404);
      if (m === 'DELETE' && p === '/lectures/lnew') { be.lectures = be.lectures.filter(x => x.id !== 'lnew'); return route.fulfill({ status: 204 }).catch(() => {}); }
      return j({ message: 'Not found' }, 404);
    });
    const page = await ctx.newPage(); page.on('pageerror', e => errs.push(e.message));
    await signIn(page);
    return { ctx, page, be };
  };
  const signIn = async page => { await page.goto(ORIGIN + '/#/signin'); await page.fill('input[name=code]', 'abc'); await page.click('form.auth button'); await page.waitForSelector('.shell'); };
  const until = async (fn, ms = 5000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await sleep(50); } return false; };
  // Moves within the page (a hash change, never a reload: a reload would lose the file being uploaded).
  const go = async (page, h, sel = '.shell') => { await page.evaluate(h => { location.hash = h; }, h); await page.waitForSelector(sel, { timeout: 5000 }).catch(() => {}); await sleep(250); };
  // New lecture -> Upload, with a recording (and slides), then Make notes.
  const startUpload = async (page, slides) => {
    await go(page, '#/new', '.choice'); await page.click('.choice button:nth-child(2)');
    await page.setInputFiles('#fRec', file('week9.m4a', 300 * KB, 'audio/mp4'));
    if (slides) await page.setInputFiles('#fSl', file('slides.pdf', 50 * KB, 'application/pdf'));
    await page.click('form button.btn.blue');
  };
  const toasts = page => page.evaluate(() => window.__toasts);
  const modals = page => page.locator('#overlay .modal').count();
  const card = async page => ({ h3: await page.locator('.main .card h3').first().innerText(), text: (await page.locator('.main .card').first().innerText()).replace(/\s+/g, ' '),
    btns: (await page.locator('.main .card .btn').allInnerTexts()).join('|') });
  const pill = page => page.evaluate(() => { const a = document.querySelector('.main .pill-rec.up, .main .pill-rec.bad'); return a ? { text: a.textContent.replace(/\s+/g, ' ').trim(), href: a.getAttribute('href'), bad: a.classList.contains('bad'), shown: !!a.offsetParent } : { text: '', href: '' }; });
  // The status tag of the lecture's row in a list (the last one: a course row starts with its week).
  const tagOf = (page, sel) => page.evaluate(sel => { const a = document.querySelector(sel + ' a[href="#/lecture/lnew"]'); const t = a && [...a.closest('li').querySelectorAll('.tag')].pop(); return t ? t.textContent : ''; }, sel);
  const leaveAsks = page => page.evaluate(() => { const e = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(e); return e.defaultPrevented; });

  console.log('=== uploading in the background, staying on the lecture page ===');
  { const { ctx, page, be } = await open({ next: ['hold'] });
    // Refused on the form, before anything is created (MAX_UPLOAD_MB is 1 here).
    await go(page, '#/new', '.choice'); await page.click('.choice button:nth-child(2)');
    await page.setInputFiles('#fRec', file('big.m4a', 2 * MB, 'audio/mp4'));
    await page.setInputFiles('#fSl', file('slides.pptx', 1000, 'application/vnd.openxmlformats-officedocument.presentationml.presentation'));
    const refused = { toasts: (await toasts(page)).map(x => x.text), chips: await page.locator('.filechip').count() };
    const refusedBoth = refused.toasts.includes('That file is larger than 1 MB.') && refused.toasts.includes('Slides need to be a PDF.') && refused.chips === 0;
    check('a file over MAX_UPLOAD_MB and a non-PDF slide deck are still refused before anything is created', refusedBoth && be.created === 0, { refused, created: be.created });

    await startUpload(page, true);
    await page.waitForURL(/#\/lecture\/lnew$/, { timeout: 5000 }).catch(() => {});
    await page.waitForSelector('.main .card h3', { timeout: 5000 }).catch(() => {});
    const url = page.url(), h3 = await page.locator('.main .card h3').first().innerText().catch(() => ''), name = await page.locator('.main .card p[data-notr]').first().innerText().catch(() => '');
    const hasCancel = (await page.locator('.main .card button:text-is("Cancel upload")').count()) === 1 && (await page.locator('.main .card .bar').count()) === 1;
    check('choosing Upload opens the lecture page at once with the file name, a bar and Cancel upload', url.endsWith('#/lecture/lnew') && h3 === 'Uploading the recording' && name === 'week9.m4a' && hasCancel, { url, h3, name, hasCancel });
    const modal = await modals(page);
    check('no locked dialog while uploading', !modal, { modal });
    await until(() => be.answer);
    const beforeUnloadPrevented = await leaveAsks(page);

    await go(page, '#/home', '#lecList');
    const p1 = await pill(page), tagHome = await tagOf(page, '#lecList');
    check('other pages show "Uploading N%" at the top, linking to the lecture', /^Uploading \d+%$/.test(p1.text) && p1.href.endsWith('#/lecture/lnew') && p1.shown, p1);
    await page.setViewportSize({ width: 390, height: 800 }); await sleep(150);
    const phone = await pill(page), sideways = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    await page.setViewportSize({ width: 1280, height: 800 });
    check('phones show it too (the recording link is hidden there), without sideways scrolling', phone.shown && /^Uploading \d+%$/.test(phone.text) && !sideways, { phone, sideways });
    await go(page, '#/course/c1', '.card .list');
    const tagCourse = await tagOf(page, '.card .list'), tag = tagHome === tagCourse ? tagHome : 'home ' + tagHome + ', course ' + tagCourse;
    check('home and course lists tag the uploading lecture "Uploading"', tag === 'Uploading', { tagHome, tagCourse });

    await go(page, '#/settings', 'button:text-is("Sign out")');
    await page.click('button:text-is("Sign out")'); await sleep(200);
    const toastText = ((await toasts(page)).pop() || {}).text || '', stillSignedIn = (await page.evaluate(() => S.token)) === 'tok' && page.url().endsWith('#/settings');
    check('signing out while uploading is refused', /Wait for the upload to finish or cancel it/.test(toastText) && stillSignedIn, { toastText, stillSignedIn });

    await go(page, '#/new', '.choice'); await page.click('.choice button:nth-child(2)');
    await page.setInputFiles('#fRec', file('week10.m4a', 200 * KB, 'audio/mp4')); await page.click('form button.btn.blue'); await sleep(250);
    const errText = await page.locator('form .err').innerText().catch(() => '');
    check('a second upload while one runs is refused on New lecture', /Another upload is still running/.test(errText) && be.created === 1, { errText, created: be.created });

    await go(page, '#/lecture/lnew', '.main .card h3');
    be.answer('ok');
    await page.waitForSelector(WRITING, { timeout: 5000 }).catch(() => {});
    const order = be.log.filter(x => /^POST \/lectures\/lnew\//.test(x)), h3After = await page.locator('.main .card h3').first().innerText();
    check('the recording, then the slides, then /finish', JSON.stringify(order) === '["POST /lectures/lnew/recording","POST /lectures/lnew/slides","POST /lectures/lnew/finish"]', order);
    const [r, s] = be.posts;
    check('the recording and the slides are each sent as multipart "file" with the token', !!r && !!s && r.path === '/lectures/lnew/recording' && s.path === '/lectures/lnew/slides' && r.hasFile && s.hasFile && r.name === 'week9.m4a' && s.name === 'slides.pdf' && r.auth === 'Bearer tok' && /^multipart\/form-data; boundary=/.test(r.type) && r.size > 300 * KB, be.posts);
    check('when it is done the page shows "Hal is writing your notes"', h3After === 'Hal is writing your notes' && page.url().endsWith('#/lecture/lnew') && !(await modals(page)), { h3After, url: page.url() });
    const leaveAfter = await leaveAsks(page);
    check('leaving the page while uploading asks first', beforeUnloadPrevented && !leaveAfter, { beforeUnloadPrevented, leaveAfter });
    be.lectures[0].status = 'ready';
    const written = await page.waitForSelector('.tabs', { timeout: 5000 }).then(() => true, () => false);
    check('then the notes are written and the lecture page shows them', written && (await page.locator('.nsec').count()) > 0 && page.url().endsWith('#/lecture/lnew'), { written, log: be.log.slice(-4) });
    await ctx.close(); }

  console.log('\n=== the upload finishes while the student is on another page ===');
  { const { ctx, page, be } = await open({ next: ['hold'], slidesFail: true });
    await startUpload(page, true); await page.waitForSelector('.main .card h3'); await until(() => be.answer);
    await go(page, '#/home', '#lecList');
    be.answer('ok');
    await until(async () => (await toasts(page)).some(x => /Upload finished/.test(x.text)));
    const all = await toasts(page), done = all.find(x => /Upload finished/.test(x.text)) || {};
    check('finished on another page: a notice "Upload finished. The notes are being written." links to the lecture, and the page stays', done.tag === 'A' && done.href.endsWith('#/lecture/lnew') && /^Upload finished\. The notes are being written\.\s+Open$/.test(done.text) && !done.bad && page.url().endsWith('#/home') && be.log.includes('POST /lectures/lnew/finish'), { all, url: page.url() });
    check('slides that do not upload: "Slides did not upload. You can add them later." and the notes are still started', all.some(x => x.text === 'Slides did not upload. You can add them later.') && be.log.includes('POST /lectures/lnew/finish'), { all, log: be.log.filter(x => /lnew/.test(x)) });
    await ctx.close(); }

  console.log('\n=== a failed upload, sent again ===');
  { const { ctx, page, be } = await open({ next: [{ status: 500, message: SERVER_ERR }, 'ok'] });
    await startUpload(page, false);
    await page.waitForSelector(FAILED, { timeout: 5000 }).catch(() => {});
    const f = await card(page), reason = await page.locator('.main .card [data-notr]').allInnerTexts();
    check('a failed upload shows the reason, Send it again and Delete this lecture', f.h3 === 'The upload did not finish' && reason.includes(SERVER_ERR) && /Send it again/.test(f.btns) && /Delete this lecture/.test(f.btns), { f, reason });
    await page.click('.main button:text-is("Send it again")');
    await page.waitForSelector(WRITING, { timeout: 5000 }).catch(() => {});
    const firstSize = be.posts[0] && be.posts[0].size, resent = be.posts[1] || {};
    check('Send it again posts the same file to the same lecture', resent.size === firstSize && resent.name === 'week9.m4a' && resent.path === '/lectures/lnew/recording' && be.created === 1 && (await page.locator(WRITING).count()) === 1 && be.log.includes('POST /lectures/lnew/finish'), { posts: be.posts, created: be.created });
    await ctx.close(); }

  console.log('\n=== a failed upload while the student is elsewhere ===');
  { const { ctx, page, be } = await open({ next: ['hold'] });
    await startUpload(page, false); await page.waitForSelector('.main .card h3'); await until(() => be.answer);
    await go(page, '#/home', '#lecList');
    be.answer('abort');
    await page.waitForSelector('.main .pill-rec.bad', { timeout: 5000 }).catch(() => {});
    const p2 = await pill(page), pillBad = p2.bad && p2.text === 'The upload did not finish. Open' && p2.href.endsWith('#/lecture/lnew') && p2.shown;
    check('elsewhere a failed upload is a red pill "The upload did not finish. Open"', pillBad, p2);
    const bad = (await toasts(page)).find(x => /The upload did not finish/.test(x.text)) || {};
    await page.click('.main .pill-rec.bad'); await page.waitForSelector(FAILED, { timeout: 5000 }).catch(() => {});
    const f = await card(page);
    check('and a red notice links to the lecture, where the lost connection is explained', bad.bad && bad.tag === 'A' && bad.href.endsWith('#/lecture/lnew') && /^The upload did not finish\.\s+Open$/.test(bad.text) && f.text.includes('The connection was lost before the upload finished.'), { bad, f });
    await page.click('.main button:text-is("Delete this lecture")'); await page.waitForURL(/#\/home$/, { timeout: 5000 }).catch(() => {}); await sleep(300);
    const del = { pill: (await pill(page)).text, links: await page.locator('.main a[href="#/lecture/lnew"]').count(), log: be.log.slice(-4), url: page.url() };
    check('Delete this lecture deletes it and leaves no pill', be.log.includes('DELETE /lectures/lnew') && page.url().endsWith('#/home') && !del.pill && del.links === 0, del);
    await ctx.close(); }

  console.log('\n=== Cancel upload ===');
  { const { ctx, page, be } = await open({ next: ['hold'] });
    await startUpload(page, false); await page.waitForSelector('.main .card h3'); await until(() => be.answer);
    await page.click('.main button:text-is("Cancel upload")');
    await page.waitForURL(/#\/home$/, { timeout: 5000 }).catch(() => {}); await page.waitForSelector('#lecList', { timeout: 5000 }).catch(() => {});
    const toastText = ((await toasts(page)).pop() || {}).text || '';
    if (be.answer) be.answer('ok');   // the request was dropped by the browser; answering it late must change nothing
    await sleep(400);
    const gone = !(await pill(page)).text && (await page.locator('.main a[href="#/lecture/lnew"]').count()) === 0 && !be.log.includes('POST /lectures/lnew/finish');
    check('Cancel upload deletes the lecture, says "Upload cancelled. Nothing was kept." and goes home', be.log.includes('DELETE /lectures/lnew') && /Nothing was kept/.test(toastText) && page.url().endsWith('#/home') && gone, { toastText, url: page.url(), gone, log: be.log.filter(x => /lnew/.test(x)) });
    await ctx.close(); }

  console.log('\n=== the sign-in runs out during the upload ===');
  { const { ctx, page, be } = await open({ next: [{ status: 401, message: 'expired' }, 'ok'] });
    await startUpload(page, false);
    await page.waitForSelector('form.auth', { timeout: 5000 }).catch(() => {});
    const out = { url: page.url(), next: await page.evaluate(() => S.next), token: await page.evaluate(() => S.token) };
    await page.fill('input[name=code]', 'abc'); await page.click('form.auth button');
    await page.waitForSelector(FAILED, { timeout: 5000 }).catch(() => {});
    const f = await card(page).catch(() => ({}));
    await page.click('.main button:text-is("Send it again")').catch(() => {}); await page.waitForSelector(WRITING, { timeout: 5000 }).catch(() => {});
    check('an expired sign-in during the upload sends the student to sign in, then back to the lecture to send it again', out.url.endsWith('#/signin') && out.next === '#/lecture/lnew' && out.token === null && page.url().endsWith('#/lecture/lnew') && f.text.includes('Please sign in again.') && be.posts.length === 2 && be.created === 1 && (await page.locator(WRITING).count()) === 1, { out, f, posts: be.posts.length });
    await ctx.close(); }

  console.log('\n=== Chinese ===');
  { const { ctx, page, be } = await open({ next: ['hold'] });
    await page.evaluate(() => window.__sidenote.setLang('zh-Hant'));
    await startUpload(page, false); await page.waitForSelector('.main .card h3'); await until(() => be.answer);
    const zh = { card: await card(page), name: await page.locator('.main .card p[data-notr]').first().innerText() };
    await go(page, '#/home', '#lecList'); zh.pill = (await pill(page)).text; zh.tag = await tagOf(page, '#lecList');
    await go(page, '#/lecture/lnew', '.main .card h3'); be.answer({ status: 500, message: SERVER_ERR });
    await page.waitForSelector('.main h3:text-is("上載沒有完成")', { timeout: 5000 }).catch(() => {});
    zh.failed = await card(page);
    check('in Chinese the upload card, the pill, the list tag and the failed card are translated (the file name and the server\'s reason are not)',
      zh.card.h3 === '正在上載錄音' && zh.card.text.includes('上載完成前請不要關閉這個分頁') && zh.card.btns === '取消上載' && zh.name === 'week9.m4a' && /^上載中 \d+%$/.test(zh.pill) && zh.tag === '上載中'
      && zh.failed.h3 === '上載沒有完成' && zh.failed.text.includes('檔案仍然選取著') && zh.failed.text.includes(SERVER_ERR) && zh.failed.btns === '再傳一次|刪除這堂課', zh);
    await ctx.close(); }

  console.log('\n=== sample data ===');
  { const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage(); page.on('pageerror', e => errs.push(e.message));
    await signIn(page);
    await go(page, '#/new', '.choice'); await page.click('.choice button:nth-child(2)');
    await page.setInputFiles('#fRec', file('week10.mp3', 2 * MB, 'audio/mpeg')); await page.setInputFiles('#fSl', file('slides.pdf', MB / 2, 'application/pdf'));
    await page.evaluate(() => { window.__pcts = []; new MutationObserver(() => { const e = document.querySelector('.main .upPct'); if (!e) return; const v = parseInt(e.textContent, 10), a = window.__pcts; if (a[a.length - 1] !== v) a.push(v); }).observe(document.body, { subtree: true, childList: true, characterData: true }); });
    await page.click('form button.btn.blue');
    const written = await page.waitForSelector('.tabs', { timeout: 20000 }).then(() => true, () => false);
    const pcts = await page.evaluate(() => window.__pcts), rising = pcts.every((v, i) => !i || v >= pcts[i - 1]);
    check('one bar for the recording and the slides: it climbs to 100% without going back, then the notes are written', written && rising && pcts[pcts.length - 1] === 100 && pcts.some(v => v > 0 && v < 80) && pcts.some(v => v > 80 && v < 100) && /#\/lecture\//.test(page.url()), { pcts, written, url: page.url() });
    await ctx.close(); }

  check('no page errors', errs.length === 0, errs);
  await browser.close();
  console.log(`\n${results.filter(Boolean).length} of ${results.length} checks passed`);
})().catch(e => { console.error('SCRIPT ERROR', String(e.message).slice(0, 1200)); process.exit(1); });
