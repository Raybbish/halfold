// Formulas (test of halfold.app, 2026-11-18): the notes model writes them in plain text (Σ_{k=0}^{N-1} X(k) e^{-i 2π k/N},
// x^2), and the notes, 中文解釋, flashcards and quiz show them with real superscripts and subscripts (src/ui/Fx.tsx). Nothing
// else in the text is read as markup. Real-backend mode (fake API by request interception), built app only.
const { chromium, ORIGIN, serve, setConfig } = require('./harness');
const results = [];
const check = (name, ok, detail) => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || detail === undefined ? '' : '  -> ' + JSON.stringify(detail)}`); };

const LEC = { id: 'l1', course: 'c1', title: 'Week 3', date: 'Tue 10 Nov', duration: 300, status: 'ready' };
const DETAIL = { alerts: [], slides: [], transcript: [{ t: 0, text: 'line 0' }],
  sections: [{ title: 'Fourier', start: 0, end: 300, points: [
    { t: 10, text: 'The DFT is Σ_{k=0}^{N-1} X(k) e^{-i 2π k/N}, and x^2 grows.', zhHant: '離散傅立葉變換：e^{-i 2π k/N}', zhHans: '离散傅立叶变换：e^{-i 2π k/N}', off: false, slide: null },
    { t: 20, text: '<b>not bold</b> and a snake_case_name and 3 ^ 4 stay as written.', off: false, slide: null }] }],
  flashcards: [{ q: 'What is E = mc^2?', a: 'Energy, with c^{2} the speed of light squared.' }],
  quiz: [{ q: 'Which is x_{1}?', opts: ['a^{2}', 'b', 'c', 'd'], a: 0, why: 'Because y^{3} is not.', t: 10 }] };

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const errs = [];
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const cfg = { USE_MOCK: false, POLL_MS: 50 };
  await setConfig(ctx, cfg);
  await ctx.route('**/*', route => {
    const u = new URL(route.request().url()), j = (b, s = 200) => route.fulfill({ status: s, contentType: 'application/json', body: JSON.stringify(b) });
    if (!u.pathname.startsWith('/api/')) return serve(route, cfg);
    const p = u.pathname.slice(4);
    if (p === '/session') return j({ token: 't', user: { name: 'Jasper' } });
    if (p === '/home') return j({ user: { name: 'Jasper' }, courses: [{ id: 'c1', code: 'ELEC 3100', name: '' }], lectures: [LEC], upcoming: [], settings: { classLanguage: 'en', zhDefault: false } });
    if (p === '/lectures/l1') return j({ lecture: LEC, detail: DETAIL });
    return j({ message: 'Not found' }, 404);
  });
  const page = await ctx.newPage(); page.on('pageerror', e => errs.push(e.message));
  await page.goto(ORIGIN + '/#/signin'); await page.fill('input[name=code]', 'abc'); await page.click('form.auth button'); await page.waitForSelector('.shell');
  await page.goto(ORIGIN + '/#/lecture/l1'); await page.waitForSelector('.pt');
  const marks = sel => page.evaluate(s => { const e = document.querySelector(s); return e && { sup: [...e.querySelectorAll('sup')].map(x => x.textContent), sub: [...e.querySelectorAll('sub')].map(x => x.textContent), b: e.querySelectorAll('b').length, text: e.textContent }; }, sel);

  const first = await marks('.pt .body');   // the first point
  check('a note shows Σ_{k=0}^{N-1} ... e^{...} and x^2 with superscripts and subscripts, no braces left', first && JSON.stringify(first.sup) === '["N-1","-i 2π k/N","2"]' && JSON.stringify(first.sub) === '["k=0"]'
    && !/[{}^]/.test(first.text) && first.text.includes('The DFT is Σk=0N-1 X(k) e-i 2π k/N, and x2 grows.'), first);
  const second = await page.evaluate(() => { const e = document.querySelectorAll('.pt .body')[1]; return { html: e.innerHTML, text: e.textContent, b: e.querySelectorAll('b').length, subs: e.querySelectorAll('sub,sup').length }; });
  check('the rest of the text stays text: <b> is shown as typed, snake_case and "3 ^ 4" are left alone', second.b === 0 && second.subs === 0 && second.text.includes('<b>not bold</b> and a snake_case_name and 3 ^ 4 stay as written.'), second);

  await page.locator('.tools input[type=checkbox]').nth(1).check(); await page.waitForTimeout(200);
  const zh = await marks('.pt .zh');
  check('中文解釋 shows the formula the same way', zh && JSON.stringify(zh.sup) === '["-i 2π k/N"]', zh);

  await page.click('.tabs button:has-text("Flashcards")'); await page.waitForSelector('.flip');
  const card = { q: await marks('.flip .f:not(.b)'), a: await marks('.flip .f.b') };
  check('a flashcard shows mc^2 and c^{2} as superscripts', JSON.stringify(card.q.sup) === '["2"]' && JSON.stringify(card.a.sup) === '["2"]' && card.q.text === 'What is E = mc2?', card);

  await page.click('.tabs button:has-text("Quiz")'); await page.waitForSelector('.qz .opt');
  const q = await marks('.qz h3'), opt = await marks('.qz .opt');
  await page.click('.qz .opt'); await page.waitForSelector('.why');
  const why = await marks('.why');
  check('the quiz question, its options and the explanation show them too', JSON.stringify(q.sub) === '["1"]' && JSON.stringify(opt.sup) === '["2"]' && why.sup.includes('3'), { q, opt, why });

  const css = await page.evaluate(() => { const s = document.querySelector('.qz .opt sup'); return s && getComputedStyle(s).lineHeight; });
  check('superscripts do not push the lines apart (line-height 0)', css === '0px', css);
  check('no page errors', errs.length === 0, errs);
  await browser.close();
  const n = results.filter(Boolean).length; console.log(`\n${n} of ${results.length} checks passed`); process.exit(n === results.length ? 0 : 1);
})().catch(e => { console.error('SCRIPT ERROR', String(e.message).slice(0, 1200)); process.exit(1); });
