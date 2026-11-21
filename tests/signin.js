// Signing in with an emailed code: CONFIG.SIGN_IN "email", which the backend sets from its phase 4 (added after the migration).
// Real-backend mode (fake API by request interception): the two steps and the requests sent, a wrong code, the invite code
// field on the form from the start (test of 2026-11-18), an email new to Halfold (the server answers 403: the field is
// marked and a note, not an error, says the code from the email is still good), Send a new code, Use another email, a
// refused send, Chinese. Sample mode with SIGN_IN "email". Without SIGN_IN the page is the invite-code form of sidenote.html.
const { chromium, ORIGIN, serve, setConfig } = require('./harness');
const results = [];
const check = (name, ok, detail) => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || detail === undefined ? '' : '  -> ' + JSON.stringify(detail)}`); };
const NEW = 'This email is new to Halfold. Enter your invite code to finish signing in. Used Halfold before? Enter the invite code you signed in with, and your lectures come with you.';
const WRONG = 'That code is not right. Check the latest email from Halfold.';

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const errs = [];
  const open = async (cfg, route) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await setConfig(ctx, cfg);
    if (route) await ctx.route('**/*', route);
    const page = await ctx.newPage(); page.on('pageerror', e => errs.push(e.message));
    await page.goto(ORIGIN + '/#/signin'); await page.waitForSelector('form.auth');
    return { ctx, page };
  };
  const backend = be => async route => {
    const req = route.request(), u = new URL(req.url()), j = (o, s = 200) => route.fulfill({ status: s, contentType: 'application/json', body: JSON.stringify(o) });
    if (!u.pathname.startsWith('/api/')) return serve(route, {});
    const p = u.pathname.slice(4), body = req.postData() ? JSON.parse(req.postData()) : null;
    be.sent.push({ m: req.method(), p, body, auth: req.headers()['authorization'] || '' });
    if (p === '/session/code') return be.sendFail ? j({ message: be.sendFail }, 429) : route.fulfill({ status: 204 });
    if (p === '/session') {
      if (body.code !== '123456') return j({ message: WRONG }, 401);
      if (be.newEmail && !body.inviteCode) return j({ message: NEW }, 403);
      return j({ token: 'tok', user: { name: body.name || 'Ann' } });
    }
    if (p === '/home') return j({ user: { name: 'Ann' }, courses: [], lectures: [], upcoming: [], settings: { classLanguage: 'en', zhDefault: false } });
    return j({ message: 'Not found' }, 404);
  };
  const EMAIL = { USE_MOCK: false, SIGN_IN: 'email' };
  const form = page => page.locator('form.auth').innerText();
  const count = (page, sel) => page.locator(sel).count();
  const submit = page => page.click('form.auth button.primary');
  const toCode = async (page, email) => { await page.fill('input[name=email]', email); await submit(page); await page.waitForSelector('input[name=otp]'); };

  { const { ctx, page } = await open({});
    check('without SIGN_IN the sign-in page is the invite-code form, as before', await count(page, 'input[name=code]') === 1 && await count(page, 'input[name=email]') === 0 && (await form(page)).includes('Halfold is invite only for now.'));
    await ctx.close(); }

  { const be = { sent: [] }; const { ctx, page } = await open(EMAIL, backend(be));
    const first = { email: await count(page, 'input[name=email]'), code: await count(page, 'input[name=code]'), otp: await count(page, 'input[name=otp]'), btn: await page.locator('form.auth button.primary').innerText() };
    first.label = await page.locator('label.field', { has: page.locator('input[name=code]') }).locator('span').innerText().catch(() => '');
    check('SIGN_IN "email": the first step asks for the email, with the invite code (only the first time) on it from the start', first.email === 1 && first.code === 1 && first.otp === 0 && first.btn === 'Send code' && first.label === 'Invite code (only the first time)', first);
    await toCode(page, ' ann@example.edu ');
    const sent = be.sent[0] || {};
    check('Send code posts the email to /session/code without a token, then asks for the code', sent.m === 'POST' && sent.p === '/session/code' && JSON.stringify(sent.body) === '{"email":"ann@example.edu"}' && sent.auth === ''
      && (await form(page)).includes('We sent a 6-digit code to ann@example.edu. Check your inbox and spam folder.') && await count(page, 'input[name=code]') === 1, { sent: be.sent, form: await form(page) });
    await page.fill('input[name=otp]', '000000'); await submit(page); await page.waitForSelector('.err');
    check('a wrong code shows the server message and stays on the code step', (await page.locator('.err').innerText()) === WRONG && await count(page, 'input[name=otp]') === 1);
    await page.fill('input[name=otp]', '123456'); await submit(page); await page.waitForSelector('.shell');
    const si = be.sent.filter(x => x.p === '/session').pop(), home = be.sent.find(x => x.p === '/home') || {};
    check('the right code signs in: POST /session {email, code, name, inviteCode}, then home with the token', JSON.stringify(si.body) === '{"email":"ann@example.edu","code":"123456","name":"","inviteCode":""}' && page.url().endsWith('#/home') && home.auth === 'Bearer tok', be.sent);
    await ctx.close(); }

  { const be = { sent: [], newEmail: true }; const { ctx, page } = await open(EMAIL, backend(be));
    await toCode(page, 'new@example.edu');
    await page.fill('input[name=otp]', '123456'); await submit(page); await page.waitForSelector('.need-note');
    const kept = await page.inputValue('input[name=otp]'), note = await page.locator('.need-note').innerText();
    check('an email new to Halfold (403): a note, not an error, under the marked invite code field; a name field; the code typed stays', note === NEW + ' Your code from the email is still good.'
      && await count(page, '.err') === 0 && await count(page, '.field.need input[name=code]') === 1 && await count(page, 'input[name=name]') === 1 && kept === '123456', { kept, note });
    await page.fill('input[name=code]', 'a3f9c2'); await page.fill('input[name=name]', 'Nina'); await submit(page); await page.waitForSelector('.shell');
    const si = be.sent.filter(x => x.p === '/session').pop();
    check('sending again with the invite code signs in', JSON.stringify(si.body) === '{"email":"new@example.edu","code":"123456","name":"Nina","inviteCode":"a3f9c2"}' && (await page.evaluate(() => window.__sidenote.S.token)) === 'tok' && page.url().endsWith('#/home'), si);
    await ctx.close(); }

  { const be = { sent: [], newEmail: true }; const { ctx, page } = await open(EMAIL, backend(be));
    await page.fill('input[name=email]', 'new2@example.edu'); await page.fill('input[name=code]', 'a3f9c2'); await submit(page); await page.waitForSelector('input[name=otp]');
    const step2 = { invite: await page.inputValue('input[name=code]'), name: await count(page, 'input[name=name]') };
    await page.fill('input[name=otp]', '123456'); await submit(page); await page.waitForSelector('.shell');
    const si = be.sent.filter(x => x.p === '/session');
    check('an invite code typed on the first step is still there with the code and goes with it: one request, no 403', step2.invite === 'a3f9c2' && step2.name === 1 && si.length === 1 && si[0].body.inviteCode === 'a3f9c2', { step2, si });
    await ctx.close(); }

  { const be = { sent: [] }; const { ctx, page } = await open(EMAIL, backend(be));
    await toCode(page, 'a@example.edu');
    await page.click('form.auth button:text-is("Send a new code")'); await page.waitForSelector('.toast');
    check('Send a new code asks the server again for the same email', be.sent.filter(x => x.p === '/session/code' && x.body.email === 'a@example.edu').length === 2 && (await page.locator('.toast').last().innerText()) === 'A new code is on its way.', be.sent);
    await page.click('form.auth button:text-is("Use another email")'); await page.waitForSelector('input[name=email]');
    check('Use another email goes back to the first step, the email filled in', (await page.inputValue('input[name=email]')) === 'a@example.edu' && await count(page, 'input[name=otp]') === 0);
    be.sendFail = 'A code was sent to this address less than a minute ago. Check your inbox and spam folder, or ask again in a minute.';
    await submit(page); await page.waitForSelector('.err');
    check('a refused send shows the server message on the first step', (await page.locator('.err').innerText()) === be.sendFail && await count(page, 'input[name=otp]') === 0);
    await ctx.close(); }

  { const { ctx, page } = await open(EMAIL, backend({ sent: [], newEmail: true }));
    await page.evaluate(() => window.__sidenote.setLang('zh'));
    const zh1 = await form(page);
    await toCode(page, 'chan@example.edu'); await page.fill('input[name=otp]', '123456'); await submit(page); await page.waitForSelector('.need-note');
    const zh2 = { form: await form(page), err: await page.locator('.need-note').innerText() };
    check('the email sign-in is in Chinese, the email address left as it is', zh1.includes('輸入你的電郵地址') && zh1.includes('發送登入碼') && zh2.form.includes('已把 6 位數登入碼寄到 chan@example.edu。') && zh2.form.includes('邀請碼')
      && zh2.form.includes('重新發送登入碼') && zh2.err.startsWith('這個電郵地址是第一次登入 Halfold。') && zh2.err.endsWith('電郵中的登入碼仍然有效。') && zh1.includes('邀請碼（只在第一次登入時需要）'), { zh1, zh2 });
    await ctx.close(); }

  { const { ctx, page } = await open({ SIGN_IN: 'email' });
    await toCode(page, 'jasper@example.edu'); await page.fill('input[name=otp]', '12345'); await submit(page); await page.waitForSelector('.err');
    const short = await page.locator('.err').innerText();
    await page.fill('input[name=otp]', '123 456'); await submit(page); await page.waitForSelector('.shell');
    check('sample mode with SIGN_IN "email": any 6 digits sign in, fewer are refused', short === 'Enter the 6-digit code from the email.' && (await page.evaluate(() => window.__sidenote.S.token)) === 'mock-token', short);
    await ctx.close(); }

  check('no page errors', errs.length === 0, errs);
  await browser.close();
  console.log(`\n${results.filter(Boolean).length} of ${results.length} checks passed`);
})().catch(e => { console.error('SCRIPT ERROR', String(e.message).slice(0, 1200)); process.exit(1); });
