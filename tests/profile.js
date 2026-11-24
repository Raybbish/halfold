// The profile and the two consents asked once after the first sign-in, and kept in Settings: the designers' draft of
// 2026-11-24 (halfold(1).html), for the handoff of 2026-11-23, item 4 (src/pages/Profile.tsx, API-CHANGES.md 14).
// Real-backend mode with a fake API (request interception), as signin.js: a new sign-up goes from the code to #/welcome
// (user.profile null), with the school guessed from the email, the suggestions, the draft's years and origins, both boxes
// empty; any part of the form can be saved, and PUT /profile gets all seven fields as the draft's readProfile sends them;
// only the home page leads to the form; Skip for now is kept in this browser and on the server, and the home page shows
// the reminder; another device that skipped is not asked; Simplified Chinese; Settings' About you card saves the profile
// and withdraws a consent; typed answers survive a change of language; sample mode.
const { chromium, ORIGIN, serve, setConfig } = require('./harness');
const results = [];
const check = (name, ok, detail) => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || detail === undefined ? '' : '  -> ' + JSON.stringify(detail)}`); };
const GUESS = { en: 'Tsinghua University', zhHant: '清華大學', zhHans: '清华大学' };
const MKT = 'Send me messages about jobs, further study and student offers that fit my course and year. Halfold sends them itself and does not pass my details to anyone.';
const SRV = 'Invite me to paid student surveys.';
const Y = new Date().getFullYear();

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const errs = [];
  /* be: { sent, profile (null = none yet), skipped, guess } — what the fake server holds and answers. */
  const backend = be => async route => {
    const req = route.request(), u = new URL(req.url()), j = (o, s = 200) => route.fulfill({ status: s, contentType: 'application/json', body: JSON.stringify(o) });
    if (!u.pathname.startsWith('/api/')) return serve(route, {});
    const p = u.pathname.slice(4), body = req.postData() ? JSON.parse(req.postData()) : null;
    be.sent.push({ m: req.method(), p, body, auth: req.headers()['authorization'] || '' });
    if (p === '/session/code') return route.fulfill({ status: 204 });
    if (p === '/session') return j({ token: 'tok', user: { name: 'Ann' } });
    if (p === '/home') return j({ user: { name: 'Ann', profile: be.profile, ...(be.profile === null && be.skipped ? { profileSkipped: true } : {}) }, courses: [], lectures: [], upcoming: [],
      settings: { classLanguage: 'en', zhDefault: false }, ...(be.guess && !(be.profile && be.profile.school) ? { schoolGuess: be.guess } : {}) });
    if (p === '/plans') return j({ plans: [], current: null });
    if (p === '/profile' && req.method() === 'PUT') {
      const at = new Date().toISOString(), was = be.profile || { consentMarketing: false, consentSurvey: false, consentMarketingAt: null, consentSurveyAt: null };
      be.profile = { school: body.school, major: body.major, yearOfStudy: body.yearOfStudy, gradYear: body.gradYear ? Number(body.gradYear) : null, origin: body.origin,
        consentMarketing: body.consentMarketing, consentSurvey: body.consentSurvey,
        consentMarketingAt: be.profile && body.consentMarketing === was.consentMarketing ? was.consentMarketingAt : at, consentSurveyAt: be.profile && body.consentSurvey === was.consentSurvey ? was.consentSurveyAt : at };
      return j({ profile: be.profile });
    }
    if (p === '/profile/later') { be.skipped = true; return route.fulfill({ status: 204 }); }
    return j({ message: 'Not found' }, 404);
  };
  /* signedIn: a session saved in this browser, as after an earlier sign-in. */
  const open = async (cfg, be, hash, signedIn) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await setConfig(ctx, cfg);
    if (signedIn) await ctx.addInitScript(() => { try { if (!localStorage.getItem('sidenote.session')) localStorage.setItem('sidenote.session', JSON.stringify({ token: 'tok', user: { name: 'Ann' } })); } catch (e) {} });
    if (be) await ctx.route('**/*', backend(be));
    const page = await ctx.newPage(); page.on('pageerror', e => errs.push(e.message));
    await page.goto(ORIGIN + '/' + hash);
    return { ctx, page };
  };
  const REAL = { USE_MOCK: false, SIGN_IN: 'email' };
  const count = (page, sel) => page.locator(sel).count();
  const text = (page, sel) => page.locator(sel).innerText();
  const options = (page, sel) => page.locator(sel + ' option').evaluateAll(os => os.map(o => [o.value, o.textContent]));
  const boxes = page => page.evaluate(() => [...document.querySelectorAll('.consent input[type=checkbox]')].map(b => [b.name, b.checked]));
  const puts = be => be.sent.filter(x => x.p === '/profile' && x.m === 'PUT');

  { const be = { sent: [], profile: null, guess: GUESS }; const { ctx, page } = await open(REAL, be, '#/signin');
    await page.waitForSelector('form.auth');
    await page.fill('input[name=email]', 'li@mails.tsinghua.edu.cn'); await page.fill('input[name=code]', 'a3f9c2'); await page.click('form.auth button.primary');
    await page.waitForSelector('input[name=otp]'); await page.fill('input[name=otp]', '123456'); await page.click('form.auth button.primary');
    await page.waitForSelector('form.welcome');
    const got = { url: page.url(), h1: await text(page, 'form.welcome h1'), labels: await page.locator('form.welcome .field > span').allInnerTexts(), school: await page.inputValue('input[name=school]'),
      list: await page.locator('#schools option').evaluateAll(os => os.map(o => o.value)), boxes: await boxes(page), consent: await page.locator('.consent label').allInnerTexts(),
      btn: await text(page, 'form.welcome button.primary'), skip: await text(page, 'button.skip') };
    check('a new sign-up (user.profile null) goes from the code to the draft\'s form: its labels, the school from the email, both boxes empty, Skip for now',
      got.url.endsWith('#/welcome') && got.h1 === 'One more step' && JSON.stringify(got.labels) === JSON.stringify(['University', 'What you study', 'Year', 'Graduating in', 'Where you studied before university (optional)'])
      && got.school === 'Tsinghua University' && JSON.stringify(got.boxes) === '[["mk",false],["sv",false]]' && got.consent[0] === MKT && got.consent[1] === SRV
      && got.btn === 'Save and continue' && got.skip === 'Skip for now', got);
    check('the suggestions: the guessed school first, then Hong Kong and schools elsewhere', got.list[0] === 'Tsinghua University' && got.list.includes('HKUST') && got.list.includes('NTU (Taiwan)') && got.list.includes('Peking University') && got.list.includes('NUS'), got.list);
    const opts = { year: await options(page, 'select[name=year]'), grad: await options(page, 'select[name=grad]'), origin: await options(page, 'select[name=origin]') };
    check('the draft\'s years, graduation from this year to six years ahead, and origins with Prefer not to say first (the default)',
      JSON.stringify(opts.year) === JSON.stringify([['', ''], ['y1', 'Year 1'], ['y2', 'Year 2'], ['y3', 'Year 3'], ['y4', 'Year 4 or above'], ['tpg', "Taught master's"], ['rpg', 'Research postgraduate'], ['other', 'Other']])
      && JSON.stringify(opts.grad.map(o => o[0])) === JSON.stringify(['', ...[0, 1, 2, 3, 4, 5, 6].map(i => String(Y + i))])
      && JSON.stringify(opts.origin) === JSON.stringify([['', 'Prefer not to say'], ['hk', 'Hong Kong'], ['cn', 'Mainland China'], ['tw', 'Taiwan'], ['mo', 'Macau'], ['other', 'Somewhere else']])
      && await page.inputValue('select[name=origin]') === '', opts);
    await page.fill('input[name=major]', 'Economics'); await page.selectOption('select[name=grad]', String(Y + 2)); await page.check('input[name=sv]');
    await page.click('form.welcome button.primary'); await page.waitForSelector('.shell');
    const put = puts(be)[0] || {};
    check('part of the form is enough: Save and continue sends all seven fields as the draft does, then home',
      JSON.stringify(put.body) === JSON.stringify({ school: 'Tsinghua University', major: 'Economics', yearOfStudy: '', gradYear: String(Y + 2), origin: '', consentMarketing: false, consentSurvey: true })
      && put.auth === 'Bearer tok' && page.url().endsWith('#/home') && await count(page, '.nudge') === 0, put);
    await page.reload(); await page.waitForSelector('.shell');
    check('saved: not asked again after a reload, and no reminder', page.url().endsWith('#/home') && await count(page, 'form.welcome') === 0 && await count(page, '.nudge') === 0, page.url());
    await ctx.close(); }

  { const be = { sent: [], profile: null }; const { ctx, page } = await open(REAL, be, '#/new', true);
    await page.waitForSelector('.shell'); await page.waitForTimeout(200);
    const onNew = page.url().endsWith('#/new') && await count(page, 'form.welcome') === 0;
    await page.evaluate(() => { location.hash = '#/home'; }); await page.waitForSelector('form.welcome');
    const school = await page.inputValue('input[name=school]');
    await page.click('button.skip'); await page.waitForSelector('.nudge');
    const later = be.sent.filter(x => x.p === '/profile/later'), local = await page.evaluate(() => localStorage.getItem('sidenote.welcomed'));
    check('only the home page leads to the form (as the draft); no school known: empty; Skip for now is kept here and on the server, and home shows the reminder',
      onNew && school === '' && later.length === 1 && later[0].m === 'POST' && local === '1' && puts(be).length === 0 && page.url().endsWith('#/home')
      && (await text(page, '.nudge')).includes('Tell Halfold your university and year'), { onNew, school, later, local });
    await page.reload(); await page.waitForSelector('.nudge');
    check('after skipping, the home page does not lead to the form again', page.url().endsWith('#/home') && await count(page, 'form.welcome') === 0);
    await page.click('.nudge'); await page.waitForSelector('form.welcome'); await page.selectOption('select[name=origin]', 'mo'); await page.click('form.welcome button.primary'); await page.waitForSelector('.shell');
    check('the reminder opens the form; saving it there ends the reminder', puts(be).length === 1 && puts(be)[0].body.origin === 'mo' && await count(page, '.nudge') === 0, puts(be));
    await page.evaluate(() => window.__sidenote.S.user && document.querySelector('a[href="#/settings"]').click()); await page.waitForSelector('form.about-card');
    await page.click('button:text-is("Sign out")'); await page.waitForTimeout(200);
    check('signing out forgets the skip on this device (another student may sign in here)', await page.evaluate(() => localStorage.getItem('sidenote.welcomed')) === null);
    await ctx.close(); }

  { const be = { sent: [], profile: null, skipped: true }; const { ctx, page } = await open(REAL, be, '#/home', true);
    await page.waitForSelector('.shell'); await page.waitForTimeout(200);
    check('another device: the server says the student skipped (user.profileSkipped), so the form is not shown, only the reminder', page.url().endsWith('#/home') && await count(page, 'form.welcome') === 0 && await count(page, '.nudge') === 1);
    await ctx.close(); }

  { const be = { sent: [], profile: null, guess: GUESS }; const { ctx, page } = await open(REAL, be, '#/home', true);
    await page.waitForSelector('form.welcome'); await page.evaluate(() => window.__sidenote.setLang('zh-Hans'));
    const got = { h1: await text(page, 'form.welcome h1'), labels: await page.locator('form.welcome .field > span').allInnerTexts(), school: await page.inputValue('input[name=school]'),
      consent: await page.locator('.consent label').allInnerTexts(), note: await text(page, '.consent p'), btn: await text(page, 'form.welcome button.primary'), skip: await text(page, 'button.skip'),
      years: (await options(page, 'select[name=year]')).map(o => o[1]), origins: (await options(page, 'select[name=origin]')).map(o => o[1]) };
    check('in Simplified Chinese: the draft\'s Chinese, the school in Simplified, the consent wording',
      got.h1 === '还有一步' && JSON.stringify(got.labels) === JSON.stringify(['大学', '专业', '年级', '毕业年份', '入读大学前在哪里读书（可不填）']) && got.school === '清华大学'
      && got.consent[0] === '把适合我的课程和年级的招聘、升学和学生优惠信息发给我。信息由 Halfold 自己发出，不会把我的个人信息交给任何人。' && got.consent[1] === '邀请我参加有偿的学生问卷调查。'
      && got.note === '两项默认都不勾选，随时可以在设置里更改。' && got.btn === '保存并继续' && got.skip === '暂时跳过'
      && JSON.stringify(got.years) === JSON.stringify(['', '一年级', '二年级', '三年级', '四年级或以上', '授课型硕士', '研究型研究生', '其他'])
      && JSON.stringify(got.origins) === JSON.stringify(['不想说', '香港', '中国内地', '台湾', '澳门', '其他地方']), got);
    await ctx.close(); }

  { const be = { sent: [], profile: { school: 'HKU', major: 'Economics', yearOfStudy: 'y3', gradYear: Y + 1, origin: 'hk', consentMarketing: true, consentSurvey: false, consentMarketingAt: '2026-11-20T10:00:00.000Z', consentSurveyAt: '2026-11-20T10:00:00.000Z' } };
    const { ctx, page } = await open(REAL, be, '#/settings', true);
    await page.waitForSelector('form.about-card');
    const shown = { h2: await text(page, '.about-card h2'), school: await page.inputValue('.about-card input[name=school]'), major: await page.inputValue('.about-card input[name=major]'), year: await page.inputValue('.about-card select[name=year]'),
      grad: await page.inputValue('.about-card select[name=grad]'), origin: await page.inputValue('.about-card select[name=origin]'), boxes: await boxes(page) };
    check('Settings has the same form, About you, with the saved profile', JSON.stringify(shown) === JSON.stringify({ h2: 'About you', school: 'HKU', major: 'Economics', year: 'y3', grad: String(Y + 1), origin: 'hk', boxes: [['mk', true], ['sv', false]] }), shown);
    await page.fill('.about-card input[name=major]', 'Physics'); await page.uncheck('.about-card input[name=mk]'); await page.click('.about-card button.primary'); await page.waitForSelector('.toast');
    const out = { body: puts(be)[0] && puts(be)[0].body, toast: await page.locator('.toast').last().innerText(), mk: await page.isChecked('.about-card input[name=mk]'), major: await page.inputValue('.about-card input[name=major]') };
    check('withdrawing a consent and changing the profile: Save sends the whole form, says Saved, and the server timed the withdrawal',
      JSON.stringify(out.body) === JSON.stringify({ school: 'HKU', major: 'Physics', yearOfStudy: 'y3', gradYear: String(Y + 1), origin: 'hk', consentMarketing: false, consentSurvey: false })
      && out.toast === 'Saved' && !out.mk && out.major === 'Physics' && be.profile.consentMarketingAt > '2026-11-20T10:00:00.000Z' && be.profile.consentSurveyAt === '2026-11-20T10:00:00.000Z', out);
    await page.evaluate(() => window.__sidenote.setLang('zh-Hant')); await page.waitForTimeout(100);
    check('Settings in Traditional Chinese', (await text(page, '.about-card h2')) === '關於你' && (await text(page, '.about-card button.primary')) === '儲存' && (await page.locator('.about-card .field > span').first().innerText()) === '大學');
    await ctx.close(); }

  { const be = { sent: [], profile: { school: 'HKU', major: '', yearOfStudy: '', gradYear: Y - 2, origin: '', consentMarketing: false, consentSurvey: false, consentMarketingAt: null, consentSurveyAt: null } };
    const { ctx, page } = await open(REAL, be, '#/settings', true);
    await page.waitForSelector('form.about-card');
    check('a graduation year saved earlier, no longer in the list, is still shown', await page.inputValue('.about-card select[name=grad]') === String(Y - 2));
    await ctx.close(); }

  { const be = { sent: [], profile: null, guess: GUESS }; const { ctx, page } = await open(REAL, be, '#/home', true);
    await page.waitForSelector('form.welcome');
    await page.fill('input[name=major]', 'Law'); await page.selectOption('select[name=origin]', 'tw'); await page.check('input[name=mk]');
    await page.evaluate(() => window.__sidenote.setLang('zh-Hant'));
    const kept = { school: await page.inputValue('input[name=school]'), major: await page.inputValue('input[name=major]'), origin: await page.inputValue('select[name=origin]'), boxes: await boxes(page) };
    await page.fill('input[name=school]', 'My school'); await page.evaluate(() => window.__sidenote.setLang('en'));
    const typed = await page.inputValue('input[name=school]');
    check('typed answers survive a change of language; the guessed school follows the language until the student types in it', kept.school === '清華大學' && kept.major === 'Law' && kept.origin === 'tw'
      && JSON.stringify(kept.boxes) === '[["mk",true],["sv",false]]' && typed === 'My school', { kept, typed });
    await ctx.close(); }

  { const { ctx, page } = await open({}, null, '#/home', true);
    await page.waitForSelector('.shell'); await page.waitForTimeout(200);
    const atHome = page.url().endsWith('#/home') && await count(page, 'form.welcome') === 0 && await count(page, '.nudge') === 0;
    await page.goto(ORIGIN + '/#/settings'); await page.waitForSelector('form.about-card');
    await page.check('.about-card input[name=sv]'); await page.click('.about-card button.primary'); await page.waitForSelector('.toast');
    check('sample mode: the sample student has a profile, so no step and no reminder; Settings saves', atHome && (await page.locator('.toast').last().innerText()) === 'Saved'
      && await page.inputValue('.about-card input[name=school]') === 'HKUST' && await page.isChecked('.about-card input[name=sv]'), atHome);
    await ctx.close(); }

  check('no page errors', errs.length === 0, errs);
  await browser.close();
  console.log(`\n${results.filter(Boolean).length} of ${results.length} checks passed`);
})().catch(e => { console.error('SCRIPT ERROR', String(e.message).slice(0, 1200)); process.exit(1); });
