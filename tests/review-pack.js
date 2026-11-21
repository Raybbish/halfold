// A review pack is made in the background (batch 2, test of 2026-11-18: a locked dialog for minutes): the pack page says
// it is being made and checks by itself; another page gets a notice with a link when it is ready; a reload picks the check
// up again; a pack the server could not make (502) says so; Chinese. Real-backend mode (fake API by request interception).
const { chromium, ORIGIN, serve, setConfig } = require('./harness');
const results = [];
const check = (name, ok, detail) => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || detail === undefined ? '' : '  -> ' + JSON.stringify(detail)}`); };

const PACK = { status: 'ready', hints: [{ t: 18, kind: 'Midterm', text: 'Midterm on 26 November.', lecture: 'Week 9', lectureId: 'l1' }],
  sheet: [{ topic: 'Opportunity cost', points: [{ text: 'The next best thing you give up.', off: false, t: 252, lecture: 'Week 9', lectureId: 'l1' }] }],
  exam: [{ q: 'Which is the opportunity cost?', opts: ['a', 'b', 'c', 'd'], a: 1, why: 'It is what you give up.', lectureId: 'l1' }] };

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const errs = [];
  async function open(be, fn) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const cfg = { USE_MOCK: false, POLL_MS: 100 };
    await setConfig(ctx, cfg);
    await ctx.route('**/*', route => {
      const req = route.request(), u = new URL(req.url()), j = (b, s = 200) => route.fulfill({ status: s, contentType: 'application/json', body: JSON.stringify(b) });
      if (!u.pathname.startsWith('/api/')) return serve(route, cfg);
      const p = u.pathname.slice(4), m = req.method(); be.log.push(m + ' ' + p);
      if (p === '/session') return j({ token: 't', user: { name: 'Jasper' } });
      if (p === '/home') return j({ user: { name: 'Jasper' }, courses: [{ id: 'c1', code: 'ECON 1001', name: 'Micro' }], lectures: [{ id: 'l1', course: 'c1', title: 'Week 9', date: 'Tue 10 Nov', duration: 300, status: 'ready' }], upcoming: [], settings: { classLanguage: 'en', zhDefault: false } });
      if (m === 'POST' && p === '/courses/c1/review-pack') { be.made = true; be.polls = 0; return j({ status: 'processing' }); }
      if (m === 'GET' && p === '/courses/c1/review-pack') {
        if (!be.made) return j({ status: 'none' });
        be.polls++;
        if (be.polls < be.slow) return j({ status: 'processing' });
        if (be.fail) { be.made = false; return j({ message: 'Hal could not make the review pack just now. Try again in a moment.' }, 502); }
        return j(PACK);
      }
      return j({ message: 'Not found' }, 404);
    });
    const page = await ctx.newPage(); page.on('pageerror', e => errs.push(e.message));
    await page.goto(ORIGIN + '/#/signin'); await page.fill('input[name=code]', 'abc'); await page.click('form.auth button'); await page.waitForSelector('.shell');
    try { await fn(page); } finally { await ctx.close(); }
  }
  const make = async page => { await page.goto(ORIGIN + '/#/pack/c1'); await page.waitForSelector('.main .card button.btn.primary'); await page.click('.main .card button.btn.primary'); await page.waitForSelector('.main .card.wait'); };
  const card = page => page.locator('.main .card.wait').innerText().then(x => x.replace(/\s+/g, ' ')).catch(() => '');

  { const be = { log: [], slow: 12 }; await open(be, async page => {
    await make(page);
    const c = { text: await card(page), modal: await page.locator('#overlay .modal').count(), bar: await page.locator('.main .card.wait [role=progressbar]').count(), again: await page.locator('.main button:text-is("Check again")').count() };
    check('Make review pack: no locked window; the page says the pack is being made, with a bar, and checks by itself', c.modal === 0 && c.text.includes('Hal is building your review pack') && c.text.includes('You do not have to wait here') && c.bar === 1 && c.again === 0, c);
    await page.goto(ORIGIN + '/#/home'); await page.waitForSelector('.shell');
    await page.waitForSelector('a.toast:has-text("Your review pack is ready.")', { timeout: 15000 }).catch(() => {});
    const href = await page.locator('a.toast:has-text("Your review pack is ready.")').getAttribute('href').catch(() => null);
    check('on another page, a notice with a link says when the pack is ready', href === '#/pack/c1', href);
    await page.click('a.toast:has-text("Your review pack is ready.")'); await page.waitForSelector('.pk');
    check('the link opens the pack, ready, without asking again', (await page.locator('.pk').innerText()).includes('Opportunity cost') && be.log.filter(x => x === 'POST /courses/c1/review-pack').length === 1);
  }); }

  { const be = { log: [], slow: 15 }; await open(be, async page => {
    await make(page); await page.reload(); await page.waitForSelector('.main .card.wait');
    const again = await page.locator('.main button:text-is("Check again")').count();
    await page.waitForSelector('.pk', { timeout: 15000 }).catch(() => {});
    check('a reload while the pack is made shows it being made and keeps checking until it is there', again === 0 && (await page.locator('.pk').count()) === 1, again);
  }); }

  { const be = { log: [], slow: 3, fail: true }; await open(be, async page => {
    await make(page);
    await page.waitForSelector('.toast.bad', { timeout: 10000 }).catch(() => {});
    const t = await page.locator('.toast.bad').last().innerText().catch(() => ''); await page.waitForTimeout(300);
    check('a pack the server could not make (502): its message, and the page offers to make it again', t === 'Hal could not make the review pack just now. Try again in a moment.' && (await page.locator('.main button:text-is("Make review pack")').count()) === 1, t);
  }); }

  { const be = { log: [], slow: 1000 }; await open(be, async page => {
    await page.evaluate(() => window.__sidenote.setLang('zh-Hant'));
    await make(page);
    const c = await card(page);
    check('in Chinese', c.includes('Hal 正在製作你的溫習包') && c.includes('不用在這裡等。這個頁面會自動更新，溫習包整理好時 Halfold 會通知你。'), c);
  }); }

  check('no page errors', errs.length === 0, errs);
  await browser.close();
  const n = results.filter(Boolean).length; console.log(`\n${n} of ${results.length} checks passed`); process.exit(n === results.length ? 0 : 1);
})().catch(e => { console.error('SCRIPT ERROR', String(e.message).slice(0, 1200)); process.exit(1); });
