// The lecture page (batch 1, item 8 and the share button): a "Topics" row, topics that fold, one "Edit title and course"
// dialog, timestamps that start the recording, tabs that appear only when they have something in them, and "Send to an
// app" when the browser can share. Real-backend mode (fake API by request interception, every request logged); the
// recording is a real 300 s WAV served with Range support.
const { chromium, ORIGIN, serve, setConfig } = require('./harness');
const results = [];
const check = (name, ok, detail) => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || detail === undefined ? '' : '  -> ' + JSON.stringify(detail)}`); };

function wav(seconds) {
  const rate = 8000, n = seconds * rate, b = Buffer.alloc(44 + n);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate, 28); b.writeUInt16LE(1, 32); b.writeUInt16LE(8, 34); b.write('data', 36); b.writeUInt32LE(n, 40);
  for (let i = 0; i < n; i++) b[44 + i] = 128 + Math.round(20 * Math.sin(i / 6));
  return b;
}
const WAV = wav(300);

const pt = (t, text) => ({ t, text, off: false, slide: null });
const DETAIL1 = () => ({ alerts: [], slides: [], flashcards: [{ q: 'q', a: 'a' }], quiz: [],
  sections: [
    { title: 'Opportunity cost', start: 200, end: 640, points: [pt(252, 'Cost is what you give up'), pt(300, 'Trade-offs everywhere'), pt(400, 'Example with coffee')] },
    { title: 'Supply', start: 640, end: 1260, points: [pt(700, 'Supply slopes up'), pt(800, 'Shifts of supply')] },
    { title: 'Demand', start: 1260, end: 1800, points: [pt(1300, 'Demand slopes down')] }],
  transcript: Array.from({ length: 40 }, (_, i) => ({ t: i * 10 + 200, text: 'Transcript line ' + i })), audio: { url: ORIGIN + '/audio/a.wav' } });
const DETAIL2 = () => ({ alerts: [], slides: [], flashcards: [], transcript: [], quiz: [{ q: 'q', opts: ['a', 'b'], a: 0, why: 'w', t: 5 }],
  sections: [{ title: 'Only topic', start: 0, end: 600, points: [pt(10, 'One point')] }] });

(async () => {
  const errs = [], log = [], patches = [];
  const lec = (id, title) => ({ id, course: 'c1', title, date: 'Today', status: 'ready', duration: 1800 });
  const LECTURES = [lec('l1', 'Week 9, supply'), lec('l2', 'Week 10, no transcript')];
  let COURSES = [{ id: 'c1', code: 'TEST 1001' }, { id: 'c2', code: 'TEST 2002' }];
  const cfg = { USE_MOCK: false, POLL_MS: 50 };
  const launch = () => chromium.launch({ headless: true, args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
  const open = async (browser, canShare) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await setConfig(ctx, cfg);
    if (canShare) await ctx.addInitScript(() => { window.__shared = []; navigator.share = d => { window.__shared.push(d); return Promise.resolve(); }; });
    await ctx.route('**/*', async route => {
      const req = route.request(), u = new URL(req.url()), m = req.method(), j = (o, s = 200) => route.fulfill({ status: s, contentType: 'application/json', body: JSON.stringify(o) }).catch(() => {});
      if (u.pathname.startsWith('/audio/')) {
        const r = /bytes=(\d+)-(\d*)/.exec(req.headers()['range'] || ''); if (!r) return route.fulfill({ status: 200, contentType: 'audio/wav', headers: { 'Accept-Ranges': 'bytes' }, body: WAV }).catch(() => {});
        const a = +r[1], b = r[2] ? +r[2] : WAV.length - 1; return route.fulfill({ status: 206, contentType: 'audio/wav', headers: { 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${a}-${b}/${WAV.length}` }, body: WAV.subarray(a, b + 1) }).catch(() => {});
      }
      if (!u.pathname.startsWith('/api/')) return serve(route, cfg);
      const p = u.pathname.slice(4); log.push(m + ' ' + p);
      if (p === '/session') return j({ token: 'tok', user: { name: 'T' } });
      if (p === '/home') return j({ user: { name: 'T' }, courses: COURSES, lectures: LECTURES, upcoming: [], settings: { classLanguage: 'en', zhDefault: false } });
      const one = /^\/lectures\/(l\d)$/.exec(p);
      if (m === 'GET' && one) return j({ lecture: LECTURES.find(x => x.id === one[1]), detail: one[1] === 'l1' ? DETAIL1() : DETAIL2() });
      if (m === 'PATCH' && one) { patches.push(req.postDataJSON()); return j(null); }
      if (m === 'POST' && /^\/lectures\/l\d\/share$/.test(p)) return j({ url: ORIGIN + '/#/s/abc' });
      return j({ message: 'Not found' }, 404);
    });
    const page = await ctx.newPage(); page.on('pageerror', e => errs.push(e.message));
    await page.goto(ORIGIN + '/#/signin'); await page.fill('input[name=code]', 'abc'); await page.click('form.auth button'); await page.waitForSelector('.shell');
    return { ctx, page };
  };
  const lecture = async (page, id) => { await page.goto(ORIGIN + '/#/lecture/' + id); await page.waitForSelector('.page-h h1'); await page.waitForTimeout(300); };
  const closedOf = page => page.$$eval('.nsec', ns => ns.map(n => n.classList.contains('closed')));
  const inView = (page, sel) => page.evaluate(s => { const r = document.querySelector(s).getBoundingClientRect(); return r.top >= -2 && r.top < innerHeight - 60; }, sel);

  const browser = await launch();
  { const { ctx, page } = await open(browser, false);
    await lecture(page, 'l1');
    const chips = (await page.$$eval('.chips .chip', cs => cs.map(c => c.innerText.replace(/\s+/g, ' ').trim()))).join('|');
    check('a "Topics" row lists each topic with its start time', chips === 'Opportunity cost 3:20|Supply 10:40|Demand 21:00' && (await page.locator('.sum h3').innerText()) === 'Topics', chips);

    await page.click('#sec-1 .sec-t'); await page.waitForTimeout(100);
    const shut = (await closedOf(page))[1];
    await page.click('.chips .chip >> nth=1'); await page.waitForTimeout(900);
    check('clicking a topic chip scrolls to that topic and opens it', shut && (await inView(page, '#sec-1')) && !(await closedOf(page))[1], { shut, closed: await closedOf(page) });

    await page.click('#sec-0 .sec-t'); await page.waitForTimeout(100);
    const cnt = await page.locator('#sec-0 .cnt').innerText().catch(() => null);
    check('clicking a topic heading closes it and shows how many notes it has', (await closedOf(page))[0] && cnt === '3 notes' && (await page.locator('#sec-0 .pt').count()) === 0, { cnt });

    await page.click('#sec-0 .sec-t'); await page.click('button:text-is("Collapse all topics")'); await page.waitForTimeout(100);
    const allClosed = (await closedOf(page)).every(Boolean), toggleText = await page.locator('button[data-act=collapse]').innerText();
    check('"Collapse all topics" closes every topic and turns into "Expand all topics"', allClosed && toggleText === 'Expand all topics', { allClosed, toggleText });
    await page.click('button:text-is("Expand all topics")'); await page.waitForTimeout(100);
    const expanded = (await closedOf(page)).every(x => !x) && (await page.locator('button[data-act=collapse]').innerText()) === 'Collapse all topics';
    await page.click('#sec-2 .sec-t');
    await page.click('text=Edit notes'); await page.waitForTimeout(150);
    const allOpenInEdit = (await closedOf(page)).every(x => !x) && (await page.locator('#sec-2 .pt').count()) === 1;
    await page.click('text=Edit notes'); await page.waitForTimeout(100);
    check('editing notes opens every topic (and Expand all opens them all again)', expanded && allOpenInEdit, { expanded, allOpenInEdit });

    await page.goto(ORIGIN + '/#/lecture/l2'); await page.waitForSelector('.page-h h1'); await page.waitForTimeout(200);
    await page.goto(ORIGIN + '/#/lecture/l1'); await page.waitForSelector('.nsec'); await page.waitForTimeout(200);
    check('the closed topics are forgotten when the page is visited again', (await closedOf(page)).every(x => !x), await closedOf(page));
    check('a lecture with one topic has no Topics row and no "Collapse all topics"', await (async () => { await lecture(page, 'l2'); return (await page.locator('.chips').count()) === 0 && (await page.locator('button[data-act=collapse]').count()) === 0; })());

    // "Print or save notes as PDF" with two topics folded: what is on the page when the print dialog opens (window.print is
    // replaced so that the page can be read at that moment) has every topic open with all its notes.
    await lecture(page, 'l1'); await page.click('#sec-0 .sec-t'); await page.click('#sec-2 .sec-t'); await page.waitForTimeout(100);
    const folded = (await closedOf(page)).filter(Boolean).length;
    await page.evaluate(() => { window.__printed = null; window.print = () => { window.__printed = { closed: document.querySelectorAll('.nsec.closed').length, pts: [...document.querySelectorAll('.nsec .pt')].map(p => p.innerText.replace(/\s+/g, ' ')) }; }; });
    await page.click('.page-h button:text-is("More")'); await page.click('#overlay button:text-is("Print or save notes as PDF")'); await page.waitForTimeout(600);
    const printed = await page.evaluate(() => window.__printed), want = ['Cost is what you give up', 'Trade-offs everywhere', 'Example with coffee', 'Supply slopes up', 'Shifts of supply', 'Demand slopes down'];
    check('printing the notes as PDF shows every topic open with all its notes, also the folded ones', folded === 2 && !!printed && printed.closed === 0 && printed.pts.length === 6 && want.every(w => printed.pts.some(x => x.includes(w))), { folded, printed });
    await lecture(page, 'l2');

    await lecture(page, 'l1');
    await page.click('.page-h button:text-is("More")'); const more = await page.locator('#overlay').innerText();
    check('the More menu has "Edit title and course" instead of Rename and Move', /Edit title and course/.test(more) && !/^Rename$|Move to another course/m.test(more), more);
    await page.click('#overlay button:text-is("Edit title and course")'); await page.waitForSelector('#overlay input[name=t]');
    const pre = { t: await page.inputValue('#overlay input[name=t]'), c: await page.inputValue('#overlay select[name=c]'), opts: await page.$$eval('#overlay select[name=c] option', os => os.map(o => o.value)) };
    await page.fill('#overlay input[name=t]', 'Week 9, revised'); await page.click('#overlay button:text-is("Save changes")'); await page.waitForSelector('.toast'); await page.waitForTimeout(200);
    const shownTitle = await page.locator('.page-h h1').innerText();
    await page.evaluate(() => document.querySelectorAll('.toast').forEach(t => t.remove()));
    await page.click('.page-h .muted button:text-is("Rename")'); await page.waitForSelector('#overlay input[name=t]');
    const dialogH3 = await page.locator('#overlay h3').innerText();
    await page.selectOption('#overlay select[name=c]', 'c2'); await page.click('#overlay button:text-is("Save changes")'); await page.waitForSelector('.toast'); await page.waitForTimeout(200);
    const crumb = await page.locator('.crumb a[href^="#/course/"]').innerText();
    check('the dialog starts with the title and course, and has a course list', pre.t === 'Week 9, supply' && pre.c === 'c1' && JSON.stringify(pre.opts) === '["c1","c2"]' && shownTitle === 'Week 9, revised', { pre, shownTitle });
    check('the dialog saves only what changed', JSON.stringify(patches[0]) === '{"title":"Week 9, revised"}' && JSON.stringify(patches[1]) === '{"course":"c2"}' && crumb === 'TEST 2002', { patches, crumb });
    check('the small Rename beside the date opens the same dialog', dialogH3 === 'Edit title and course', dialogH3);

    await lecture(page, 'l1');
    await page.click('.pt .ts >> nth=0'); await page.waitForTimeout(1200);
    const pl = await page.evaluate(() => ({ paused: __sidenote.pl.a.paused, t: __sidenote.pl.a.currentTime, tab: __sidenote.state.tab }));
    check('clicking a timestamp starts the recording from there', !pl.paused && Math.abs(pl.t - 252) < 3 && pl.tab === 'transcript', pl);
    await page.click('#pPlay'); await page.waitForTimeout(100);
    check('the bottom player is still there to pause it', (await page.locator('.player').count()) === 1 && await page.evaluate(() => __sidenote.pl.a.paused));

    const tabs1 = await page.$$eval('.tabs button', bs => bs.map(b => b.innerText));
    await lecture(page, 'l2');
    const tabs2 = await page.$$eval('.tabs button', bs => bs.map(b => b.innerText));
    check('no Transcript tab when there is no transcript; no Quiz tab when there is no quiz', tabs1.includes('Transcript') && !tabs1.some(x => /^Quiz/.test(x)) && !tabs2.includes('Transcript') && tabs2.some(x => /^Quiz/.test(x)), { tabs1, tabs2 });

    await lecture(page, 'l1'); await page.click('.page-h button.btn.primary'); await page.waitForSelector('#overlay .copy');
    const sendWithout = await page.locator('#overlay button:text-is("Send to an app")').count();
    check('no "Send to an app" when the browser cannot share', sendWithout === 0);

    await page.keyboard.press('Escape');
    await page.click('text=中文解釋');
    const hasZh = (await page.locator('.tools >> nth=0').innerText()).includes('中文解釋'), hasPlayer = (await page.locator('.player').count()) === 1;
    check('the bottom player and the 中文解釋 switch are still there', hasZh && hasPlayer, { hasZh, hasPlayer });
    await ctx.close(); }

  { const { ctx, page } = await open(browser, true);
    await lecture(page, 'l1'); await page.click('.page-h button.btn.primary'); await page.waitForSelector('#overlay .copy');
    const btn = await page.locator('#overlay button:text-is("Send to an app")').count();
    if (btn) await page.click('#overlay button:text-is("Send to an app")');
    const sent = await page.evaluate(() => window.__shared);
    check('Share shows "Send to an app" when the browser can share, and it sends the title and the link', btn === 1 && sent.length === 1 && sent[0].url === ORIGIN + '/#/s/abc' && sent[0].title === 'Week 9, supply' && sent[0].text === 'TEST 1001: Week 9, supply', { btn, sent });
    await ctx.close(); }

  COURSES = [{ id: 'c1', code: 'TEST 1001' }];
  { const { ctx, page } = await open(browser, false);
    await lecture(page, 'l1'); await page.click('.page-h button:text-is("More")'); await page.click('#overlay button:text-is("Edit title and course")'); await page.waitForSelector('#overlay input[name=t]');
    check('with only one course the dialog has no course list', (await page.locator('#overlay select').count()) === 0 && (await page.locator('#overlay input[name=t]').count()) === 1);
    await ctx.close(); }

  check('no page errors', errs.length === 0, errs);
  await browser.close();
  console.log(`\n${results.filter(Boolean).length} of ${results.length} checks passed`);
})().catch(e => { console.error('SCRIPT ERROR', String(e.message).slice(0, 1200)); process.exit(1); });
