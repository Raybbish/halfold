// Editing and deleting a course, moving a lecture to another course (added after the migration).
// Sample mode: the dialogs, what changes on screen, deleting with and without lectures, the recording guard, Chinese.
// Real-backend mode (fake API by request interception): the requests sent, a server error, one course only, an
// expired sign-in.
const { chromium, ORIGIN, serve, setConfig } = require('./harness');
const results = [];
const check = (name, ok, detail) => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || detail === undefined ? '' : '  -> ' + JSON.stringify(detail)}`); };

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const errs = [];
  const open = async (cfg, route) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    if (cfg) await setConfig(ctx, cfg);
    if (route) await ctx.route('**/*', route);
    const page = await ctx.newPage(); page.on('pageerror', e => errs.push(e.message));
    await page.goto(ORIGIN + '/#/signin'); await page.fill('input[name=code]', 'abc'); await page.click('form.auth button'); await page.waitForSelector('.shell');
    return { ctx, page };
  };
  // Toasts stay up for 2.6 s: clear old ones before an action, so toast() waits for the one the action shows.
  const clearToasts = page => page.evaluate(() => document.querySelectorAll('.toast').forEach(t => t.remove()));
  const toast = async page => { await page.waitForSelector('.toast', { timeout: 10000 }); return page.locator('.toast').last().innerText(); };
  const noModal = async page => (await page.locator('#overlay .modal').count()) === 0;
  const go = async (page, hash, sel) => { await page.goto(ORIGIN + '/' + hash); await page.waitForSelector(sel, { timeout: 10000 }); };
  const S = page => page.evaluate(() => { const s = window.__sidenote.S; return { courses: s.courses.map(c => c.id), lectures: s.lectures.map(l => l.id + ':' + l.course) }; });
  const sideCount = (page, id) => page.locator(`.side a.n.c[href="#/course/${id}"] .ct`).innerText().catch(() => null);
  const openEdit = async page => { await clearToasts(page); await page.click('.page-h button:text-is("Edit course")'); await page.waitForSelector('#overlay input[name=code]'); };
  const openDelete = async page => { await openEdit(page); await page.click('#overlay button:text-is("Delete course")'); await page.waitForSelector('#overlay .btn.dark'); };
  const openMove = async page => { await clearToasts(page); await page.click('.page-h button:text-is("More")'); await page.click('#overlay button:text-is("Edit title and course")'); await page.waitForSelector('#overlay select[name=c]'); };

  console.log('=== sample data ===');
  { const { ctx, page } = await open();
    // Edit
    await go(page, '#/course/econ1001', '.page-h h1'); await openEdit(page);
    const pre = [await page.inputValue('#overlay input[name=code]'), await page.inputValue('#overlay input[name=name]')];
    check('Edit course opens a dialog with the code and name filled in', pre[0] === 'ECON 1001' && pre[1] === 'Principles of Microeconomics', pre);
    await page.fill('#overlay input[name=code]', 'ECON 1010'); await page.fill('#overlay input[name=name]', 'Microeconomics'); await page.click('#overlay button:text-is("Save course")');
    const t1 = await toast(page);
    const shown = { h1: await page.locator('.page-h h1').innerText(), sub: await page.locator('.page-h p.muted').innerText(), side: (await page.locator('.side a.n.c[href="#/course/econ1001"]').innerText()).split('\n')[0], toast: t1, closed: await noModal(page) };
    check('saving shows the new code and name on the course page and in the sidebar', shown.h1 === 'ECON 1010' && shown.sub === 'Microeconomics' && shown.side === 'ECON 1010' && shown.toast === 'Course saved' && shown.closed, shown);
    await go(page, '#/home', '.main');
    const home = await page.locator('.main').innerText();
    check('home shows the new code everywhere (course card, lecture list, upcoming dates), the old one nowhere', home.includes('ECON 1010') && !home.includes('ECON 1001') && (await page.locator('a[href="#/course/econ1001"] .top').innerText()) === 'ECON 1010');

    // Move
    // Only econ-w9 has full sample notes (and so a More menu).
    await go(page, '#/lecture/econ-w9', '.page-h button:text-is("More")'); await openMove(page);
    const opts = await page.$$eval('#overlay select[name=c] option', os => os.map(o => o.value));
    check('Edit title and course lists every course, the current one selected', JSON.stringify(opts) === '["econ1001","math2011","comp1021"]' && (await page.inputValue('#overlay select[name=c]')) === 'econ1001', opts);
    await page.selectOption('#overlay select[name=c]', 'math2011'); await page.click('#overlay button:text-is("Save changes")');
    const t2 = await toast(page);
    const moved = { toast: t2, crumb: await page.locator('.crumb a[href^="#/course/"]').innerText(), on: await page.locator('.side a.n.c.on').getAttribute('href'), econ: await sideCount(page, 'econ1001'), math: await sideCount(page, 'math2011'), closed: await noModal(page) };
    check('after moving: toast, breadcrumb and sidebar point to the new course, and the counts change', moved.toast === 'Moved to MATH 2011' && moved.crumb === 'MATH 2011' && moved.on === '#/course/math2011' && moved.econ === '2' && moved.math === '2' && moved.closed, moved);
    await go(page, '#/course/math2011', '.page-h h1'); const mathList = await page.locator('.main .list').innerText();
    await go(page, '#/course/econ1001', '.page-h h1'); const econList = await page.locator('.main .list').innerText();
    check('the lecture is listed under its new course and no longer under the old one', mathList.includes('Opportunity cost and comparative') && !econList.includes('Opportunity cost and comparative'));

    // Delete: Keep course, then delete with lectures
    await openDelete(page);
    const dlg = { h3: await page.locator('#overlay h3').innerText(), p: await page.locator('#overlay p.muted').innerText() };
    await page.click('#overlay button:text-is("Keep course")');
    check('Delete course asks first and says how many lectures go with it; Keep course keeps it', dlg.h3 === 'Delete ECON 1010?' && dlg.p === 'The 2 lectures in this course will be deleted too, with their recordings, notes, flashcards, quizzes and shared links. This cannot be undone.' && await noModal(page) && (await S(page)).courses.includes('econ1001'), dlg);
    await openDelete(page); await page.click('#overlay .btn.dark');
    const t3 = await toast(page); await page.waitForSelector('.main'); const after = await S(page);
    check('deleting goes home and removes the course and its lectures; the moved lecture stays', t3 === 'Course deleted' && page.url().endsWith('#/home') && !after.courses.includes('econ1001') && !after.lectures.some(l => /^econ-w(8|7):/.test(l)) && after.lectures.includes('econ-w9:math2011') && (await page.locator('.side a.n.c[href="#/course/econ1001"]').count()) === 0, { t3, url: page.url(), after });

    // Delete a course with no lectures
    await clearToasts(page); await page.click('.side button.addc'); await page.fill('#overlay input[name=code]', 'TEST 9999'); await page.click('#overlay button:text-is("Add course")'); await toast(page);
    const added = (await S(page)).courses.slice(-1)[0];
    await go(page, '#/course/' + added, '.page-h h1'); await openDelete(page);
    const p0 = await page.locator('#overlay p.muted').innerText(); await page.click('#overlay .btn.dark'); await page.waitForURL(/#\/home$/);
    check('a course with no lectures says so, and is deleted', p0 === 'This course has no lectures.' && !(await S(page)).courses.includes(added), p0);

    // A recording running in the course
    await page.evaluate(() => Object.assign(window.__sidenote.live, { active: true, id: 'math-w9' }));
    await go(page, '#/course/math2011', '.page-h h1'); await openEdit(page); await page.click('#overlay button:text-is("Delete course")');
    const t4 = await toast(page);
    check('a course cannot be deleted while a recording in it is running', t4 === 'End the recording before deleting this course.' && await noModal(page) && (await S(page)).courses.includes('math2011'), t4);
    await page.evaluate(() => Object.assign(window.__sidenote.live, { active: false, id: null }));

    // Chinese
    await page.evaluate(() => window.__sidenote.setLang('zh'));
    const zhBtn = await page.locator('.page-h button.btn.plain').first().innerText();
    await page.click('.page-h button.btn.plain >> nth=0'); await page.click('#overlay .btn.plain[style*="red"]'); await page.waitForSelector('#overlay .btn.dark');
    const zh = { btn: zhBtn, h3: await page.locator('#overlay h3').innerText(), p: await page.locator('#overlay p.muted').innerText() };
    await page.keyboard.press('Escape');
    await go(page, '#/lecture/econ-w9', '.page-h button'); await page.click('.page-h button >> nth=0'); zh.move = await page.locator('#overlay').innerText(); await page.keyboard.press('Escape');
    check('the new buttons and dialogs are in Chinese, with the course code left as it is', zh.btn === '編輯課程' && zh.h3 === '刪除 MATH 2011？' && zh.p === '這門課裡的 2 堂課也會一併刪除，包括錄音、筆記、閃卡、測驗和已分享的連結，而且無法復原。' && zh.move.includes('編輯標題和課程'), zh);
    await ctx.close(); }

  console.log('\n=== real backend (fake API) ===');
  const backend = be => async route => {
    const req = route.request(), u = new URL(req.url()), m = req.method(), j = (o, s = 200) => route.fulfill({ status: s, contentType: 'application/json', body: JSON.stringify(o) });
    if (!u.pathname.startsWith('/api/')) return serve(route, { USE_MOCK: false });
    const p = u.pathname.slice(4);
    if (p === '/session') return j({ token: 'tok', user: { name: 'T' } });
    const courses = [{ id: 'c1', code: 'TEST 1001', name: 'Testing' }, { id: 'c2', code: 'TEST 2002' }].slice(0, be.single ? 1 : 2);
    const lec = { id: 'l1', course: 'c1', title: 'Week 1', date: 'Today', duration: 300, status: 'ready' };
    if (p === '/home') return j({ user: { name: 'T' }, courses, lectures: [lec], upcoming: [], settings: { classLanguage: 'en', zhDefault: false } });
    if (m === 'GET' && p === '/lectures/l1') return j({ lecture: lec, detail: { alerts: [], sections: [], slides: [], transcript: [], flashcards: [], quiz: [] } });
    if (m === 'PATCH' || m === 'DELETE') {
      be.sent.push({ m, p, auth: req.headers()['authorization'] || '', body: req.postData() ? JSON.parse(req.postData()) : null });
      if (be.fail) return j({ message: be.fail === 401 ? 'expired' : 'That course code is already in use.' }, be.fail);
      return route.fulfill({ status: 204 });
    }
    return j({ message: 'Not found' }, 404);
  };

  { const be = { sent: [] }; const { ctx, page } = await open({ USE_MOCK: false }, backend(be));
    await go(page, '#/course/c1', '.page-h h1'); await openEdit(page);
    await page.fill('#overlay input[name=code]', 'TEST 1010'); await page.fill('#overlay input[name=name]', 'Renamed'); await page.click('#overlay button:text-is("Save course")'); await toast(page);
    const e = be.sent[0] || {};
    check('saving sends PATCH /courses/:id with the code and name and the token', e.m === 'PATCH' && e.p === '/courses/c1' && JSON.stringify(e.body) === '{"code":"TEST 1010","name":"Renamed"}' && e.auth === 'Bearer tok' && (await page.locator('.page-h h1').innerText()) === 'TEST 1010', be.sent);
    await go(page, '#/lecture/l1', '.page-h button:text-is("More")'); await openMove(page); await page.selectOption('#overlay select[name=c]', 'c2'); await page.click('#overlay button:text-is("Save changes")'); await toast(page);
    const mv = be.sent[1] || {};
    check('moving sends PATCH /lectures/:id with the new course', mv.m === 'PATCH' && mv.p === '/lectures/l1' && JSON.stringify(mv.body) === '{"course":"c2"}' && (await page.locator('.crumb a[href^="#/course/"]').innerText()) === 'TEST 2002', be.sent);
    await go(page, '#/course/c1', '.page-h h1'); await openDelete(page); await page.click('#overlay .btn.dark'); await toast(page);
    const dl = be.sent[2] || {};
    check('deleting sends DELETE /courses/:id and goes home', dl.m === 'DELETE' && dl.p === '/courses/c1' && page.url().endsWith('#/home'), be.sent);
    await ctx.close(); }

  { const be = { sent: [], fail: 409 }; const { ctx, page } = await open({ USE_MOCK: false }, backend(be));
    await go(page, '#/course/c1', '.page-h h1'); await openEdit(page); await page.fill('#overlay input[name=code]', 'TEST 2002'); await page.click('#overlay button:text-is("Save course")');
    const msg = await toast(page);
    check('a server error shows the server\'s message and leaves the course as it was', msg === 'That course code is already in use.' && await noModal(page) && (await page.locator('.page-h h1').innerText()) === 'TEST 1001', msg);
    await ctx.close(); }

  { const be = { sent: [], single: true }; const { ctx, page } = await open({ USE_MOCK: false }, backend(be));
    await go(page, '#/lecture/l1', '.page-h button:text-is("More")'); await page.click('.page-h button:text-is("More")');
    check('with only one course the More menu has no Move button, and the dialog no course list', (await page.locator('#overlay button:text-is("Move to another course")').count()) === 0 && (await page.locator('#overlay button:text-is("Edit title and course")').count()) === 1 && await (async () => { await page.click('#overlay button:text-is("Edit title and course")'); await page.waitForSelector('#overlay input[name=t]'); return (await page.locator('#overlay select').count()) === 0; })());
    await ctx.close(); }

  { const be = { sent: [], fail: 401 }; const { ctx, page } = await open({ USE_MOCK: false }, backend(be));
    await go(page, '#/course/c1', '.page-h h1'); await openDelete(page); await page.click('#overlay .btn.dark'); await page.waitForSelector('form.auth', { timeout: 10000 });
    check('an expired sign-in sends the student to sign in, then back to the course', page.url().endsWith('#/signin') && (await page.evaluate(() => window.__sidenote.S.next)) === '#/course/c1');
    await ctx.close(); }

  check('no page errors', errs.length === 0, errs);
  await browser.close();
  console.log(`\n${results.filter(Boolean).length} of ${results.length} checks passed`);
})().catch(e => { console.error('SCRIPT ERROR', String(e.message).slice(0, 1200)); process.exit(1); });
