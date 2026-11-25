// A limit of the plan (test of halfold.app, 2026-11-18): a new lecture or review pack over the month's limit (the server
// answers 429) opens a window that explains it and offers the plans, instead of a notice that is gone in a few seconds;
// New lecture and Settings show this month's lectures when /home gives them (usage.lecturesThisMonth / lecturesLimit);
// the server's sentence and the count in Chinese; the plan cards in the reader's language (batch 2: our server writes them
// in fixed sentences, server/src/billing.ts plans()). Real-backend mode (fake API by request interception), built app only.
const { chromium, ORIGIN, serve, setConfig } = require('./harness');
const results = [];
const check = (name, ok, detail) => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || detail === undefined ? '' : '  -> ' + JSON.stringify(detail)}`); };

const LECTURES = 'You have used the 4 lectures that Free includes this month. Choose Plus in Settings for more lectures, or wait until 1 Dec.';
const PACKS = 'You have made the 1 review pack that Free includes this month. Choose Plus in Settings for more review packs, or wait until 1 Dec.';
const USAGE = { minutesToday: 10, minutesLimit: 90, lecturesThisMonth: 4, lecturesLimit: 4 };
/* GET /plans as server/src/billing.ts writes it for a student who paid for a month of Plus (billing.test.ts), and one
   sentence it never writes. */
const PLANS = { current: 'plus-month', plans: [
  { id: 'free', name: 'Free', priceText: 'Free', features: ['90 minutes of live recording a day', '4 lectures a month', '1 review pack a month', 'Recordings kept for 30 days'] },
  { id: 'plus-month', name: 'Plus for a month', priceText: 'HK$98 for 30 days', features: ['Paid until 1 Dec 2026', '240 minutes of live recording a day', '40 lectures a month', 'Unlimited review packs', 'Recordings kept for good', 'Pay once by card, Alipay or WeChat Pay. Does not renew.'] },
  { id: 'plus-semester', name: 'Plus for a semester', priceText: 'HK$348 for 120 days', features: ['Adds 120 days after 1 Dec 2026', 'Pay once by card, Alipay or WeChat Pay. Does not renew.', 'A sentence nobody translated.'] }] };

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const errs = [];
  async function open(fn, o = {}) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const cfg = { USE_MOCK: false, POLL_MS: 50 }, be = { posts: [] };
    await setConfig(ctx, cfg);
    await ctx.addInitScript(() => { try { localStorage.setItem('sidenote.recTip', '1'); } catch (e) {} });
    await ctx.route('**/*', route => {
      const req = route.request(), u = new URL(req.url()), j = (b, s = 200) => route.fulfill({ status: s, contentType: 'application/json', body: JSON.stringify(b) });
      if (!u.pathname.startsWith('/api/')) return serve(route, cfg);
      const p = u.pathname.slice(4), m = req.method();
      if (p === '/session') return j({ token: 't', user: { name: 'Jasper' } });
      if (p === '/home') return j({ user: { name: 'Jasper' }, courses: [{ id: 'c1', code: 'ECON 1001', name: 'Micro' }], lectures: [], upcoming: [], settings: { classLanguage: 'en', zhDefault: false }, usage: o.usage === undefined ? USAGE : o.usage });
      if (p === '/plans') return j(o.plans || { plans: [], current: 'free' });
      if (m === 'POST' && p === '/checkout') return j({ url: null });   // the server without a Stripe key
      if (m === 'POST' && p === '/lectures') { be.posts.push(JSON.parse(req.postData())); return j({ message: LECTURES }, 429); }
      if (m === 'GET' && p === '/courses/c1/review-pack') return j({ status: 'none' });
      if (m === 'POST' && p === '/courses/c1/review-pack') return j({ message: PACKS }, 429);
      return j({ message: 'Not found' }, 404);
    });
    const page = await ctx.newPage(); page.on('pageerror', e => errs.push(e.message));
    await page.goto(ORIGIN + '/#/signin'); await page.fill('input[name=code]', 'abc'); await page.click('form.auth button'); await page.waitForSelector('.shell');
    try { await fn(page, be); } finally { await ctx.close(); }
  }
  /* The limit window (not the "building your review pack" one that comes first): its title in English or Chinese. */
  const win = async page => { await page.waitForFunction(() => /limit of your plan|上限/.test((document.querySelector('#overlay h3') || {}).textContent || ''), null, { timeout: 5000 }).catch(() => {});
    return (await page.locator('#overlay').innerText().catch(() => '')).replace(/\s+/g, ' ').trim(); };

  await open(async (page, be) => {
    await page.goto(ORIGIN + '/#/new'); await page.waitForSelector('.page-h');
    const head = (await page.locator('.page-h').innerText()).replace(/\s+/g, ' ');
    check('New lecture shows the lectures used this month under the recording minutes', head.includes('10 of 90 recording minutes used today') && head.includes('4 of 4 lectures used this month'), head);
    await page.click('.choice button:has-text("Video link")'); await page.fill('input[type=url]', 'https://example.com/lecture.mp4'); await page.click('form.card button.btn.blue');
    const w = await win(page);
    check('a new lecture over the month\'s limit opens a window: the plan limit, the server\'s sentence, the count and what stays', w.includes('You have reached the limit of your plan') && w.includes(LECTURES) && w.includes('4 of 4 lectures used this month')
      && w.includes('Everything you already have stays') && be.posts.length === 1, w);
    check('no red notice under the form, and the button works again', (await page.locator('form.card .err').count()) === 0 && !(await page.locator('form.card button.btn.blue').isDisabled()));
    await page.click('#overlay a:text-is("See the plans")'); await page.waitForSelector('.shell');
    check('See the plans closes the window and opens Settings', page.url().endsWith('#/settings') && (await page.locator('#overlay h3').count()) === 0, page.url());
    const settings = (await page.locator('.main').innerText()).replace(/\s+/g, ' ');
    check('Settings shows the lectures used this month too', settings.includes('4 of 4 lectures used this month'), settings.slice(0, 300));
  });

  await open(async page => {
    await page.goto(ORIGIN + '/#/home'); await page.click('.rec-btn');
    const w = await win(page);
    check('Record on Home over the limit opens the same window', w.includes('You have reached the limit of your plan') && w.includes(LECTURES) && page.url().endsWith('#/home'), w);
    await page.click('#overlay button:text-is("Not now")'); await page.waitForTimeout(200);
    check('Not now closes it', (await page.locator('#overlay h3').count()) === 0);
    await page.goto(ORIGIN + '/#/pack/c1'); await page.waitForSelector('.main .card button.btn.primary'); await page.click('.main .card button.btn.primary');
    const p = await win(page);
    check('a review pack over the limit opens the window with the server\'s sentence', p.includes('You have reached the limit of your plan') && p.includes(PACKS), p);
  });

  await open(async page => {
    await page.goto(ORIGIN + '/#/new'); await page.waitForSelector('.page-h');
    const head = await page.locator('.page-h').innerText();
    check('a plan without a monthly limit (no lecturesThisMonth) shows only the minutes', !head.includes('lectures used this month') && head.includes('10 of 90'), head);
  }, { usage: { minutesToday: 10, minutesLimit: 90 } });

  await open(async page => {
    await page.evaluate(() => window.__sidenote.setLang('zh-Hant'));
    await page.goto(ORIGIN + '/#/new'); await page.waitForSelector('.page-h');
    const head = await page.locator('.page-h').innerText();
    await page.click('.choice button:nth-child(3)'); await page.fill('input[type=url]', 'https://example.com/lecture.mp4'); await page.click('form.card button.btn.blue');
    const w = await win(page);
    check('in Chinese: the count, the title and the server\'s sentence with its date', head.includes('本月已用 4／4 堂課') && w.includes('已達到方案上限')
      && w.includes('本月 Free 方案包含的 4 堂課已經用完。可以到「設定」選擇 Plus，或等到 12月1日。') && w.includes('查看方案'), { head, w });
    await page.click('#overlay button:text-is("暫時不要")');
    await page.evaluate(() => window.__sidenote.setLang('zh-Hans'));
    await page.goto(ORIGIN + '/#/pack/c1'); await page.waitForSelector('.main .card button.btn.primary'); await page.click('.main .card button.btn.primary');
    const p = await win(page);
    check('in Simplified: the review pack sentence', p.includes('已达到套餐上限') && p.includes('本月 Free 套餐包含的 1 个复习包已经用完。可以到“设置”选择 Plus，或等到 12月1日。'), p);
  });

  const cards = page => page.locator('.plan').evaluateAll(xs => xs.map(x => x.innerText.replace(/\s+/g, ' ').trim()));
  await open(async page => {
    await page.goto(ORIGIN + '/#/settings'); await page.waitForSelector('.plan');
    const en = await cards(page);
    await page.click('.plan:nth-child(3) button:text-is("Choose this plan")'); await page.waitForSelector('#overlay h3');
    const paying = (await page.locator('#overlay').innerText()).replace(/\s+/g, ' ');
    await page.click('#overlay button:text-is("OK")'); await page.waitForTimeout(200);
    check('choosing a plan while paying is not switched on: a window that says so and that nothing was charged', paying.includes('Paying is not switched on yet') && paying.includes('Nothing was charged.') && (await page.locator('#overlay h3').count()) === 0, paying);
    await page.evaluate(() => window.__sidenote.setLang('zh-Hant')); await page.waitForTimeout(200);
    const hant = await cards(page);
    await page.evaluate(() => window.__sidenote.setLang('zh-Hans')); await page.waitForTimeout(200);
    const hans = await cards(page);
    check('plan cards in English are as the server wrote them', en[0].includes('90 minutes of live recording a day') && en[1].includes('HK$98 for 30 days') && en[2].includes('Plus for a semester'), en);
    check('plan cards in Traditional: names, prices, every sentence and the dates; a sentence the app does not know stays as sent',
      ['免費', '每天 90 分鐘現場錄音', '每月 4 堂課', '每月 1 個溫習包', '錄音保留 30 天'].every(x => hant[0].includes(x))
      && ['Plus 一個月', 'HK$98，可用 30 天', '已付費至 2026年12月1日', '每天 240 分鐘現場錄音', '溫習包數量不限', '錄音一直保留', '一次付清，可用信用卡、支付寶或微信支付，不會自動續費。'].every(x => hant[1].includes(x))
      && ['Plus 學期版', 'HK$348，可用 120 天', '在 2026年12月1日 後再加 120 天', '支付寶或微信支付', 'A sentence nobody translated.'].every(x => hant[2].includes(x)), hant);
    check('plan cards in Simplified', ['免费', '每天 90 分钟现场录音', '每月 1 个复习包'].every(x => hans[0].includes(x)) && ['Plus 一个月', '已付费至 2026年12月1日', '复习包数量不限', '银行卡'].every(x => hans[1].includes(x))
      && ['Plus 学期版', '在 2026年12月1日 后再加 120 天', '支付宝'].every(x => hans[2].includes(x)), hans);
  }, { plans: PLANS });

  check('no page errors', errs.length === 0, errs);
  await browser.close();
  const n = results.filter(Boolean).length; console.log(`\n${n} of ${results.length} checks passed`); process.exit(n === results.length ? 0 : 1);
})().catch(e => { console.error('SCRIPT ERROR', String(e.message).slice(0, 1200)); process.exit(1); });
