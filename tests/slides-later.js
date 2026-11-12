// Adding slides to a lecture after its notes were made (added after the migration).
// Sample mode: a lecture made without slides, the two ways in (More menu, the line under the notes), the upload and the
// wait, the student's own note kept, Cancel keeping the lecture, a file that is not a PDF, lectures that already have
// slides, Chinese. Real-backend mode (fake API by request interception): what is sent and polled, adding that fails,
// a server error, still processing when the wait runs out.
const { chromium, ORIGIN, serve, setConfig } = require('./harness');
const results = [];
const check = (name, ok, detail) => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || detail === undefined ? '' : '  -> ' + JSON.stringify(detail)}`); };
const MB = 1048576;
const pdf = (size = MB) => ({ name: 'week10-slides.pdf', mimeType: 'application/pdf', buffer: Buffer.alloc(size, 1) });

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const errs = [];
  const open = async (cfg, route) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    if (cfg) await setConfig(ctx, cfg);
    if (route) await ctx.route('**/*', route);
    const page = await ctx.newPage(); page.on('pageerror', e => errs.push(e.message));
    await page.goto(ORIGIN + '/#/signin'); await page.fill('input[name=code]', 'abc'); await page.click('form.auth button'); await page.waitForSelector('.shell');
    return { ctx, page };
  };
  const clearToasts = page => page.evaluate(() => document.querySelectorAll('.toast').forEach(t => t.remove()));
  const toast = async (page, timeout = 15000) => { await page.waitForSelector('.toast', { timeout }); return page.locator('.toast').last().innerText(); };
  const noModal = async page => (await page.locator('#overlay .modal').count()) === 0;
  const tabs = page => page.locator('.tabs button').allInnerTexts();
  const hint = page => page.locator('.main p:has(button.ts:text-is("Add slides"))').count();
  // Choose a file in the picker that Add slides opens (from the More menu or from the line under the notes).
  const viaMore = async (page, file) => { await clearToasts(page); await page.click('.page-h button:text-is("More")'); const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.click('#overlay button:text-is("Add slides")')]); await fc.setFiles(file); };
  const viaHint = async (page, file) => { await clearToasts(page); const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.click('.main button.ts:text-is("Add slides")')]); await fc.setFiles(file); };

  console.log('=== sample data ===');
  { const { ctx, page } = await open();
    // A lecture made from an uploaded recording, without slides
    await page.goto(ORIGIN + '/#/new'); await page.waitForSelector('.choice'); await page.click('.choice button:nth-child(2)');
    await page.setInputFiles('#fRec', { name: 'week10.mp3', mimeType: 'audio/mpeg', buffer: Buffer.alloc(MB, 1) });
    await page.click('form button.btn.blue'); await page.waitForSelector('.tabs', { timeout: 20000 }); await page.waitForTimeout(300);
    const id = decodeURIComponent(page.url().split('#/lecture/')[1]);
    const before = { tabs: await tabs(page), tags: await page.locator('.nsec h3 .tag').count(), hint: await hint(page) };
    await page.click('.page-h button:text-is("More")'); before.more = await page.locator('#overlay button:text-is("Add slides")').count(); await page.keyboard.press('Escape');
    check('notes made without slides: no Slides tab, no slide labels, and Add slides under the notes and in More', !before.tabs.includes('Slides') && before.tags === 0 && before.hint === 1 && before.more === 1, before);

    // The student's own note, to see that it stays
    await page.click('.tools label:has-text("Edit notes") input'); await page.click('.nsec >> nth=0 >> button:text-is("Add a note")');
    await page.fill('#overlay textarea[name=t]', 'My own point about week 10'); await page.click('#overlay button:text-is("Save note")'); await page.waitForTimeout(300);
    await page.click('.tools label:has-text("Edit notes") input');

    // Not a PDF
    await viaMore(page, { name: 'slides.pptx', mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', buffer: Buffer.alloc(1000, 1) });
    const t0 = await toast(page);
    check('a file that is not a PDF is refused before anything is sent', t0 === 'Slides need to be a PDF.' && await noModal(page) && !(await tabs(page)).includes('Slides'), t0);

    // Cancel: the lecture and its notes stay
    // The sample upload of slides takes 0.3 s, so Cancel is pressed from inside the page as soon as the dialog shows it.
    await page.evaluate(() => { window.__cancelled = false; const o = new MutationObserver(() => { const b = [...document.querySelectorAll('#overlay button')].find(x => x.textContent === 'Cancel upload'); if (b && document.querySelector('#overlay [role=progressbar]')) { o.disconnect(); window.__cancelled = true; b.click(); } }); o.observe(document.getElementById('overlay'), { subtree: true, childList: true }); });
    await viaHint(page, pdf(4 * MB));
    const t1 = await toast(page);
    const kept = await page.evaluate(id => window.__sidenote.S.lectures.some(l => l.id === id), id);
    check('Cancel while uploading stops it and keeps the lecture and its notes', (await page.evaluate(() => window.__cancelled)) && t1 === 'Upload cancelled.' && await noModal(page) && kept && page.url().endsWith('#/lecture/' + encodeURIComponent(id)) && (await page.locator('.nsec').count()) > 0, { t1, kept });

    // Add slides from More
    await page.evaluate(() => { window.__seen = []; new MutationObserver(() => { const h = document.querySelector('#overlay h3'); if (h && !window.__seen.includes(h.textContent)) window.__seen.push(h.textContent); }).observe(document.getElementById('overlay'), { subtree: true, childList: true, characterData: true }); });
    await viaMore(page, pdf());
    const t2 = await toast(page);
    const seen = await page.evaluate(() => window.__seen);
    check('adding slides shows the upload, then the wait while Sid files the notes', seen.includes('Uploading') && seen.includes('Sid is putting the notes under the slides'), seen);
    const after = { toast: t2, tabs: await tabs(page), tags: await page.locator('.nsec h3 .tag').count(), hint: await hint(page), mine: (await page.locator('.nsec').first().innerText()).includes('My own point about week 10') };
    check('then the notes are under the slides: Slides tab, slide labels, no more Add slides', after.toast === 'Slides added' && after.tabs.includes('Slides') && after.tags > 0 && after.hint === 0 && await noModal(page), after);
    check('the note the student added is still there', after.mine);
    await page.click('.page-h button:text-is("More")');
    check('a lecture with slides has no Add slides in More', (await page.locator('#overlay button:text-is("Add slides")').count()) === 0); await page.keyboard.press('Escape');

    // The sample lecture that has had slides all along
    await page.goto(ORIGIN + '/#/lecture/econ-w9'); await page.waitForSelector('.nsec');
    check('the sample lecture with slides shows no Add slides line', (await hint(page)) === 0);

    // Chinese
    await page.goto(ORIGIN + '/#/new'); await page.waitForSelector('.choice'); await page.click('.choice button:nth-child(2)');
    await page.setInputFiles('#fRec', { name: 'week11.mp3', mimeType: 'audio/mpeg', buffer: Buffer.alloc(MB, 1) });
    await page.click('form button.btn.blue'); await page.waitForSelector('.tabs', { timeout: 20000 }); await page.waitForTimeout(300);
    await page.evaluate(() => window.__sidenote.setLang('zh'));
    const zhLine = await page.locator('.main p:has(button.ts)').filter({ hasText: '簡報' }).innerText();
    await page.evaluate(() => { window.__seen = []; });
    await clearToasts(page); const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.click('.main button.ts:text-is("加入簡報")')]); await fc.setFiles(pdf());
    const zt = await toast(page); const zseen = await page.evaluate(() => window.__seen);
    check('in Chinese: the line under the notes, the wait and the result', zhLine === '這堂課還沒有簡報。 加入簡報' && zseen.includes('Sid 正在把筆記放到簡報下') && zt === '已加入簡報', { zhLine, zseen, zt });
    await ctx.close(); }

  console.log('\n=== real backend (fake API) ===');
  const SLIDES = [{ n: 1, title: 'Opportunity cost' }, { n: 2, title: 'Trade' }];
  const detail = withSlides => ({ alerts: [], transcript: [{ t: 0, text: 'line' }], flashcards: [], quiz: [], slides: withSlides ? SLIDES : [],
    sections: [{ title: 'Part one', ...(withSlides ? { slides: 'Slides 1 to 2' } : {}), start: 0, end: 300, points: [{ t: 30, text: 'A point', off: false, slide: withSlides ? 1 : null }, { t: null, text: 'Mine', mine: true, off: false, slide: null }] }] });
  const backend = be => async route => {
    const req = route.request(), u = new URL(req.url()), m = req.method(), j = (o, s = 200) => route.fulfill({ status: s, contentType: 'application/json', body: JSON.stringify(o) });
    if (!u.pathname.startsWith('/api/')) return serve(route, { USE_MOCK: false, POLL_MS: be.pollMs || 50 });
    const p = u.pathname.slice(4); be.log.push(m + ' ' + p);
    if (p === '/session') return j({ token: 'tok', user: { name: 'T' } });
    const lec = { id: 'l1', course: 'c1', title: 'Week 1', date: 'Today', duration: 300, status: 'ready' };
    if (p === '/home') return j({ user: { name: 'T' }, courses: [{ id: 'c1', code: 'TEST 1001' }], lectures: [lec], upcoming: [], settings: { classLanguage: 'en', zhDefault: false } });
    if (m === 'POST' && p === '/lectures/l1/slides') {
      const body = req.postDataBuffer() || Buffer.alloc(0);
      be.upload = { auth: req.headers()['authorization'] || '', type: req.headers()['content-type'] || '', hasFile: body.includes('name="file"'), name: (/filename="([^"]+)"/.exec(body.toString('latin1')) || [])[1] };
      if (be.uploadFails) return j({ message: 'That PDF is too large for your plan.' }, 413);
      be.polls = 0; return route.fulfill({ status: 204 });
    }
    if (p === '/lectures/l1/status') { be.polls++; return j({ status: be.forever || be.polls < 3 ? 'processing' : 'ready' }); }
    if (m === 'GET' && p === '/lectures/l1') return j({ lecture: lec, detail: detail(be.upload && !be.uploadFails && !be.filingFails) });
    return j({ message: 'Not found' }, 404);
  };
  const realOpen = async be => { const r = await open({ USE_MOCK: false, POLL_MS: be.pollMs || 50 }, backend(be)); await r.page.goto(ORIGIN + '/#/lecture/l1'); await r.page.waitForSelector('.nsec'); return r; };

  { const be = { log: [] }; const { ctx, page } = await realOpen(be);
    await viaMore(page, pdf(MB / 2)); const t = await toast(page);
    const u = be.upload || {};
    check('sends the PDF as multipart "file" to POST /lectures/:id/slides with the token', u.hasFile && u.name === 'week10-slides.pdf' && u.auth === 'Bearer tok' && /^multipart\/form-data; boundary=/.test(u.type), u);
    const after = be.log.slice(be.log.indexOf('POST /lectures/l1/slides'));
    check('then polls the status until ready, reads the lecture again and shows the Slides tab', after.filter(x => x === 'GET /lectures/l1/status').length === 3 && after[after.length - 1] === 'GET /lectures/l1' && t === 'Slides added' && (await tabs(page)).includes('Slides'), { after, t });
    await ctx.close(); }

  { const be = { log: [], filingFails: true }; const { ctx, page } = await realOpen(be);
    await viaMore(page, pdf(MB / 2)); const t = await toast(page);
    check('if the lecture still has no slides afterwards, says so and keeps the notes', t === 'The slides could not be added. The notes are as they were.' && !(await tabs(page)).includes('Slides') && (await page.locator('.nsec').count()) === 1 && await noModal(page), t);
    await ctx.close(); }

  { const be = { log: [], uploadFails: true }; const { ctx, page } = await realOpen(be);
    await viaMore(page, pdf(MB / 2)); const t = await toast(page);
    check('a server error shows the server\'s message and leaves the lecture as it was', t === 'That PDF is too large for your plan.' && await noModal(page) && (await page.locator('.nsec').count()) === 1 && !be.log.some(x => /status$/.test(x)), t);
    await ctx.close(); }

  { const be = { log: [], forever: true, pollMs: 5 }; const { ctx, page } = await realOpen(be);
    await viaMore(page, pdf(MB / 2)); const t = await toast(page, 30000);
    check('still processing when the wait runs out: says it is still working', t === 'Still working. The notes will be under the slides when ready.' && await noModal(page), t);
    await ctx.close(); }

  check('no page errors', errs.length === 0, errs);
  await browser.close();
  console.log(`\n${results.filter(Boolean).length} of ${results.length} checks passed`);
})().catch(e => { console.error('SCRIPT ERROR', String(e.message).slice(0, 1200)); process.exit(1); });
