// Interface language: English / 简体 / 繁體. A genuinely first visit follows the browser language, earlier users stay in English,
// an old saved "zh" is Traditional, the language button and Settings offer three choices, and the Simplified screens carry no
// character of the Traditional-to-Simplified table (src/i18n/t2s.ts) while backend text is left exactly as sent.
const fs = require('fs'), path = require('path');
const { chromium, ORIGIN } = require('./harness');
const results = [];
const check = (name, ok, detail) => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || detail === undefined ? '' : '  -> ' + JSON.stringify(detail)}`); };

// The Traditional characters the converter knows about, read from the table itself.
const src = fs.readFileSync(path.join(__dirname, '..', 'src/i18n/t2s.ts'), 'utf8');
const BAD = [...new Set([...(/T2S_CH[^=]*= (\{.*\});/.exec(src) || [, '{}'])[1].matchAll(/"(.)": "(.)"/gu)].filter(m => m[1] !== m[2]).map(m => m[1]))];
const trad = s => [...s].filter(c => BAD.includes(c));

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const errs = [];
  const open = async (locale, pre) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale });
    const page = await ctx.newPage(); page.on('pageerror', e => errs.push(e.message));
    if (pre) { await page.goto(ORIGIN + '/'); await page.evaluate(() => localStorage.removeItem('sidenote.lang')); await page.evaluate(pre); }
    await page.goto(ORIGIN + '/'); await page.reload(); await page.waitForTimeout(300);
    return { ctx, page };
  };
  const state = page => page.evaluate(() => ({ lang: window.__sidenote.LANG, html: document.documentElement.lang, saved: localStorage.getItem('sidenote.lang'), body: document.body.innerText }));
  const visible = page => page.evaluate(() => { const c = document.body.cloneNode(true); c.querySelectorAll('[data-notr]').forEach(e => e.remove()); let s = c.textContent;
    document.querySelectorAll('[placeholder],[aria-label],[title]').forEach(e => { if (!e.closest('[data-notr]')) s += ' ' + ['placeholder', 'aria-label', 'title'].map(a => e.getAttribute(a) || '').join(' '); }); return s; });

  let r = await open('zh-CN'), s = await state(r.page);
  check('new visitor, zh-CN browser: Simplified', s.lang === 'zh-Hans' && s.html === 'zh-Hans' && /简体|课堂/.test(s.body), [s.lang, s.html]);
  await r.ctx.close();
  r = await open('zh-HK'); s = await state(r.page); check('new visitor, zh-HK browser: Traditional', s.lang === 'zh-Hant' && s.html === 'zh-Hant', s.lang); await r.ctx.close();
  r = await open('zh-TW'); s = await state(r.page); check('new visitor, zh-TW browser: Traditional', s.lang === 'zh-Hant', s.lang); await r.ctx.close();
  r = await open('en-US'); s = await state(r.page); check('new visitor, en-US browser: English', s.lang === 'en' && s.html === 'en', s.lang); await r.ctx.close();
  r = await open('zh-CN', () => localStorage.setItem('sidenote.session', JSON.stringify({ token: 't', user: { name: 'T' } }))); s = await state(r.page);
  check('earlier user (session set, no lang), zh-CN browser: stays English and "en" is saved', s.lang === 'en' && s.saved === 'en', [s.lang, s.saved]); await r.ctx.close();
  r = await open('zh-CN', () => localStorage.setItem('sidenote.recTip', '1')); s = await state(r.page);
  check('earlier user (another sidenote.* key), zh-CN browser: stays English', s.lang === 'en', s.lang); await r.ctx.close();
  r = await open('en-US', () => localStorage.setItem('sidenote.lang', 'zh')); s = await state(r.page);
  check('old saved "zh" opens in Traditional', s.lang === 'zh-Hant' && s.html === 'zh-Hant', s.lang); await r.ctx.close();
  r = await open('en-US', () => localStorage.setItem('sidenote.lang', 'zh-Hans')); s = await state(r.page);
  check('saved zh-Hans wins over an English browser', s.lang === 'zh-Hans', s.lang); await r.ctx.close();

  for (const [loc, want] of [['zh-CN', 'zh-Hans'], ['zh-HK', 'zh-Hant']]) {
    r = await open(loc); await r.page.goto(ORIGIN + '/#/signin'); await r.page.fill('input[name=code]', 'x'); await r.page.click('form.auth button'); await r.page.waitForSelector('.shell');
    await r.page.reload(); await r.page.waitForSelector('.shell'); s = await state(r.page);
    check(`new ${loc} visitor signs in and reloads: still ${want}`, s.lang === want && s.html === want && s.saved === want, [s.lang, s.saved]); await r.ctx.close();
  }

  // One Simplified visit through the pages.
  r = await open('zh-CN'); const page = r.page;
  const opts = await page.locator('.lang option').allInnerTexts();
  check('the language button offers EN, 简体, 繁體', JSON.stringify(opts) === '["EN","简体","繁體"]', opts);
  await page.goto(ORIGIN + '/#/signin'); await page.fill('input[name=code]', 'x'); await page.click('form.auth button'); await page.waitForSelector('.shell');
  await page.evaluate(() => { window.__sidenote.DATA.lectures[0].title = '週 9 測試'; });
  const seen = {};
  for (const h of ['#/', '#/home', '#/lecture/econ-w9', '#/settings', '#/new']) { await page.goto(ORIGIN + '/' + h); await page.waitForTimeout(500); seen[h] = trad(await visible(page)); }
    await page.goto(ORIGIN + '/#/settings'); await page.waitForTimeout(400);
  const so2 = await page.evaluate(() => [...document.querySelectorAll('.main select[data-notr]')].map(x => [...x.options].map(o => o.textContent)).find(a => a[0] === 'English'));
  check('Settings has Interface language with three options', so2 && so2.join('|') === 'English|简体中文|繁體中文', so2);
  check('Simplified pages carry no character from the Traditional-to-Simplified table', Object.values(seen).every(a => !a.length), seen);
  await page.goto(ORIGIN + '/#/home'); await page.waitForTimeout(400);
  const rs = await page.evaluate(() => window.__sidenote.trs('The recording of this lecture is kept until ' + window.__sidenote.dayMon('2026-11-16') + ', 5 more days. The notes stay after that.'));
  check('a rule sentence (ZHR) and a date come out in Simplified', /月/.test(rs) && /[一-鿿]/.test(rs) && !trad(rs).length, rs);
  const titles = await page.locator('[data-notr]').allInnerTexts();
  check('backend text stays as sent in Simplified', titles.some(x => x.includes('週 9 測試')), titles.slice(0, 5));
  await page.goto(ORIGIN + '/#/lecture/econ-w9'); await page.waitForTimeout(400);
  check('lecture title stays as sent on the lecture page', (await page.locator('.page-h h1').innerText()) === '週 9 測試');
  await page.selectOption('.lang', 'zh-Hant'); await page.waitForTimeout(300);
  check('switching to 繁體 changes the interface and the saved value', (await state(page)).saved === 'zh-Hant' && /筆記/.test(await page.locator('.tabs button').first().innerText()));
  await page.selectOption('.lang', 'en'); await page.waitForTimeout(300);
  check('switching to EN restores English', (await state(page)).html === 'en' && (await page.locator('.tabs button').first().innerText()) === 'Notes', await page.locator('.tabs button').first().innerText());
  check('no page errors', !errs.length, errs);
  await r.ctx.close(); await browser.close();
  console.log(`${results.filter(Boolean).length} of ${results.length} checks passed`);
  process.exit(results.every(Boolean) ? 0 : 1);
})().catch(e => { console.error('SCRIPT ERROR', String(e.message).slice(0, 600)); process.exit(1); });
