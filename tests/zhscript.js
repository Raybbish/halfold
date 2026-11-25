// Adapted from tests/original/zhscript.js for the React build (see tests/harness.js). Only how the page is loaded and configured changed; the checks are as they were.
// 中文解釋 in Traditional or Simplified: the reader's choice, on the lecture page, in Settings and on shared pages.
const fs = require('fs');
const { chromium, ORIGIN, serve, setConfig } = require('./harness');   // was: playwright from /opt/npm-tools, page from argv[2]
const FILE = ORIGIN + '/', CFG = { USE_MOCK: false };   // was: 'file://' + argv[2] and SRC.replace('USE_MOCK: true', 'USE_MOCK: false')
const results = []; const check = (name, ok, detail) => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail !== undefined ? '  -> ' + JSON.stringify(detail) : ''}`); };
const HANT = '機會成本是你放棄的「最好的那一個」選項的價值，不是所有選項加起來。', HANS = '机会成本是你放弃的“最好的那一个”选项的价值，不是所有选项加起来。';

(async () => {
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
  fs.mkdirSync('shots6', { recursive: true });
  const first = page => page.locator('.pt .zh').first().innerText();
  const signIn = async (page, base) => { await page.goto(base + '#/signin'); await page.fill('input[name=code]', 'x'); await page.click('form.auth button'); await page.waitForSelector('.shell'); };

  console.log('=== sample build ===');
  { const ctx = await browser.newContext({ viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true, locale: 'en-US' }); const page = await ctx.newPage(); const errs = []; page.on('pageerror', e => errs.push(e.message));
    await signIn(page, FILE); await page.goto(FILE + '#/lecture/econ-w9'); await page.waitForSelector('.tabs');
    /* 中文解釋 is on by default since the retest of 2026-11-23: turned off, the explanations and the switch go. */
    await page.locator('.tools input[name=zh]').uncheck(); await page.waitForTimeout(200);
    check('switch is hidden while 中文解釋 is turned off', (await page.locator('.seg2').count()) === 0 && (await page.locator('.pt .zh').count()) === 0);
    await page.locator('.tools input[name=zh]').check(); await page.waitForTimeout(200);
    check('an English-language browser starts with Traditional', (await first(page)) === HANT && (await page.locator('.seg2 button.on').innerText()) === '繁', await first(page));
    const all = await page.locator('.pt .zh').allInnerTexts();
    check('all 16 sample explanations convert cleanly (no Simplified-only character left)', all.length === 16 && !/[机会弃个选项价来隐读学费没赚资样响决无论么应虑门钱经较边际单额时产现术两种组横轴递内济长绝对优势题国师强调见错误贸条间换双获试类讲给与课“”]/.test(all.join('')), all.slice(0, 3));
    await page.screenshot({ path: 'shots6/m-hant.png' });
    await page.locator('.seg2 button', { hasText: '简' }).tap(); await page.waitForTimeout(300);
    check('tapping 简 switches every explanation to Simplified', (await first(page)) === HANS && (await page.locator('.pt .zh').first().getAttribute('lang')) === 'zh-Hans');
    await page.screenshot({ path: 'shots6/m-hans.png' });
    const md = await page.evaluate(() => notesMarkdown()); check('Markdown export follows the choice', md.includes(HANS) && !md.includes(HANT));
    await page.reload(); await page.waitForSelector('.tabs'); await page.locator('.tools input[name=zh]').check(); await page.waitForTimeout(200);
    check('the choice is remembered after a reload', (await first(page)) === HANS);
    await page.goto(FILE + '#/settings'); await page.waitForSelector('select[name=zs]');
    check('Settings shows the same choice', (await page.locator('select[name=zs]').inputValue()) === 'hans'); await page.screenshot({ path: 'shots6/m-settings.png' });
    await page.selectOption('select[name=zs]', 'hant'); await page.click('form button.btn.primary'); await page.waitForSelector('.toast');
    await page.goto(FILE + '#/lecture/econ-w9'); await page.waitForSelector('.tabs'); await page.locator('.tools input[name=zh]').check(); await page.waitForTimeout(200);
    check('changing it in Settings changes the lecture page', (await first(page)) === HANT);
    await page.selectOption('.mtop .lang', 'zh-Hant'); await page.goto(FILE + '#/settings'); await page.waitForSelector('select[name=zs]');
    check('the Settings label has a Chinese version', (await page.locator('label.field', { has: page.locator('select[name=zs]') }).locator('span').innerText()) === '中文解釋顯示為');
    if (errs.length) check('no page errors', false, errs); await ctx.close(); }

  /* Nothing chosen yet: the interface language decides, so a 简体 interface does not show 繁體 explanations (test of 2026-11-18). */
  { const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'en-GB' }); const page = await ctx.newPage();
    await signIn(page, FILE); await page.evaluate(() => window.__sidenote.setLang('zh-Hans')); await page.goto(FILE + '#/lecture/econ-w9'); await page.waitForSelector('.tabs'); await page.locator('.tools input[name=zh]').check(); await page.waitForTimeout(200);
    check('with no choice made, an English browser with the interface in 简体 shows the explanations in Simplified', (await first(page)) === HANS && (await page.locator('.seg2 button.on').innerText()) === '简', await first(page));
    await ctx.close(); }

  { const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'zh-CN' }); const page = await ctx.newPage();
    await page.goto(FILE + '#/s/econ-w9'); await page.waitForSelector('.shared-bar'); await page.locator('.tools input[name=zh]').check(); await page.waitForTimeout(200);
    check('a browser set to Simplified Chinese starts with Simplified, on a shared page without signing in', (await first(page)) === HANS && (await page.locator('.seg2 button.on').innerText()) === '简');
    await page.locator('.seg2 button', { hasText: '繁' }).click(); await page.waitForTimeout(200);
    check('a reader who is not signed in can switch too', (await first(page)) === HANT); await page.screenshot({ path: 'shots6/d-shared.png' }); await ctx.close(); }

  console.log('\n=== real backend ===');
  async function real(points, settings, fn) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'en-US' }); await setConfig(ctx, CFG); const page = await ctx.newPage(); const puts = [];
    await ctx.route('**/*', route => { const req = route.request(), u = new URL(req.url()), j = o => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
      if (!u.pathname.startsWith('/api/')) return serve(route, CFG);
      const p = u.pathname.slice(4), lec = { id: 'l1', course: 'c1', title: 'Week 9', date: 'Tue 10 Nov', duration: 300, status: 'ready' };
      if (p === '/session') return j({ token: 't', user: { name: 'Jasper' } });
      if (p === '/home') return j({ user: { name: 'Jasper' }, courses: [{ id: 'c1', code: 'ECON 1001', name: 'Micro' }], lectures: [lec], upcoming: [], settings });
      if (p === '/plans') return j({ plans: [], current: null });
      if (p === '/settings') { puts.push(JSON.parse(req.postData())); return route.fulfill({ status: 204 }); }
      if (p === '/lectures/l1') return j({ lecture: lec, detail: { alerts: [], sections: [{ title: 'Part one', start: 0, end: 300, points }], slides: [], transcript: [{ t: 0, text: 'line' }], flashcards: [], quiz: [] } });
      return route.fulfill({ status: 404, contentType: 'application/json', body: '{"message":"Not found"}' }); });
    await signIn(page, ORIGIN + '/'); await page.goto(ORIGIN + '/#/lecture/l1'); await page.waitForSelector('.tabs'); await page.waitForTimeout(200);
    await fn(page, puts); await ctx.close(); }
  const both = [{ t: 10, text: 'A point', zhHant: '繁體說明', zhHans: '简体说明', off: false, slide: null }];
  await real(both, { classLanguage: 'en', zhDefault: true, zhScript: 'hans' }, async (page, puts) => {
    check('the account setting decides the starting form', (await first(page)) === '简体说明');
    await page.locator('.seg2 button', { hasText: '繁' }).click(); await page.waitForTimeout(400);
    check('switching on the lecture page saves the choice to the account', (await first(page)) === '繁體說明' && puts.length === 1 && puts[0].zhScript === 'hant' && puts[0].name === 'Jasper' && puts[0].zhDefault === true && puts[0].classLanguage === 'en', puts);
    await page.goto(ORIGIN + '/#/settings'); await page.waitForSelector('select[name=zs]'); await page.selectOption('select[name=zs]', 'hans'); await page.click('form button.btn.primary'); await page.waitForSelector('.toast');
    check('saving Settings sends zhScript with the other fields', puts.length === 2 && puts[1].zhScript === 'hans', puts[1]); });
  await real([{ t: 10, text: 'A point', zh: '只有一種寫法', off: false, slide: null }], { classLanguage: 'en', zhDefault: true }, async page => {
    check('a backend that sends only point.zh still works: text shown, no switch', (await first(page)) === '只有一種寫法' && (await page.locator('.seg2').count()) === 0); });
  await real([{ t: 10, text: 'A point', zhHant: '只有繁體', off: false, slide: null }], { classLanguage: 'en', zhDefault: true, zhScript: 'hans' }, async page => {
    check('if only one form exists it is shown whatever the choice', (await first(page)) === '只有繁體' && (await page.locator('.seg2').count()) === 0); });

  await browser.close(); console.log(`\n${results.filter(Boolean).length} of ${results.length} checks passed`);
})().catch(e => { console.error('SCRIPT ERROR', String(e.message).slice(0, 900)); process.exit(1); });
