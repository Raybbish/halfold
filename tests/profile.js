// The profile and the two consents asked once after signing in, and changed in Settings (handoff of 2026-11-23, item 4;
// src/pages/Profile.tsx, API-CHANGES.md 14). Real-backend mode with a fake API (request interception), as signin.js:
// a new sign-up goes from the code to the form, which has to be filled in (no Not now), the school guessed from the
// email, both boxes unticked, and PUT /profile with every field; the form stands in front of any page asked for until it
// is answered, and leads on to that page; an account from before is asked once and can say Not now (Simplified Chinese);
// a refusal from the server shows on the form; Settings saves the profile and the consents apart, and a withdrawn
// consent loses its "Agreed on" line (Traditional Chinese too); typed answers survive a change of language; sample mode.
const { chromium, ORIGIN, serve, setConfig } = require('./harness');
const results = [];
const check = (name, ok, detail) => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || detail === undefined ? '' : '  -> ' + JSON.stringify(detail)}`); };
const EMPTY = { school: '', major: '', yearOfStudy: null, gradYear: null, origin: null, consentMarketing: false, consentSurvey: false, consentMarketingAt: null, consentSurveyAt: null };
const GUESS = { en: 'Tsinghua University', zhHant: '清華大學', zhHans: '清华大学' };
const MKT = 'I am willing to receive recruiting, further study and student offer messages.', SRV = 'I am willing to take part in paid surveys.';

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const errs = [];
  /* be: { sent, ask, profile, guess, refuse } — what the fake server holds and answers. */
  const backend = be => async route => {
    const req = route.request(), u = new URL(req.url()), j = (o, s = 200) => route.fulfill({ status: s, contentType: 'application/json', body: JSON.stringify(o) });
    if (!u.pathname.startsWith('/api/')) return serve(route, {});
    const p = u.pathname.slice(4), body = req.postData() ? JSON.parse(req.postData()) : null;
    be.sent.push({ m: req.method(), p, body, auth: req.headers()['authorization'] || '' });
    if (p === '/session/code') return route.fulfill({ status: 204 });
    if (p === '/session') return j({ token: 'tok', user: { name: 'Ann' } });
    if (p === '/home') return j({ user: { name: 'Ann' }, courses: [], lectures: [], upcoming: [], settings: { classLanguage: 'en', zhDefault: false },
      profile: be.profile, ...(be.ask ? { askProfile: be.ask } : {}), ...(be.guess && !be.profile.school ? { schoolGuess: be.guess } : {}) });
    if (p === '/plans') return j({ plans: [], current: null });
    if (p === '/profile' && req.method() === 'PUT') {
      if (be.refuse) return j({ message: be.refuse }, 400);
      const at = new Date().toISOString(), was = be.profile;
      be.profile = { ...was, ...body, consentMarketingAt: 'consentMarketing' in body && body.consentMarketing !== was.consentMarketing ? at : was.consentMarketingAt,
        consentSurveyAt: 'consentSurvey' in body && body.consentSurvey !== was.consentSurvey ? at : was.consentSurveyAt };
      be.ask = null; return j(be.profile);
    }
    if (p === '/profile/later') { be.ask = null; return route.fulfill({ status: 204 }); }
    return j({ message: 'Not found' }, 404);
  };
  /* signedIn: a session saved in this browser, as after an earlier sign-in. */
  const open = async (cfg, be, hash, signedIn) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await setConfig(ctx, cfg);
    if (signedIn) await ctx.addInitScript(() => { try { localStorage.setItem('sidenote.session', JSON.stringify({ token: 'tok', user: { name: 'Ann' } })); } catch (e) {} });
    if (be) await ctx.route('**/*', backend(be));
    const page = await ctx.newPage(); page.on('pageerror', e => errs.push(e.message));
    await page.goto(ORIGIN + '/' + hash);
    return { ctx, page };
  };
  const REAL = { USE_MOCK: false, SIGN_IN: 'email' };
  const count = (page, sel) => page.locator(sel).count();
  const text = (page, sel) => page.locator(sel).innerText();
  const boxes = page => page.evaluate(() => [...document.querySelectorAll('input[type=checkbox][name^=consent]')].map(b => [b.name, b.checked]));
  const fillForm = async page => {
    await page.fill('input[name=major]', 'Economics'); await page.selectOption('select[name=yearOfStudy]', 'year2');
    await page.fill('input[name=gradYear]', '2028'); await page.selectOption('select[name=origin]', 'mainland');
  };
  const puts = be => be.sent.filter(x => x.p === '/profile' && x.m === 'PUT');

  { const be = { sent: [], ask: 'signup', profile: { ...EMPTY }, guess: GUESS }; const { ctx, page } = await open(REAL, be, '#/signin');
    await page.waitForSelector('form.auth');
    await page.fill('input[name=email]', 'li@mails.tsinghua.edu.cn'); await page.fill('input[name=code]', 'a3f9c2'); await page.click('form.auth button.primary');
    await page.waitForSelector('input[name=otp]'); await page.fill('input[name=otp]', '123456'); await page.click('form.auth button.primary');
    await page.waitForSelector('form.welcome');
    const got = { url: page.url(), h1: await text(page, 'form.welcome h1'), school: await page.inputValue('input[name=school]'), later: await count(page, 'button.later'),
      boxes: await boxes(page), labels: await page.locator('.consents label').allInnerTexts(), btn: await text(page, 'form.welcome button.primary'), home: be.sent.filter(x => x.p === '/home').length };
    check('a new sign-up goes from the code to the profile form: the school from the email, both boxes there and unticked, no Not now', got.url.endsWith('#/welcome') && got.h1 === 'A few things about you'
      && got.school === 'Tsinghua University' && got.later === 0 && JSON.stringify(got.boxes) === '[["consentMarketing",false],["consentSurvey",false]]'
      && got.labels[0] === MKT && got.labels[1] === SRV && got.btn === 'Continue' && got.home === 1, got);
    await page.click('form.welcome button.primary'); await page.waitForTimeout(300);
    check('with fields left empty, Continue sends nothing and the form stays', puts(be).length === 0 && page.url().endsWith('#/welcome'), be.sent.map(x => x.p));
    await fillForm(page); await page.check('input[name=consentSurvey]'); await page.click('form.welcome button.primary'); await page.waitForSelector('.shell');
    const put = puts(be)[0] || {};
    check('Continue sends PUT /profile with every field and each box on its own, then home', JSON.stringify(put.body) === JSON.stringify({ school: 'Tsinghua University', major: 'Economics', yearOfStudy: 'year2', gradYear: 2028, origin: 'mainland', consentMarketing: false, consentSurvey: true })
      && put.auth === 'Bearer tok' && page.url().endsWith('#/home'), put);
    await page.goto(ORIGIN + '/#/new'); await page.waitForTimeout(200); await page.reload(); await page.waitForSelector('.shell');
    check('answered: the form is not shown again, on another page or after a reload', page.url().endsWith('#/new') && await count(page, 'form.welcome') === 0, page.url());
    await ctx.close(); }

  { const be = { sent: [], ask: 'signup', profile: { ...EMPTY } }; const { ctx, page } = await open(REAL, be, '#/new', true);
    await page.waitForSelector('form.welcome');
    const first = { url: page.url(), school: await page.inputValue('input[name=school]') };
    await page.evaluate(() => { location.hash = '#/settings'; }); await page.waitForTimeout(300);
    const stays = page.url().endsWith('#/welcome');
    await page.fill('input[name=school]', 'Some College'); await fillForm(page); await page.click('form.welcome button.primary'); await page.waitForSelector('.shell');
    check('until it is answered the form stands in front of any page asked for (no school known: empty), then leads to that page', first.url.endsWith('#/welcome') && first.school === '' && stays
      && page.url().endsWith('#/settings') && puts(be)[0].body.school === 'Some College', { first, stays, url: page.url() });
    await ctx.close(); }

  { const be = { sent: [], ask: 'once', profile: { ...EMPTY }, guess: GUESS }; const { ctx, page } = await open(REAL, be, '#/home', true);
    await page.waitForSelector('form.welcome'); await page.evaluate(() => window.__sidenote.setLang('zh-Hans'));
    const got = { h1: await text(page, 'form.welcome h1'), lead: await text(page, 'form.welcome > p.muted'), school: await page.inputValue('input[name=school]'),
      labels: await page.locator('.consents label').allInnerTexts(), later: await text(page, 'button.later'), btn: await text(page, 'form.welcome button.primary'),
      opts: await page.locator('select[name=origin] option').allInnerTexts(), years: await page.locator('select[name=yearOfStudy] option').allInnerTexts() };
    check('an account from before is asked once, in Simplified Chinese: the handoff\'s wording for each box, the school in Simplified, Not now', got.h1 === '介绍一下你自己' && got.lead.includes('只问这一次')
      && got.school === '清华大学' && got.labels[0] === '愿意接收招聘、升学和学生优惠信息' && got.labels[1] === '愿意参加有偿问卷调研' && got.later === '暂时不要' && got.btn === '保存'
      && JSON.stringify(got.opts) === '["请选择","内地","香港本地","台湾","其他"]' && JSON.stringify(got.years) === '["请选择","一年级","二年级","三年级","四年级","五年级","硕士","博士"]', got);
    await page.click('button.later'); await page.waitForSelector('.shell');
    const later = be.sent.filter(x => x.p === '/profile/later');
    await page.reload(); await page.waitForSelector('.shell');
    check('Not now: POST /profile/later, nothing else sent, home, and not asked again', later.length === 1 && later[0].m === 'POST' && puts(be).length === 0 && page.url().endsWith('#/home') && await count(page, 'form.welcome') === 0, be.sent.map(x => x.m + ' ' + x.p));
    await ctx.close(); }

  { const be = { sent: [], ask: 'once', profile: { ...EMPTY }, refuse: 'Enter the year you graduate, with four digits, such as 2028.' }; const { ctx, page } = await open(REAL, be, '#/home', true);
    await page.waitForSelector('form.welcome'); await page.evaluate(() => window.__sidenote.setLang('zh-Hant'));
    await page.fill('input[name=school]', 'HKU'); await fillForm(page); await page.click('form.welcome button.primary'); await page.waitForSelector('.err');
    check('a refusal from the server shows on the form, in Chinese, and the form stays', (await text(page, '.err')) === '請用四位數字輸入畢業年份，例如 2028。' && page.url().endsWith('#/welcome') && await page.inputValue('input[name=major]') === 'Economics', await text(page, '.err'));
    await ctx.close(); }

  { const be = { sent: [], ask: null, profile: { school: 'HKU', major: 'Economics', yearOfStudy: 'year3', gradYear: 2027, origin: 'hk-local', consentMarketing: true, consentSurvey: false, consentMarketingAt: '2026-11-20T10:00:00.000Z', consentSurveyAt: '2026-11-20T10:00:00.000Z' } };
    const { ctx, page } = await open(REAL, be, '#/settings', true);
    await page.waitForSelector('form.profile-card');
    const shown = { school: await page.inputValue('.profile-card input[name=school]'), major: await page.inputValue('.profile-card input[name=major]'), year: await page.inputValue('.profile-card select[name=yearOfStudy]'),
      grad: await page.inputValue('.profile-card input[name=gradYear]'), origin: await page.inputValue('.profile-card select[name=origin]'), boxes: await boxes(page), at: await page.locator('.consent-card .consent-at').allInnerTexts() };
    check('Settings shows the saved profile, and "Agreed on" under the ticked box only', JSON.stringify(shown) === JSON.stringify({ school: 'HKU', major: 'Economics', year: 'year3', grad: '2027', origin: 'hk-local',
      boxes: [['consentMarketing', true], ['consentSurvey', false]], at: ['Agreed on 20 Nov 2026'] }), shown);
    await page.fill('.profile-card input[name=major]', 'Physics'); await page.click('.profile-card button.primary'); await page.waitForSelector('.toast');
    check('Save details sends the profile alone (no consent), and says so', JSON.stringify(puts(be)[0].body) === JSON.stringify({ school: 'HKU', major: 'Physics', yearOfStudy: 'year3', gradYear: 2027, origin: 'hk-local' })
      && (await page.locator('.toast').last().innerText()) === 'Details saved', puts(be)[0]);
    await page.uncheck('.consent-card input[name=consentMarketing]'); await page.click('.consent-card button.primary'); await page.waitForTimeout(400);
    const out = { body: puts(be)[1] && puts(be)[1].body, at: await page.locator('.consent-card .consent-at').count(), major: await page.inputValue('.profile-card input[name=major]'), withdrawnAt: be.profile.consentMarketingAt };
    check('withdrawing: Save choices sends the two boxes alone, the "Agreed on" line goes, and the server got a new time', JSON.stringify(out.body) === '{"consentMarketing":false,"consentSurvey":false}' && out.at === 0
      && out.major === 'Physics' && out.withdrawnAt > '2026-11-20T10:00:00.000Z', out);
    await page.check('.consent-card input[name=consentSurvey]'); await page.click('.consent-card button.primary'); await page.waitForTimeout(400);
    const today = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    const lines = await page.locator('.consent-card .consent-at').allInnerTexts(), surveyChecked = await page.isChecked('.consent-card input[name=consentSurvey]');
    check('giving the other consent: "Agreed on" today under it', JSON.stringify(puts(be)[2].body) === '{"consentMarketing":false,"consentSurvey":true}' && JSON.stringify(lines) === JSON.stringify(['Agreed on ' + today]) && surveyChecked, { lines, today });
    await page.evaluate(() => window.__sidenote.setLang('zh-Hant')); await page.waitForTimeout(100);
    const zh = { h2: await page.locator('.profile-card h2, .consent-card h2').allInnerTexts(), at: await page.locator('.consent-card .consent-at').allInnerTexts() };
    const zhDay = new Date().toLocaleDateString('zh-HK', { day: 'numeric', month: 'short', year: 'numeric' });
    check('Settings in Traditional Chinese: the two cards and the date agreed', JSON.stringify(zh.h2) === '["你的學業","信息和問卷"]' && JSON.stringify(zh.at) === JSON.stringify(['已於 ' + zhDay + ' 同意']), { zh, zhDay });
    await ctx.close(); }

  { const be = { sent: [], ask: 'signup', profile: { ...EMPTY }, guess: GUESS }; const { ctx, page } = await open(REAL, be, '#/home', true);
    await page.waitForSelector('form.welcome');
    await page.fill('input[name=major]', 'Law'); await page.selectOption('select[name=origin]', 'taiwan'); await page.check('input[name=consentMarketing]');
    await page.evaluate(() => window.__sidenote.setLang('zh-Hant'));
    const kept = { school: await page.inputValue('input[name=school]'), major: await page.inputValue('input[name=major]'), origin: await page.inputValue('select[name=origin]'), boxes: await boxes(page) };
    await page.fill('input[name=school]', 'My school'); await page.evaluate(() => window.__sidenote.setLang('en'));
    const typed = await page.inputValue('input[name=school]');
    check('typed answers survive a change of language; the guessed school follows the language until the student types in it', kept.school === '清華大學' && kept.major === 'Law' && kept.origin === 'taiwan'
      && JSON.stringify(kept.boxes) === '[["consentMarketing",true],["consentSurvey",false]]' && typed === 'My school', { kept, typed });
    await ctx.close(); }

  { const { ctx, page } = await open({}, null, '#/settings', true);
    await page.waitForSelector('form.consent-card');
    const welcome = await count(page, 'form.welcome');
    await page.check('.consent-card input[name=consentSurvey]'); await page.click('.consent-card button.primary'); await page.waitForSelector('.toast');
    check('sample mode: no question after signing in; Settings has both cards and saving a choice works', welcome === 0 && page.url().endsWith('#/settings') && await count(page, 'form.profile-card') === 1
      && (await page.locator('.toast').last().innerText()) === 'Choices saved' && (await page.locator('.consent-card .consent-at').allInnerTexts()).length === 1);
    await ctx.close(); }

  check('no page errors', errs.length === 0, errs);
  await browser.close();
  console.log(`\n${results.filter(Boolean).length} of ${results.length} checks passed`);
})().catch(e => { console.error('SCRIPT ERROR', String(e.message).slice(0, 1200)); process.exit(1); });
