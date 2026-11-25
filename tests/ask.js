// Ask on the lecture page (from the designer's halfold.html, 2026-11-24): an "Ask" tab on the student's own lectures sends
// POST /lectures/:id/ask {question}; the answer shows with "Where it was said" (the transcript lines it rests on), and a
// time opens the transcript there. Not on the shared page, nor on a lecture with nothing to ask about. Errors: our
// server's sentence as it is (in Chinese too), anything else after a sentence of ours. An answer that comes after the
// student moved to another lecture is dropped. Sample build: lines that mention the words, no answer. Real-backend mode
// by request interception, and the sample build.
const { chromium, ORIGIN, serve, setConfig } = require('./harness');
const results = [];
const check = (name, ok, detail) => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || detail === undefined ? '' : '  -> ' + JSON.stringify(detail)}`); };

const TRANSCRIPT = [{ t: 1, text: 'Good morning.' }, { t: 18, text: 'The midterm is on 26 November.' }, { t: 75, text: 'Chapters one to five.' }, { t: 252, text: 'Opportunity cost is the next best thing you give up.' }];
const DETAIL = (o = {}) => ({ alerts: [], sections: [{ title: 'Admin', start: 0, end: 300, points: [{ t: o.untimed ? null : 18, text: 'Midterm on 26 November.' }] }], slides: [], transcript: o.untimed ? [] : TRANSCRIPT, flashcards: [], quiz: [] });
const LEC = id => ({ id, course: 'c1', title: id === 'l1' ? 'Week 9' : id === 'l2' ? 'Week 10' : 'Week 11', date: 'Tue 10 Nov', duration: 300, status: 'ready' });

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const errs = [];
  /* be.reply: what POST /ask answers ({status, body}, or "abort"), after be.delay ms. */
  async function open(be, o = {}) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    if (o.lang) await ctx.addInitScript(l => { try { localStorage.setItem('sidenote.lang', l); } catch (e) {} }, o.lang);
    const cfg = { USE_MOCK: false, POLL_MS: 100 };
    await setConfig(ctx, cfg);
    await ctx.route('**/*', async route => {
      const req = route.request(), u = new URL(req.url()), m = req.method(), j = (b, s = 200) => route.fulfill({ status: s, contentType: 'application/json', body: JSON.stringify(b) });
      if (!u.pathname.startsWith('/api/')) return serve(route, cfg);
      const p = u.pathname.slice(4); be.log.push(m + ' ' + p);
      if (p === '/session') return j({ token: 't', user: { name: 'Jasper' } });
      if (p === '/home') return j({ user: { name: 'Jasper' }, courses: [{ id: 'c1', code: 'ECON 1001', name: 'Micro' }], lectures: ['l1', 'l2', 'l3'].map(LEC), upcoming: [], settings: { classLanguage: 'en', zhDefault: false } });
      const lec = /^\/lectures\/(l\d)$/.exec(p);
      if (m === 'GET' && lec) return j({ lecture: LEC(lec[1]), detail: DETAIL({ untimed: lec[1] === 'l3' }) });
      if (m === 'POST' && /^\/lectures\/l\d\/ask$/.test(p)) {
        be.asked.push(JSON.parse(req.postData())); if (be.delay) await new Promise(r => setTimeout(r, be.delay));
        const r = be.reply || { status: 200, body: { answer: 'On 26 November, covering chapters one to five.', refs: [TRANSCRIPT[1], TRANSCRIPT[2]] } };
        return r === 'abort' ? route.abort('failed') : j(r.body, r.status);
      }
      if (m === 'GET' && p === '/shared/s1') return j({ lecture: { ...LEC('l1'), id: 's1' }, course: { id: 'c1', code: 'ECON 1001' }, detail: DETAIL(), sharedBy: 'Ann' });
      return j({ message: 'Not found' }, 404);
    });
    const page = await ctx.newPage(); page.on('pageerror', e => errs.push(e.message));
    await page.goto(ORIGIN + '/#/signin'); await page.fill('input[name=code]', 'abc'); await page.click('form.auth button'); await page.waitForSelector('.shell');
    return { ctx, page };
  }
  const tabs = page => page.$$eval('.tabs [role=tab]', bs => bs.map(b => b.textContent));
  const openAsk = async (page, id = 'l1') => { await page.evaluate(i => { location.hash = '#/lecture/' + i; }, id); await page.waitForSelector('.tabs'); await page.click('.tabs [role=tab]:text-is("Ask")'); await page.waitForSelector('.askbox'); };
  const ask = async (page, q) => { await page.fill('.askbox input', q); await page.click('.askbox button'); };
  const main = page => page.locator('.main .inner').innerText().then(x => x.replace(/\s+/g, ' ')).catch(() => '');

  { const be = { log: [], asked: [], delay: 500 }; const { ctx, page } = await open(be);
    await page.evaluate(() => { location.hash = '#/lecture/l1'; }); await page.waitForSelector('.tabs');
    const own = await tabs(page);
    check('the student\'s own lecture has an Ask tab, last', own[own.length - 1] === 'Ask', own);
    await page.click('.tabs [role=tab]:text-is("Ask")'); await page.waitForSelector('.askbox');
    const ph = await page.getAttribute('.askbox input', 'placeholder'), max = await page.getAttribute('.askbox input', 'maxlength');
    check('the tab: a box (at most 300 characters) and what it is for', ph === 'What did the lecturer say about the midterm?' && max === '300' && (await main(page)).includes('Ask anything about this lecture. Every answer points to the moment it was said, so you can check it.'), { ph, max });
    await ask(page, '  When is the midterm?  '); await page.waitForTimeout(150);
    const busy = { text: await page.innerText('.askbox button'), disabled: await page.isDisabled('.askbox button') };
    check('while it is asked the button says Looking and cannot be pressed again', busy.text === 'Looking' && busy.disabled, busy);
    await page.waitForSelector('.card.answer');
    const a = await page.innerText('.card.answer').then(x => x.replace(/\s+/g, ' ')), times = await page.$$eval('.card.answer .ts', bs => bs.map(b => b.textContent));
    check('POST /lectures/:id/ask {question} (trimmed); the answer, then "Where it was said" with each line and its time', be.asked.length === 1 && be.asked[0].question === 'When is the midterm?' && a.startsWith('On 26 November, covering chapters one to five.') && a.includes('Where it was said') && a.includes('The midterm is on 26 November.') && times.join(',') === '0:18,1:15', { asked: be.asked, a, times });
    check('the question stays in the box', await page.inputValue('.askbox input') === 'When is the midterm?');
    await page.click('.card.answer .ts >> nth=1'); await page.waitForTimeout(300);
    const st = await page.evaluate(() => ({ pos: window.__sidenote.state.pos, tab: window.__sidenote.state.tab, hit: window.__sidenote.state.hit }));
    check('a time opens the transcript at that line', st.tab === 'transcript' && st.pos === 75 && st.hit === 75, st);
    await page.click('.tabs [role=tab]:text-is("Ask")'); await page.waitForSelector('.card.answer');
    check('back on Ask, the answer is still there', (await page.innerText('.card.answer')).includes('On 26 November'));
    be.reply = { status: 200, body: { answer: 'The lecture does not say.', refs: [] } }; be.delay = 0;
    await ask(page, 'Who won the World Cup?'); await page.waitForTimeout(300);
    const none = await page.innerText('.card.answer');
    check('an answer without lines: no "Where it was said"', none.includes('The lecture does not say.') && !none.includes('Where it was said'), none);
    be.reply = { status: 200, body: { answer: '', refs: [] } };
    await ask(page, 'xyzzy'); await page.waitForTimeout(300);
    check('nothing at all: "Nothing in this lecture matches that. Try other words."', (await page.innerText('.card.answer')).includes('Nothing in this lecture matches that. Try other words.'));
    await ctx.close(); }

  { const be = { log: [], asked: [], reply: { status: 502, body: { message: 'Hal could not answer that just now. Try again in a moment.' } } }; const { ctx, page } = await open(be);
    await openAsk(page); await ask(page, 'What is opportunity cost?'); await page.waitForSelector('.askbox ~ .err');
    const e1 = await page.innerText('.err');
    check('the server could not answer (502): its sentence, as it is', e1 === 'Hal could not answer that just now. Try again in a moment.' && await page.locator('.card.answer').count() === 0, e1);
    be.reply = 'abort'; await ask(page, 'Again?'); await page.waitForTimeout(500);
    const e2 = await page.innerText('.err');
    check('a dropped connection: a sentence of ours first', e2.startsWith('That question could not be answered right now.'), e2);
    await page.evaluate(() => window.__sidenote.setLang('zh-Hant')); be.reply = { status: 502, body: { message: 'Hal could not answer that just now. Try again in a moment.' } };
    await openAsk(page).catch(() => {}); await page.click('.tabs [role=tab]:text-is("提問")').catch(() => {}); await page.waitForSelector('.askbox');
    await ask(page, '期中考考什麼？'); await page.waitForTimeout(400);
    const e3 = await page.innerText('.err').catch(() => '');
    check('in Chinese, the server\'s sentence in Chinese', e3 === 'Hal 暫時答不了這個問題，請稍後再試。', e3);
    await ctx.close(); }

  { const be = { log: [], asked: [], delay: 800 }; const { ctx, page } = await open(be);
    await openAsk(page, 'l1'); await ask(page, 'When is the midterm?'); await page.waitForTimeout(100);
    await page.evaluate(() => { location.hash = '#/lecture/l2'; }); await page.waitForSelector('.tabs'); await page.click('.tabs [role=tab]:text-is("Ask")'); await page.waitForTimeout(1200);
    const t = await main(page);
    check('an answer that comes after moving to another lecture is not shown there', !t.includes('On 26 November') && t.includes('Ask anything about this lecture.') && await page.inputValue('.askbox input') === '', t.slice(-300));
    await ctx.close(); }

  { const be = { log: [], asked: [] }; const { ctx, page } = await open(be);
    await page.evaluate(() => { location.hash = '#/s/s1'; }); await page.waitForSelector('.tabs');
    const shared = await tabs(page);
    await page.evaluate(() => { location.hash = '#/lecture/l3'; }); await page.waitForSelector('.tabs');
    const untimed = await tabs(page);
    check('no Ask tab on the shared page, nor on a lecture with no transcript and no timed notes', !shared.includes('Ask') && !untimed.includes('Ask'), { shared, untimed });
    await ctx.close(); }

  { const be = { log: [], asked: [] }; const { ctx, page } = await open(be, { lang: 'zh-Hant' });
    await page.evaluate(() => { location.hash = '#/lecture/l1'; }); await page.waitForSelector('.tabs');
    await page.click('.tabs [role=tab]:text-is("提問")'); await page.waitForSelector('.askbox');
    const ph = await page.getAttribute('.askbox input', 'placeholder'), btn = await page.innerText('.askbox button'), intro = await main(page);
    await ask(page, '期中考是哪天？'); await page.waitForSelector('.card.answer');
    const a = await page.innerText('.card.answer');
    check('Traditional: tab, box, button, intro and "Where it was said"; the answer as sent', ph === '老師對期中考說了甚麼？' && btn === '提問' && intro.includes('這堂課的任何內容都可以問。') && a.includes('老師在哪裡說的') && a.includes('On 26 November'), { ph, btn, a });
    await page.evaluate(() => window.__sidenote.setLang('zh-Hans')); await page.waitForTimeout(200);
    check('Simplified: "Where it was said"', (await page.innerText('.card.answer')).includes('老师在哪里说的'));
    await ctx.close(); }

  /* The sample build: no model, so the lines that mention the words of the question, and a note that says so. */
  { const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } }); const page = await ctx.newPage(); page.on('pageerror', e => errs.push(e.message));
    await page.goto(ORIGIN + '/#/signin'); await page.fill('input[name=code]', 'abc'); await page.click('form.auth button'); await page.waitForSelector('.shell');
    await page.evaluate(() => { location.hash = '#/lecture/econ-w9'; }); await page.waitForSelector('.tabs'); await page.click('.tabs [role=tab]:text-is("Ask")'); await page.waitForSelector('.askbox');
    const note = await page.locator('.note-demo').innerText().catch(() => '');
    await ask(page, 'comparative advantage'); await page.waitForSelector('.card.answer');
    const refs = await page.locator('.card.answer .pt').count(), a = await page.innerText('.card.answer');
    check('sample build: a note, and up to four lines that mention the words', note.startsWith('Sample build: this finds the moments') && refs >= 1 && refs <= 4 && /comparative advantage/i.test(a), { note, refs });
    await ctx.close(); }

  check('no page errors', errs.length === 0, errs);
  await browser.close();
  const n = results.filter(Boolean).length; console.log(`\n${n} of ${results.length} checks passed`); process.exit(n === results.length ? 0 : 1);
})().catch(e => { console.error('SCRIPT ERROR', String(e.message).slice(0, 1200)); process.exit(1); });
