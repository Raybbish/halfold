// Study packs made from a slide deck alone, with no recording (the draft of 2026-11-24).
// Sample mode: the Slides only choice on New lecture, the links to it on Home, on the landing page and in the limit
// window, making a pack, the pack page (no times, no timeline, no transcript, "Slide N" on each point, the offer to add
// a recording), its "Slides" tag in the lists, adding a recording to it, Chinese. Real-backend mode (fake API by request
// interception): what is sent, the waiting and failed states, Try again, a PDF the server refuses, a lecture never
// finished, adding a recording (the notes are then written again) and the month's limit.
const { chromium, ORIGIN, serve, setConfig } = require('./harness');
const results = [];
const check = (name, ok, detail) => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || detail === undefined ? '' : '  -> ' + JSON.stringify(detail)}`); };
const KB = 1024;
const pdf = (size = 200 * KB) => ({ name: 'week10-slides.pdf', mimeType: 'application/pdf', buffer: Buffer.alloc(size, 1) });
const mp3 = () => ({ name: 'week10.mp3', mimeType: 'audio/mpeg', buffer: Buffer.alloc(300 * KB, 1) });
const norm = s => (s || '').replace(/\s+/g, ' ').trim();

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const errs = [];
  const open = async (cfg, route, viewport = { width: 1280, height: 800 }) => {
    const ctx = await browser.newContext({ viewport });
    if (cfg) await setConfig(ctx, cfg);
    if (route) await ctx.route('**/*', route);
    const page = await ctx.newPage(); page.on('pageerror', e => errs.push(e.message));
    await page.goto(ORIGIN + '/#/signin'); await page.fill('input[name=code]', 'abc'); await page.click('form.auth button'); await page.waitForSelector('.shell');
    return { ctx, page };
  };
  const tabs = page => page.locator('.tabs button').allInnerTexts();
  const choose = page => page.click('.choice button[data-act=mode-slides]');
  const waitText = (page, text, timeout = 15000) => page.waitForFunction(x => document.querySelector('.main') && document.querySelector('.main').innerText.includes(x), text, { timeout });

  console.log('=== sample data ===');
  { const { ctx, page } = await open();
    await page.goto(ORIGIN + '/#/new'); await page.waitForSelector('.choice');
    const last = await page.locator('.choice button').last().getAttribute('data-act');
    await choose(page);
    const form = { last, on: await page.locator('.choice button[data-act=mode-slides]').getAttribute('aria-checked'), label: await page.locator('form .field > span').nth(2).innerText().catch(() => ''),
      lang: await page.locator('form select').count(), button: await page.locator('form button.btn.blue').innerText(), note: norm(await page.locator('form p.small.muted').first().innerText()),
      text: norm(await page.locator('.choice button[data-act=mode-slides]').innerText()) };
    check('New lecture: Slides only is the last choice; it asks for the slide deck, not the class language, and says it does not use recording time',
      form.last === 'mode-slides' && form.on === 'true' && form.label === 'Slide deck' && form.lang === 1 && form.button === 'Make the study pack'
      && form.note === 'No recording is needed, and this does not use your recording time. You can add a recording of the class to it later.'
      && form.text === 'Slides only, no recording A study pack from the slide deck: explanations, key points, flashcards and a quiz.', form);

    const before = await page.evaluate(() => window.__sidenote.S.lectures.length);
    await page.click('form button.btn.blue'); await page.waitForTimeout(200);
    const err = await page.locator('form .err').innerText().catch(() => '');
    await page.setInputFiles('#fSl', { name: 'slides.pptx', mimeType: 'application/vnd.ms-powerpoint', buffer: Buffer.alloc(1000, 1) });
    const notPdf = await page.locator('.toast').last().innerText().catch(() => '');
    check('without a PDF it says so and makes nothing; a file that is not a PDF is refused', err === 'Choose the slide deck to read.' && notPdf === 'Slides need to be a PDF.'
      && before === await page.evaluate(() => window.__sidenote.S.lectures.length), { err, notPdf });

    await page.setInputFiles('#fSl', pdf());
    await page.click('form button.btn.blue');
    await waitText(page, 'Hal is reading your slides');
    const wait = norm(await page.locator('.main .card.wait').innerText());
    check('making the pack goes to its page: "Hal is reading your slides"', /#\/lecture\//.test(page.url()) && wait.includes('Explanations, key points, flashcards and a quiz, slide by slide. This usually takes about a minute.'), wait);
    await page.waitForSelector('.nsec', { timeout: 20000 });
    const id = decodeURIComponent(page.url().split('#/lecture/')[1]);
    const pack = { tabs: await tabs(page), tl: await page.locator('.tl').count(), off: await page.locator('.main .tag.sn').count(), times: await page.locator('.nsec .pt > button.ts').count(),
      slideTags: await page.locator('.nsec .pt > .tag.grey').allInnerTexts(), onlyOff: await page.locator('.tools label:has-text("Only what is not on the slides")').count(),
      chips: await page.locator('.chips .chip .num').count(), sample: norm(await page.locator('.main .alert:has(.tag:text-is("Sample"))').innerText().catch(() => '')),
      addrec: norm(await page.locator('.main .addrec').innerText().catch(() => '')), player: await page.locator('.player').count() };
    check('the pack: Notes, Slides, Flashcards and Quiz; no timeline, transcript, times, player or "Not on slides"; each point shows its slide',
      JSON.stringify(pack.tabs.map(x => x.replace(/ \(\d+\)/, ''))) === '["Notes","Slides","Flashcards","Quiz"]' && pack.tl === 0 && pack.off === 0 && pack.times === 0 && pack.player === 0
      && pack.slideTags.length > 3 && pack.slideTags.every(x => /^Slide \d+$/.test(x)) && pack.onlyOff === 0 && pack.chips === 0, pack);
    check('it offers the other half: Add a recording and Record the next class, and says the sample build wrote no pack of its own',
      pack.addrec.startsWith('This pack covers what is on the slides. Lecturers say the rest out loud') && pack.addrec.includes('Add a recording') && pack.addrec.includes('Record the next class')
      && pack.sample.includes('this is a sample pack'), pack);
    await page.click('.tabs button:text-is("Slides")');
    const slidesTab = { rows: await page.locator('.srow').count(), note: await page.locator('.note-demo').innerText() };
    check('the Slides tab lists the explained pages and says pages with nothing to learn are left out', slidesTab.rows > 3 && slidesTab.note === 'Pages with nothing to learn, such as the title page, are left out.', slidesTab);

    await page.goto(ORIGIN + '/#/home'); await page.waitForSelector('#lecList');
    const row = norm(await page.locator(`#lecList li:has(a[href="#/lecture/${encodeURIComponent(id)}"])`).innerText());
    check('Home lists the pack with a "Slides" tag instead of a length', /Slides$/.test(row), row);
    await page.click('a[data-act=from-slides]'); await page.waitForSelector('.choice');
    check('the Home link opens New lecture with Slides only chosen', (await page.locator('.choice button[data-act=mode-slides]').getAttribute('aria-checked')) === 'true' && (await page.locator('form button.btn.blue').innerText()) === 'Make the study pack');
    await page.click('.choice button:nth-child(1)');
    await page.goto(ORIGIN + '/#/'); await page.waitForSelector('a[data-act=land-slides]');
    const land = await page.locator('a[data-act=land-slides]').innerText(); await page.click('a[data-act=land-slides]'); await page.waitForSelector('.choice');
    check('so does the landing page link', land === 'No recording yet? Make a study pack from your slides' && (await page.locator('.choice button[data-act=mode-slides]').getAttribute('aria-checked')) === 'true', land);

    // Add a recording to the pack: its upload shows on the pack's page, then the notes are written and replace the pack.
    await page.goto(ORIGIN + '/#/lecture/' + encodeURIComponent(id)); await page.waitForSelector('.addrec');
    const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.click('button[data-act=addrec]')]); await fc.setFiles(mp3());
    await waitText(page, 'Uploading the recording', 5000);
    const during = { nsec: await page.locator('.nsec').count(), addrec: await page.locator('.addrec').count() };
    await waitText(page, 'Hal is writing your notes', 15000);
    await page.waitForSelector('.nsec', { timeout: 20000 });
    const full = { tabs: await tabs(page), tl: await page.locator('.tl').count(), addrec: await page.locator('.addrec').count(), times: await page.locator('.nsec .pt > button.ts').count() };
    await page.goto(ORIGIN + '/#/home'); await page.waitForSelector('#lecList');
    const row2 = norm(await page.locator(`#lecList li:has(a[href="#/lecture/${encodeURIComponent(id)}"])`).innerText());
    check('Add a recording: the upload shows above the pack, then "Hal is writing your notes", then full notes with times, a timeline and the transcript',
      during.nsec > 0 && during.addrec === 0 && full.tabs.includes('Transcript') && full.tl === 1 && full.addrec === 0 && full.times > 3 && !/Slides$/.test(row2), { during, full, row2 });

    // Chinese
    await page.evaluate(() => window.__sidenote.setLang('zh-Hant'));
    await page.goto(ORIGIN + '/#/new'); await page.waitForSelector('.choice'); await choose(page);
    const zform = { text: norm(await page.locator('.choice button[data-act=mode-slides]').innerText()), button: await page.locator('form button.btn.blue').innerText(), note: norm(await page.locator('form p.small.muted').first().innerText()) };
    await page.setInputFiles('#fSl', pdf()); await page.click('form button.btn.blue');
    await waitText(page, 'Hal 正在讀你的簡報'); await page.waitForSelector('.addrec', { timeout: 20000 });
    const zpack = { addrec: norm(await page.locator('.addrec').innerText()), tag: await page.locator('.nsec .pt > .tag.grey').first().innerText() };
    check('in Chinese: the choice, the button, the note, the waiting card, the offer and the slide tags',
      zform.text === '只有簡報，不錄音 用簡報做一份學習包：講解、重點、閃卡和測驗。' && zform.button === '製作學習包' && zform.note.startsWith('不用錄音，也不會用到你的錄音時間。')
      && zpack.addrec.startsWith('這份學習包只包括簡報上寫了的內容。') && zpack.addrec.includes('加入錄音') && /^第 \d+ 頁$/.test(zpack.tag), { zform, zpack });
    await ctx.close(); }

  console.log('\n=== real backend (fake API) ===');
  const PACK = { kind: 'slides', summary: ['Opportunity cost is what you give up.'], alerts: [], transcript: [], slides: [{ n: 1, title: 'Opportunity cost' }, { n: 2, title: 'Trade' }],
    sections: [{ title: 'Opportunity cost', slides: 'Slide 1', start: 0, end: 0, points: [{ t: null, text: 'Opportunity cost is the next best alternative.', off: false, slide: 1 }] },
      { title: 'Trade', slides: 'Slide 2', start: 0, end: 0, points: [{ t: null, text: 'Trade lets both sides gain.', off: false, slide: 2 }] }],
    flashcards: [{ q: 'Opportunity cost?', a: 'The next best alternative.' }], quiz: [{ q: 'Opportunity cost is', opts: ['a', 'b', 'c', 'd'], a: 1, t: null }] };
  const NOTES = { alerts: [], transcript: [{ t: 5, text: 'Today: opportunity cost.' }], slides: PACK.slides, flashcards: [], quiz: [],
    sections: [{ title: 'Opportunity cost', slides: 'Slide 1', start: 0, end: 600, points: [{ t: 30, text: 'Said in class.', off: true, slide: 1 }] }] };
  /* be.lec: the lecture as the server has it. be.fail: the pack fails. be.slidesRefused: POST /slides answers 415. */
  const backend = be => async route => {
    const req = route.request(), u = new URL(req.url()), m = req.method(), j = (o, s = 200) => route.fulfill({ status: s, contentType: 'application/json', body: JSON.stringify(o) }).catch(() => {});
    if (!u.pathname.startsWith('/api/')) return serve(route, { USE_MOCK: false, POLL_MS: 50 });
    const p = u.pathname.slice(4); be.log.push(m + ' ' + p);
    if (p === '/session') return j({ token: 'tok', user: { name: 'T' } });
    if (p === '/home') return j({ user: { name: 'T' }, courses: [{ id: 'c1', code: 'TEST 1001' }], lectures: be.lec ? [be.lec] : [], upcoming: [], settings: { classLanguage: 'en', zhDefault: false },
      usage: { minutesToday: 0, minutesLimit: 90, ...(be.full ? { lecturesThisMonth: 4, lecturesLimit: 4 } : {}) } });
    if (m === 'POST' && p === '/lectures') { const b = JSON.parse(req.postData() || '{}'); be.created = b;
      if (b.source !== 'slides' && be.full) return j({ message: 'You have used the 4 lectures that Free includes this month. Choose Plus in Settings for more lectures, or wait until 1 Dec.' }, 429);
      be.lec = { id: 'p1', course: 'c1', title: b.title, date: 'Today', status: 'recording', source: b.source }; return j(be.lec); }
    if (m === 'POST' && p === '/lectures/p1/slides') { const body = req.postDataBuffer() || Buffer.alloc(0); be.slides = { hasFile: body.includes('name="file"'), name: (/filename="([^"]+)"/.exec(body.toString('latin1')) || [])[1] };
      return be.slidesRefused ? j({ message: 'The slides have to be a PDF file.' }, 415) : route.fulfill({ status: 204 }); }
    if (m === 'POST' && p === '/lectures/p1/recording') { be.lec = { ...be.lec, source: 'upload' }; be.rewrite = true; be.polls = 0; return route.fulfill({ status: 204 }); }
    if (m === 'POST' && (p === '/lectures/p1/finish' || p === '/lectures/p1/retry')) { be.finish = req.postData(); if (be.lec.status !== 'ready' || !be.rewrite) be.polls = 0; be.lec = { ...be.lec, status: 'processing' }; if (p.endsWith('retry')) be.fail = false; return j({ status: 'processing' }); }
    if (p === '/lectures/p1/status') { be.polls = (be.polls || 0) + 1; if (be.polls >= (be.slow || 3) && be.lec.status === 'processing') be.lec = { ...be.lec, status: be.fail ? 'failed' : 'ready' }; return j({ status: be.lec.status }); }
    if (m === 'GET' && p === '/lectures/p1') return j({ lecture: be.lec, detail: be.lec.status === 'ready' ? (be.rewrite ? NOTES : PACK) : null });
    if (m === 'DELETE' && p === '/lectures/p1') { be.deleted = true; be.lec = null; return route.fulfill({ status: 204 }); }
    return j({ message: 'Not found' }, 404);
  };
  const make = async (page, file = pdf()) => { await page.goto(ORIGIN + '/#/new'); await page.waitForSelector('.choice'); await choose(page); await page.setInputFiles('#fSl', file); await page.click('form button.btn.blue'); };

  { const be = { log: [], slow: 8 }; const { ctx, page } = await open({ USE_MOCK: false, POLL_MS: 50 }, backend(be));
    await make(page); await waitText(page, 'Hal is reading your slides');
    await page.waitForSelector('.nsec', { timeout: 15000 });
    const sent = be.log.filter(x => !/status$|GET \/home|GET \/lectures\/p1$/.test(x));
    check('sends POST /lectures with source "slides", the PDF as multipart "file" to /slides, then /finish, and polls until ready',
      be.created.source === 'slides' && be.created.autoTitle === true && be.slides.hasFile && be.slides.name === 'week10-slides.pdf'
      && JSON.stringify(sent.slice(-3)) === '["POST /lectures","POST /lectures/p1/slides","POST /lectures/p1/finish"]' && JSON.parse(be.finish).duration === 0
      && be.log.filter(x => x === 'GET /lectures/p1/status').length >= 8, { created: be.created, slides: be.slides, sent, finish: be.finish });
    const pk = { tags: await page.locator('.nsec .pt > .tag.grey').allInnerTexts(), sample: await page.locator('.main .alert:has(.tag:text-is("Sample"))').count(), addrec: await page.locator('.addrec').count() };
    check('the pack from the server: each point under its slide, no sample notice, the offer to add a recording', JSON.stringify(pk.tags) === '["Slide 1","Slide 2"]' && pk.sample === 0 && pk.addrec === 1, pk);

    // Add a recording: POST /recording then /finish; the page says the notes are being written, then shows them.
    const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.click('button[data-act=addrec]')]); await fc.setFiles(mp3());
    await waitText(page, 'Hal is writing your notes', 10000);
    const reading = await page.locator('.main:has-text("Hal is reading your slides")').count();
    await page.waitForSelector('.nsec .pt > button.ts', { timeout: 15000 });
    const after = be.log.slice(be.log.indexOf('POST /lectures/p1/recording'));
    check('adding a recording: POST /recording, then /finish; "Hal is writing your notes", then the new notes with their times',
      after[0] === 'POST /lectures/p1/recording' && after[1] === 'POST /lectures/p1/finish' && reading === 0 && (await tabs(page)).includes('Transcript') && (await page.locator('.addrec').count()) === 0, after);
    await ctx.close(); }

  { const be = { log: [], fail: true }; const { ctx, page } = await open({ USE_MOCK: false, POLL_MS: 50 }, backend(be));
    await make(page); await waitText(page, 'This study pack could not be written');
    const box = norm(await page.locator('.main .card').first().innerText());
    await page.click('.main button:text-is("Try again")'); await page.waitForSelector('.nsec', { timeout: 15000 });
    check('a pack that failed: "This study pack could not be written", the file is still saved; Try again asks POST /retry and shows the pack',
      box.includes('Something went wrong while the slide deck was being read. The file is still saved.') && be.log.includes('POST /lectures/p1/retry'), box);
    await ctx.close(); }

  { const be = { log: [], slidesRefused: true }; const { ctx, page } = await open({ USE_MOCK: false, POLL_MS: 50 }, backend(be));
    await make(page); await page.waitForSelector('form .err');
    const err = await page.locator('form .err').innerText();
    check('a PDF the server refuses: its reason under the form, the lecture just made is deleted, the file stays chosen',
      err === 'The slides have to be a PDF file.' && be.deleted && page.url().endsWith('#/new') && (await page.locator('.filechip').count()) === 1 && !be.log.includes('POST /lectures/p1/finish'), { err, log: be.log });
    await ctx.close(); }

  { const be = { log: [], lec: { id: 'p1', course: 'c1', title: 'Week 10', date: 'Today', status: 'recording', source: 'slides' } };
    const { ctx, page } = await open({ USE_MOCK: false, POLL_MS: 50 }, backend(be));
    await page.goto(ORIGIN + '/#/lecture/p1'); await waitText(page, 'This study pack was never made');
    await page.click('.main button:text-is("Make the study pack")'); await page.waitForSelector('.nsec', { timeout: 15000 });
    check('a pack that was never started: "This study pack was never made", and Make the study pack sends /finish', be.log.includes('POST /lectures/p1/finish'));
    await ctx.close(); }

  { const be = { log: [], full: true, lec: { id: 'p1', course: 'c1', title: 'Week 10', date: 'Today', status: 'ready', source: 'slides' } };
    const { ctx, page } = await open({ USE_MOCK: false, POLL_MS: 50 }, backend(be));
    await page.goto(ORIGIN + '/#/lecture/p1'); await page.waitForSelector('.addrec');
    let chooser = false; page.on('filechooser', () => { chooser = true; });
    await page.click('button[data-act=addrec]'); await page.waitForSelector('#overlay h3');
    const w = norm(await page.locator('#overlay').innerText());
    check('Add a recording when the month\'s lectures are used up: the limit window, no file chooser, nothing sent',
      w.includes('You have reached the limit of your plan') && w.includes('This month\'s lectures are used up, and a recording makes this pack one of them.') && !chooser && !be.log.some(x => /recording$/.test(x)), w);
    await page.click('#overlay button:text-is("Not now")');
    // A recorded lecture over the limit: the window offers a study pack instead, which is not counted.
    await page.goto(ORIGIN + '/#/new'); await page.waitForSelector('.choice'); await page.click('.choice button:nth-child(3)'); await page.fill('input[type=url]', 'https://example.com/lecture.mp4'); await page.click('form button.btn.blue');
    await page.waitForSelector('#overlay a[data-act=q-slides]');
    const offer = norm(await page.locator('#overlay p:has(a[data-act=q-slides])').innerText());
    await page.click('#overlay a[data-act=q-slides]'); await page.waitForTimeout(300);
    check('a recorded lecture over the limit: the window offers a study pack from the slides instead, which opens Slides only',
      offer === 'Make a study pack from the slides instead It needs no recording and does not use your recording time.' && (await page.locator('#overlay h3').count()) === 0
      && (await page.locator('.choice button[data-act=mode-slides]').getAttribute('aria-checked')) === 'true', offer);
    await ctx.close(); }

  check('no page errors', errs.length === 0, errs);
  await browser.close();
  console.log(`\n${results.filter(Boolean).length} of ${results.length} checks passed`);
})().catch(e => { console.error('SCRIPT ERROR', String(e.message).slice(0, 1200)); process.exit(1); });
