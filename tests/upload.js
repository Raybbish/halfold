// Upload progress and cancelling on the new-lecture page (added after the migration).
// Sample mode: the dialog, the progress bar, finishing, Cancel, Chinese text. Real-backend mode (fake API by request
// interception): what is sent, Cancel while the server is still receiving, a server error, an expired sign-in.
const { chromium, ORIGIN, serve, setConfig } = require('./harness');
const results = [];
const check = (name, ok, detail) => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail !== undefined ? '  -> ' + JSON.stringify(detail) : ''}`); };
const MB = 1048576;
const file = (name, size, mimeType) => ({ name, mimeType, buffer: Buffer.alloc(size, 1) });

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const errs = [];
  const open = async (cfg, route) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    if (cfg) await setConfig(ctx, cfg);
    if (route) await ctx.route('**/*', route);
    const page = await ctx.newPage(); page.on('pageerror', e => errs.push(e.message));
    await page.goto(ORIGIN + '/#/signin'); await page.fill('input[name=code]', 'abc'); await page.click('form.auth button'); await page.waitForSelector('.shell');
    await page.goto(ORIGIN + '/#/new'); await page.waitForSelector('.choice'); await page.click('.choice button:nth-child(2)');
    return { ctx, page };
  };
  // Watch the dialog from inside the page: the highest progress value it showed, and whether it ever showed text.
  const watch = page => page.evaluate(() => { window.__up = { max: 0, texts: [] }; new MutationObserver(() => { const bar = document.querySelector('#overlay [role=progressbar]'); if (bar) { window.__up.max = Math.max(window.__up.max, +bar.getAttribute('aria-valuenow')); const t = document.querySelector('#overlay .box p.num'); if (t) window.__up.texts.push(t.textContent); } }).observe(document.getElementById('overlay'), { subtree: true, childList: true, attributes: true, characterData: true }); });

  console.log('=== sample data ===');
  { const { ctx, page } = await open();
    await page.setInputFiles('#fRec', file('week10.mp3', 2 * MB, 'audio/mpeg'));
    await page.setInputFiles('#fSl', file('slides.pdf', MB / 2, 'application/pdf'));
    await watch(page);
    await page.click('form button.btn.blue');
    await page.waitForSelector('#overlay [role=progressbar]');
    check('pressing Make notes opens the upload dialog with a progress bar and a Cancel button', (await page.locator('#overlay h3').innerText()) === 'Uploading' && (await page.locator('#overlay button:text-is("Cancel upload")').count()) === 1);
    await page.waitForSelector('#overlay h3:text-is("Hal is writing your notes")', { timeout: 10000 });
    const up = await page.evaluate(() => window.__up);
    check('progress runs to 100% over the recording and the slides together', up.max === 100 && up.texts.includes('2.5 MB of 2.5 MB uploaded'), { max: up.max, last: up.texts.slice(-1) });
    await page.waitForSelector('.tabs, .main .card h3', { timeout: 20000 });
    check('then the notes are written and the lecture opens', /#\/lecture\//.test(page.url()), page.url());
    await ctx.close(); }

  { const { ctx, page } = await open();
    const before = await page.evaluate(() => __sidenote.DATA.lectures.length);
    await page.fill('input[maxlength="120"]', 'Week 10 upload');
    await page.setInputFiles('#fRec', file('week10.mp3', 3 * MB, 'audio/mpeg'));
    await page.click('form button.btn.blue'); await page.waitForSelector('#overlay [role=progressbar]'); await page.waitForTimeout(250);
    await page.click('#overlay button:text-is("Cancel upload")'); await page.waitForTimeout(400);
    const state = { dialog: await page.locator('#overlay .modal').count(), toast: await page.locator('.toast').last().innerText(), chip: await page.locator('.filechip b').innerText().catch(() => ''), title: await page.inputValue('input[maxlength="120"]'), lectures: await page.evaluate(() => __sidenote.DATA.lectures.length), button: await page.locator('form button.btn.blue').isDisabled() };
    check('Cancel closes the dialog and says so', state.dialog === 0 && state.toast === 'Upload cancelled.', state);
    check('the lecture created for the upload is deleted again', state.lectures === before, { before, after: state.lectures });
    check('the form keeps the file and the title, and can be sent again', state.chip === 'week10.mp3' && state.title === 'Week 10 upload' && !state.button, state);
    await ctx.close(); }

  { const { ctx, page } = await open();
    await page.selectOption('.lang', 'zh-Hant'); await page.click('.choice button:nth-child(2)').catch(() => {});
    await page.setInputFiles('#fRec', file('week10.mp3', 2 * MB, 'audio/mpeg'));
    await page.click('form button.btn.blue'); await page.waitForSelector('#overlay [role=progressbar]'); await page.waitForTimeout(450);
    const zh = { h3: await page.locator('#overlay h3').innerText(), text: await page.locator('#overlay .box p.num').innerText(), btn: await page.locator('#overlay .box .btn').innerText(), label: await page.getAttribute('#overlay [role=progressbar]', 'aria-label') };
    check('the dialog is in Chinese in the Chinese interface', zh.h3 === '上載中' && /^已上載 [\d.]+ MB／2\.0 MB$/.test(zh.text) && zh.btn === '取消上載' && zh.label === '上載進度', zh);
    await page.click('#overlay .box .btn'); await page.waitForTimeout(300);
    check('and so is the notice after cancelling', (await page.locator('.toast').last().innerText()) === '已取消上載。');
    await ctx.close(); }

  console.log('\n=== real backend (fake API) ===');
  const backend = (be) => async route => {
    const req = route.request(), u = new URL(req.url()), m = req.method(), j = (o, s = 200) => route.fulfill({ status: s, contentType: 'application/json', body: JSON.stringify(o) });
    if (!u.pathname.startsWith('/api/')) return serve(route, { USE_MOCK: false });
    const p = u.pathname.slice(4); be.log.push(m + ' ' + p);
    if (p === '/session') return j({ token: 'tok', user: { name: 'T' } });
    if (p === '/home') return j({ user: { name: 'T' }, courses: [{ id: 'c1', code: 'TEST 1001' }], lectures: [], upcoming: [], settings: { classLanguage: 'en', zhDefault: false } });
    if (m === 'POST' && p === '/lectures') return j({ id: 'l1', course: 'c1', title: 'New', date: 'Today', duration: 0, status: 'processing' });
    if (m === 'POST' && /\/(recording|slides)$/.test(p)) {
      const body = req.postDataBuffer() || Buffer.alloc(0);
      be.uploads.push({ path: p, auth: req.headers()['authorization'] || '', type: req.headers()['content-type'] || '', bytes: body.length, hasFile: body.includes('name="file"'), name: (/filename="([^"]+)"/.exec(body.toString('latin1')) || [])[1] });
      if (be.recording === 'hang') return;   // never answer: the student cancels
      if (be.recording === 413) return j({ message: 'That file is too large for your plan.' }, 413);
      if (be.recording === 401) return j({ message: 'expired' }, 401);
      return route.fulfill({ status: 204 });
    }
    if (m === 'DELETE' && /^\/lectures\/[^/]+$/.test(p)) return route.fulfill({ status: 204 });
    if (/\/finish$/.test(p)) return j({ status: 'processing' });
    if (/\/status$/.test(p)) return j({ status: 'ready' });
    if (/^\/lectures\/[^/]+$/.test(p)) return j({ lecture: { id: 'l1', course: 'c1', title: 'New', date: 'Today', duration: 300, status: 'ready' }, detail: { alerts: [], sections: [], slides: [], transcript: [], flashcards: [], quiz: [] } });
    return j({ message: 'Not found' }, 404);
  };

  { const be = { log: [], uploads: [], recording: 204 }; const { ctx, page } = await open({ USE_MOCK: false }, backend(be));
    await page.setInputFiles('#fRec', file('week10.m4a', 2 * MB, 'audio/mp4')); await page.setInputFiles('#fSl', file('slides.pdf', MB / 4, 'application/pdf'));
    await page.click('form button.btn.blue'); await page.waitForURL(/#\/lecture\/l1$/, { timeout: 20000 });
    const [r, s] = be.uploads;
    check('the recording and the slides are each sent as multipart "file" with the token', !!r && !!s && r.path === '/lectures/l1/recording' && s.path === '/lectures/l1/slides' && r.hasFile && s.hasFile && r.name === 'week10.m4a' && s.name === 'slides.pdf' && r.auth === 'Bearer tok' && /^multipart\/form-data; boundary=/.test(r.type) && r.bytes > 2 * MB, be.uploads);
    check('after the upload the lecture is finished and opened', be.log.includes('POST /lectures/l1/finish') && page.url().endsWith('#/lecture/l1'), be.log);
    await ctx.close(); }

  { const be = { log: [], uploads: [], recording: 'hang' }; const { ctx, page } = await open({ USE_MOCK: false }, backend(be));
    await page.setInputFiles('#fRec', file('week10.m4a', MB, 'audio/mp4'));
    await page.click('form button.btn.blue'); await page.waitForSelector('#overlay [role=progressbar]'); await page.waitForTimeout(500);
    await page.click('#overlay button:text-is("Cancel upload")'); await page.waitForTimeout(600);
    check('Cancel while the server is still receiving: the request is dropped and the lecture deleted', be.log.includes('DELETE /lectures/l1') && !be.log.some(x => /finish/.test(x)) && (await page.locator('.toast').last().innerText()) === 'Upload cancelled.' && (await page.locator('#overlay .modal').count()) === 0, be.log);
    await ctx.close(); }

  { const be = { log: [], uploads: [], recording: 413 }; const { ctx, page } = await open({ USE_MOCK: false }, backend(be));
    await page.setInputFiles('#fRec', file('week10.m4a', MB, 'audio/mp4'));
    await page.click('form button.btn.blue'); await page.waitForSelector('.toast', { timeout: 10000 }); await page.waitForTimeout(200);
    check('a server error shows the server\'s message, closes the dialog and enables the button again', (await page.locator('.toast').last().innerText()) === 'That file is too large for your plan.' && (await page.locator('#overlay .modal').count()) === 0 && !(await page.locator('form button.btn.blue').isDisabled()));
    await ctx.close(); }

  { const be = { log: [], uploads: [], recording: 401 }; const { ctx, page } = await open({ USE_MOCK: false }, backend(be));
    await page.setInputFiles('#fRec', file('week10.m4a', MB, 'audio/mp4'));
    await page.click('form button.btn.blue'); await page.waitForSelector('form.auth', { timeout: 10000 });
    check('an expired sign-in during the upload sends the student to sign in, then back to New lecture', page.url().endsWith('#/signin') && (await page.evaluate(() => __sidenote.S.next)) === '#/new' && (await page.evaluate(() => __sidenote.S.token)) === null);
    await ctx.close(); }

  if (errs.length) check('no page errors', false, errs);
  await browser.close();
  console.log(`\n${results.filter(Boolean).length} of ${results.length} checks passed`);
})().catch(e => { console.error('SCRIPT ERROR', String(e.message).slice(0, 1200)); process.exit(1); });
