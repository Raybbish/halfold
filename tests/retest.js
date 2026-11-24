// The issues still open at the retest of 2026-11-23 (handoff of 2026-11-23, item 6), in the browser: dates in the Chinese
// interface, 中文解釋 on by default and first in the tool row, class languages that are not only English-taught Hong Kong
// classes, the built-in example notes (served by our server's own code), a title on the page that waits for the notes,
// no "Only what is not on the slides" without slides, the Help page's sign-in section, and exam radar dates added by
// hand. Sample mode and real-backend mode (fake API by request interception), built app only. The quota part (a failed
// lecture is not counted) and the notes prompt are in server/test/retest.test.ts.
const { spawnSync } = require('child_process');
const path = require('path');
const { chromium, ORIGIN, ROOT, serve, setConfig } = require('./harness');
const results = [];
const check = (name, ok, detail) => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || detail === undefined ? '' : '  -> ' + JSON.stringify(detail)}`); };
/* A part that cannot even be done (a button that is not there) fails its checks instead of stopping the script. */
const part = async (names, fn) => { try { await fn(); } catch (e) { for (const n of names) check(n, false, String(e.message).split('\n')[0]); } };

const EN_DATE = /\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun) \d{1,2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b/;
/* What GET /shared/econ-w9 answers on our server without such a shared lecture in its database (server/src/example.ts). */
function serverExample() {
  const r = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', '--import', 'tsx', '-e', 'import("./src/example.ts").then(m => process.stdout.write(JSON.stringify(m.exampleNotes())))'],
    { cwd: path.join(ROOT, 'server'), encoding: 'utf8' });
  try { return JSON.parse(r.stdout); } catch (e) { return null; }
}

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const errs = [];
  const visibleText = page => page.evaluate(() => { const out = [], w = document.createTreeWalker(document.getElementById('app'), NodeFilter.SHOW_TEXT);
    while (w.nextNode()) { const n = w.currentNode, p = n.parentElement; if (!p || p.closest('[data-notr],script,style') || !p.getClientRects().length) continue; const v = n.nodeValue.trim(); if (v) out.push(v); } return out.join(' | '); });

  /* ---------- sample mode, signed in ---------- */
  { const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } }); await setConfig(ctx, { USE_MOCK: true });
    const page = await ctx.newPage(); page.on('pageerror', e => errs.push(e.message));
    await page.goto(ORIGIN + '/#/signin'); await page.fill('input[name=code]', 'x'); await page.click('form.auth button'); await page.waitForSelector('.shell');

    // 2. dates in the Chinese interface
    const dates = {};
    for (const lang of ['zh-Hant', 'zh-Hans']) {
      await page.evaluate(l => window.__sidenote.setLang(l), lang);
      const seen = [];
      for (const h of ['#/home', '#/course/econ1001', '#/lecture/econ-w9']) { await page.goto(ORIGIN + '/' + h); await page.waitForTimeout(400); const txt = await visibleText(page); const m = txt.match(EN_DATE); if (m) seen.push(h + ': ' + m[0]); }
      await page.goto(ORIGIN + '/#/home'); await page.waitForTimeout(300);
      dates[lang] = { english: seen, list: await page.locator('#lecList').innerText() };
    }
    check('Chinese interface: no English dates ("Tue 10 Nov") on home, the course page or the lecture page, 繁 and 简', !dates['zh-Hant'].english.length && !dates['zh-Hans'].english.length, dates);
    check('the lecture list gives the date in Chinese: 11月10日（週二） in 繁, 11月10日（周二） in 简', dates['zh-Hant'].list.includes('11月10日（週二）') && dates['zh-Hans'].list.includes('11月10日（周二）'), dates);
    await page.evaluate(() => window.__sidenote.setLang('en'));

    // 4. 中文解釋 on by default, first in the tool row
    await page.goto(ORIGIN + '/#/lecture/econ-w9'); await page.waitForSelector('.tools');
    const zh = { shown: await page.locator('.pt .zh').count(), first: await page.evaluate(() => { const f = document.querySelector('.tools > *'); return f && f.className + ' ' + f.textContent; }),
      checked: await page.locator('.tools input[name=zh]').isChecked().catch(() => null) };
    check('中文解釋 is shown under the points without turning anything on, and its switch is the first thing in the tool row', zh.shown > 3 && /^zh-on on/.test(zh.first || '') && /中文解釋/.test(zh.first) && zh.checked === true, zh);

    // 4. class languages
    const opts = async sel => page.locator(sel + ' option').evaluateAll(os => os.map(o => o.value + '=' + o.textContent));
    await page.goto(ORIGIN + '/#/new'); await page.waitForSelector('.choice');
    const en = await opts('form.card select[name=lang]');
    await page.evaluate(() => window.__sidenote.setLang('zh-Hans')); await page.waitForTimeout(200);
    const hans = await opts('form.card select[name=lang]');
    await page.goto(ORIGIN + '/#/settings'); await page.waitForSelector('select[name=lang]');
    const settings = await opts('select[name=lang]');
    await page.evaluate(() => window.__sidenote.setLang('en'));
    check('class language: English, Mandarin, Cantonese, English with Mandarin, English with Cantonese, Detect automatically', JSON.stringify(en) === JSON.stringify(['en=English', 'zh=Mandarin', 'yue=Cantonese', 'en-zh=English with Mandarin', 'en-yue=English with Cantonese', 'auto=Detect automatically']), en);
    check('in 简体 the options use mainland words (普通话, 粤语), and Settings offers the same list', JSON.stringify(hans) === JSON.stringify(['en=英文', 'zh=普通话', 'yue=粤语', 'en-zh=英文夹杂普通话', 'en-yue=英文夹杂粤语', 'auto=自动侦测']) && settings.length === 6 && settings.map(x => x.split('=')[0]).join() === 'en,zh,yue,en-zh,en-yue,auto', { hans, settings });

    // 9. exam radar: add a date by hand, then remove it
    await part(['Add a date puts it on the exam radar', 'Remove takes it off the radar'], async () => {
    await page.goto(ORIGIN + '/#/home'); await page.waitForSelector('[data-act=adddate]');
    const before = await page.locator('.grid2 .card').nth(1).locator('li').count();
    await page.click('[data-act=adddate]'); await page.waitForSelector('#overlay form');
    await page.selectOption('#overlay select[name=course]', 'math2011'); await page.selectOption('#overlay select[name=kind]', 'Final');
    await page.fill('#overlay input[name=date]', '2026-11-30'); await page.fill('#overlay input[name=text]', 'Final, chapters 1 to 9');
    await page.click('#overlay button.btn.primary'); await page.waitForTimeout(500);
    const radar = page.locator('.grid2 .card').nth(1);
    const added = radar.locator('li', { hasText: 'Final, chapters 1 to 9' });
    const row = { count: await radar.locator('li').count(), text: await added.innerText().catch(() => ''), last: await radar.locator('li').last().innerText() };
    check('Add a date puts it on the exam radar, in date order, marked "Added by you" with Remove and Add to calendar', row.count === before + 1 && /Final/.test(row.text) && /MATH 2011, 30 Nov/.test(row.text) && /Added by you/.test(row.text) && /Remove/.test(row.text) && /Add to calendar/.test(row.text) && !/Said at/.test(row.text) && row.last === row.text, row);
    await added.locator('button', { hasText: 'Remove' }).click(); await page.waitForTimeout(400);
    check('Remove takes it off the radar', (await radar.locator('li').count()) === before && !(await radar.innerText()).includes('chapters 1 to 9'));
    });
    await ctx.close(); }

  /* ---------- sample mode, signed out: the shared page ---------- */
  { const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } }); await setConfig(ctx, { USE_MOCK: true });
    const page = await ctx.newPage(); page.on('pageerror', e => errs.push(e.message));
    await page.goto(ORIGIN + '/#/s/econ-w9'); await page.waitForSelector('.tools'); await page.waitForTimeout(200);
    check('a classmate reading shared notes sees 中文解釋 by default too', (await page.locator('.pt .zh').count()) > 3);
    // 8. Help
    const help = {};
    for (const lang of ['en', 'zh-Hant', 'zh-Hans']) { await page.evaluate(l => window.__sidenote.setLang(l), lang); await page.goto(ORIGIN + '/#/help'); await page.waitForSelector('h2'); help[lang] = { h2: await page.locator('h2').allInnerTexts(), body: await page.locator('.doc').innerText() }; }
    check('Help: no "登入中/登录中" heading and no "some servers use an invite code"', !help['zh-Hant'].h2.some(h => /登入中/.test(h)) && !help['zh-Hans'].h2.some(h => /登录中/.test(h)) && !/伺服器改用|服务器改用|Some servers/.test(help.en.body + help['zh-Hant'].body + help['zh-Hans'].body), { hant: help['zh-Hant'].h2[0], hans: help['zh-Hans'].h2[0] });
    check('Help: the section is "How to sign in" (怎樣登入 / 怎样登录) and says what this server asks for (the sample build: the invite code)', help.en.h2[0] === 'How to sign in' && help['zh-Hant'].h2[0] === '怎樣登入' && help['zh-Hans'].h2[0] === '怎样登录' && help.en.body.includes('Sign in with the invite code you were given.'), help.en.h2[0]);
    await ctx.close(); }
  { const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } }); await setConfig(ctx, { USE_MOCK: true, SIGN_IN: 'email' });
    const page = await ctx.newPage(); page.on('pageerror', e => errs.push(e.message));
    await page.goto(ORIGIN + '/#/help'); await page.waitForSelector('h2');
    const body = await page.locator('.doc').innerText();
    check('Help with email sign-in: the 6-digit code, and an invite code the first time', body.includes('Halfold sends you a 6-digit code') && body.includes('The first time, you also enter an invite code.'), body.slice(0, 300));
    await ctx.close(); }

  /* ---------- real-backend mode ---------- */
  const EXAMPLE = serverExample();
  const lec = (id, extra) => ({ id, course: 'c1', title: 'Week 3: Money and banking', date: 'Wed 18 Nov', duration: 3000, status: 'ready', ...extra });
  const LECTURES = [lec('l1', { status: 'processing' }), lec('l2', { status: 'failed' }), lec('l3', {}), lec('l4', { title: 'Week 4: With slides' })];
  const point = (t, slide, off) => ({ t, text: 'The Fed raised rates by 0.25 points.', zhHans: '美联储加息 0.25 个百分点。', zhHant: '聯儲局加息 0.25 個百分點。', slide, off });
  const DETAIL = { alerts: [], sections: [{ title: 'Money', start: 0, end: 3000, points: [point(10, null, false), point(20, null, false)] }], slides: [], transcript: [{ t: 10, text: 'The Fed' }], flashcards: [], quiz: [] };
  const SLIDED = { ...DETAIL, sections: [{ title: 'Money', slides: 'Slide 1', start: 0, end: 3000, points: [point(10, 1, true), point(20, 1, false)] }], slides: [{ n: 1, title: 'Money', image: null }] };
  const log = [];
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await setConfig(ctx, { USE_MOCK: false, POLL_MS: 60000 });
  let upcoming = [{ date: '2099-12-01', kind: 'Midterm', text: 'Midterm, chapters 1 to 4', course: 'ECON 2101', lecture: 'l3', t: 18 }];
  await ctx.route('**/*', async route => {
    const req = route.request(), u = new URL(req.url()), m = req.method(), j = (o, s = 200) => route.fulfill({ status: s, contentType: 'application/json', body: JSON.stringify(o) });
    if (!u.pathname.startsWith('/api/')) return serve(route, { USE_MOCK: false, POLL_MS: 60000 });
    const p = u.pathname.slice(4); log.push(m + ' ' + p + (req.postData() ? ' ' + req.postData() : ''));
    if (p === '/session') return j({ token: 'tok', user: { name: 'Mei' } });
    if (p === '/home') return j({ user: { name: 'Mei' }, courses: [{ id: 'c1', code: 'ECON 2101' }], lectures: LECTURES, upcoming, settings: { classLanguage: 'zh', zhDefault: true }, today: '2026-11-24' });
    if (p === '/shared/econ-w9') return EXAMPLE ? j(EXAMPLE) : j({ message: 'This link is no longer shared.' }, 404);
    const one = /^\/lectures\/(l\d)$/.exec(p);
    if (m === 'GET' && one) { const l = LECTURES.find(x => x.id === one[1]); return j({ lecture: l, detail: l.status === 'ready' ? (l.id === 'l4' ? SLIDED : DETAIL) : null }); }
    if (/^\/lectures\/l\d\/status$/.test(p)) return j({ status: 'processing' });
    if (m === 'POST' && p === '/upcoming') { const b = JSON.parse(req.postData()); const x = { date: b.date, kind: b.kind, text: b.text, course: 'ECON 2101', lecture: null, t: null, id: 'rd-1' }; upcoming = [...upcoming, x]; return j(x); }
    if (m === 'DELETE' && p === '/upcoming/rd-1') { upcoming = upcoming.filter(x => x.id !== 'rd-1'); return route.fulfill({ status: 204 }); }
    return j({ message: 'Not found' }, 404);
  });
  const page = await ctx.newPage(); page.on('pageerror', e => errs.push(e.message));
  await page.goto(ORIGIN + '/#/signin'); await page.fill('input[name=code]', 'abc'); await page.click('form.auth button'); await page.waitForSelector('.shell');

  // 6. the page that waits for the notes has a title
  const head = async id => { await page.goto(ORIGIN + '/#/lecture/' + id); await page.waitForSelector('.main .card'); await page.waitForTimeout(250);
    return { h1: await page.locator('.main h1').first().innerText().catch(() => ''), meta: await page.locator('.main .page-h p').first().innerText().catch(() => ''), box: await page.locator('.main .card h3').first().innerText() }; };
  const waiting = await head('l1'), failed = await head('l2');
  check('while the notes are written, the page has the lecture\'s title and course line above "Hal is writing your notes"', waiting.h1 === 'Week 3: Money and banking' && /^ECON 2101, Wed 18 Nov, 50 min/.test(waiting.meta) && waiting.box === 'Hal is writing your notes', waiting);
  check('a lecture whose notes failed has its title too', failed.h1 === 'Week 3: Money and banking' && failed.box === 'These notes could not be written', failed);

  // 7. "Only what is not on the slides" only with slides
  await page.goto(ORIGIN + '/#/lecture/l3'); await page.waitForSelector('.tools');
  const noSlides = await page.locator('.tools').innerText();
  await page.goto(ORIGIN + '/#/lecture/l4'); await page.waitForSelector('.tools');
  const withSlides = await page.locator('.tools').innerText();
  check('"Only what is not on the slides" is offered for a lecture with slides and not for one without', !/Only what is not on the slides/.test(noSlides) && /Only what is not on the slides/.test(withSlides), { noSlides, withSlides });

  // 4. Simplified explanations as the backend wrote them, for a student who reads 简体
  await part(['简体: 中文解释 on by default in the reader\'s script'], async () => {
  await page.evaluate(() => window.__sidenote.setLang('zh-Hans')); await page.goto(ORIGIN + '/#/lecture/l3'); await page.waitForSelector('.pt .zh', { timeout: 5000 });
  const hansZh = await page.locator('.pt .zh').first().innerText();
  check('简体: 中文解释 on by default in the reader\'s script, with mainland terms as the backend wrote them', hansZh === '美联储加息 0.25 个百分点。' && (await page.locator('.tools .zh-on').innerText({ timeout: 5000 })).includes('中文解释'), hansZh);
  });
  await page.evaluate(() => window.__sidenote.setLang('en'));

  // 9. the radar talks to the backend
  await part(['Add a date sends POST /upcoming; Remove sends DELETE /upcoming/:id'], async () => {
  await page.goto(ORIGIN + '/#/home'); await page.waitForSelector('[data-act=adddate]');
  await page.click('[data-act=adddate]'); await page.waitForSelector('#overlay form');
  await page.selectOption('#overlay select[name=kind]', 'Deadline'); await page.fill('#overlay input[name=date]', '2099-11-30'); await page.fill('#overlay input[name=text]', 'Essay due');
  await page.click('#overlay button.btn.primary'); await page.waitForTimeout(400);
  const posted = log.find(x => x.startsWith('POST /upcoming'));
  const items = await page.locator('.grid2 .card').nth(1).locator('li').allInnerTexts();
  await page.locator('.grid2 .card').nth(1).locator('li', { hasText: 'Essay due' }).locator('button', { hasText: 'Remove' }).click(); await page.waitForTimeout(400);
  check('Add a date sends POST /upcoming {course, date, kind, text}; Remove sends DELETE /upcoming/:id', posted === 'POST /upcoming {"course":"c1","kind":"Deadline","date":"2099-11-30","text":"Essay due"}' && items.length === 2 && /Essay due/.test(items[0]) && /Said at 0:18/.test(items[1]) && log.includes('DELETE /upcoming/rd-1'), { posted, items });
  });

  // 5. the example notes from our server's own code: they open, read only, without "Save to my lectures"
  await page.goto(ORIGIN + '/#/s/econ-w9'); await page.waitForTimeout(800);
  const ex = { h1: await page.locator('h1').first().innerText().catch(() => ''), zh: await page.locator('.pt .zh').count(), save: await page.locator('text=Save to my lectures').count(), bar: await page.locator('.shared-bar').innerText().catch(() => '') };
  check('the example notes (GET /shared/econ-w9 as our server answers without a database row) open with 中文解釋 and no Save button', !!EXAMPLE && ex.h1 === 'Opportunity cost and comparative advantage' && ex.zh > 3 && ex.save === 0 && /Halfold shared these notes/.test(ex.bar), ex);

  check('no page errors', errs.length === 0, errs);
  await browser.close();
  console.log(`\n${results.filter(Boolean).length} of ${results.length} checks passed`);
})().catch(e => { console.error('SCRIPT ERROR', String(e.message).slice(0, 1200)); process.exit(1); });
