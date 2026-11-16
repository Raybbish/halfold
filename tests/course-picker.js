// Choosing the course on the New lecture page (added after the migration). sidenote.html put "Add a course" inside the
// course list. With no course yet it was the only item and already chosen, so choosing it did nothing. Now the list holds
// only courses, Add a course is a button of its own, and with no course yet the field says so and offers the button.
// Real-backend mode (fake API by request interception); English and Chinese; desktop and phone widths.
const { chromium, ORIGIN, serve, setConfig } = require('./harness');
const results = [];
const check = (name, ok, detail) => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || detail === undefined ? '' : '  -> ' + JSON.stringify(detail)}`); };

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const errs = [];
  const backend = be => async route => {
    const req = route.request(), u = new URL(req.url()), m = req.method(), j = (o, s = 200) => route.fulfill({ status: s, contentType: 'application/json', body: JSON.stringify(o) });
    if (!u.pathname.startsWith('/api/')) return serve(route, { USE_MOCK: false });
    const p = u.pathname.slice(4); be.log.push(m + ' ' + p);
    if (p === '/session') return j({ token: 'tok', user: { name: 'T' } });
    if (p === '/home') return j({ user: { name: 'T' }, courses: be.courses, lectures: [], upcoming: [], settings: { classLanguage: 'en', zhDefault: false } });
    if (m === 'POST' && p === '/courses') { const b = JSON.parse(req.postData() || '{}'), c = { id: 'c' + (be.courses.length + 1), code: b.code, name: b.name }; be.courses.push(c); return j(c); }
    return j({ message: 'Not found' }, 404);
  };
  const open = async (be, { zh = false, phone = false } = {}) => {
    const ctx = await browser.newContext(phone ? { viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true } : { viewport: { width: 1280, height: 800 } });
    await setConfig(ctx, { USE_MOCK: false }); await ctx.route('**/*', backend(be));
    const page = await ctx.newPage(); page.on('pageerror', e => errs.push(e.message));
    await page.goto(ORIGIN + '/#/'); if (zh) await page.click('.lang');
    await page.goto(ORIGIN + '/#/signin'); await page.fill('input[name=code]', 'abc'); await page.click('form.auth button'); await page.waitForSelector('.shell');
    await page.evaluate(() => { location.hash = '#/new'; }); await page.waitForSelector('form.card'); await page.waitForTimeout(300);
    return { ctx, page };
  };
  // The course field is the first field of the New lecture form.
  const field = page => page.evaluate(() => {
    const f = document.querySelector('form.card .field'), s = f.querySelector('select'), b = f.querySelector('button'), fr = f.getBoundingClientRect();
    return { label: f.firstElementChild.firstChild ? f.firstElementChild.firstChild.textContent : '', text: f.innerText,
      options: s ? [...s.options].map(o => o.textContent) : null, value: s ? s.value : null,
      button: b ? b.textContent : null, buttonInside: b ? b.getBoundingClientRect().right <= fr.right + 0.5 && b.getBoundingClientRect().left >= fr.left - 0.5 : null,
      wide: document.documentElement.scrollWidth > innerWidth };
  });
  // Opens Add a course from the course field, adds the course and waits for the dialog to close. False when there is no button.
  const addCourse = async (page, code, name) => {
    const b = page.locator('form.card .field >> nth=0').locator('button');
    if (!(await b.count())) return false;
    await b.first().click(); await page.waitForSelector('#overlay input[name=code]', { timeout: 3000 });
    await page.fill('#overlay input[name=code]', code); await page.fill('#overlay input[name=name]', name);
    await page.click('#overlay button.btn.primary'); await page.waitForSelector('#overlay', { state: 'detached', timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(300); return true;
  };

  console.log('=== no course yet ===');
  { const be = { log: [], courses: [] }; const { ctx, page } = await open(be);
    const f = await field(page);
    check('with no course, the course field has no list, says there is no course yet, and offers Add a course', f.options === null && /no course/i.test(f.text) && f.button === 'Add a course', f);
    await page.click('form.card button.btn.blue'); await page.waitForTimeout(300);
    const err = await page.locator('form.card .err').textContent().catch(() => null);
    check('Make notes without a course says to add one first, and sends nothing', err === 'Add a course first.' && !be.log.some(x => x.startsWith('POST /lectures')), { err, log: be.log });
    const b = page.locator('form.card .field >> nth=0').locator('button');
    const dialog = (await b.count()) ? (await b.first().click(), await page.waitForSelector('#overlay h3', { timeout: 3000 }).then(h => h.textContent()).catch(() => null)) : null;
    check('that button opens the Add a course dialog', dialog === 'Add a course', dialog);
    await page.keyboard.press('Escape'); await page.waitForSelector('#overlay', { state: 'detached', timeout: 3000 }).catch(() => {});
    const added = await addCourse(page, 'ECON 1001', 'Microeconomics'), g = await field(page);
    check('after adding it, the list shows the new course, chosen, and nothing else', added && be.log.includes('POST /courses') && JSON.stringify(g.options) === '["ECON 1001, Microeconomics"]' && g.value === 'c1' && g.button === 'Add a course', { added, ...g });
    await ctx.close(); }

  console.log('\n=== with courses ===');
  { const be = { log: [], courses: [{ id: 'c1', code: 'ECON 1001', name: 'Microeconomics' }, { id: 'c2', code: 'FINA 2303', name: '' }] }; const { ctx, page } = await open(be);
    const f = await field(page);
    check('the list holds only the courses, the first chosen, and Add a course is a button in the field', JSON.stringify(f.options) === '["ECON 1001, Microeconomics","FINA 2303"]' && f.value === 'c1' && f.button === 'Add a course' && f.buttonInside && f.label === 'Course', f);
    await page.selectOption('form.card .field >> nth=0 >> select', 'c2');
    const added = await addCourse(page, 'MATH 1013', 'Calculus'), g = await field(page);
    check('adding a course from there chooses the new course', added && JSON.stringify(g.options) === '["ECON 1001, Microeconomics","FINA 2303","MATH 1013, Calculus"]' && g.value === 'c3', { added, ...g });
    await ctx.close(); }

  console.log('\n=== Chinese and phone ===');
  { const be = { log: [], courses: [] }; const { ctx, page } = await open(be, { zh: true });
    const f = await field(page);
    check('in Chinese, the empty course field and its button are in Chinese', f.options === null && f.button === '新增課程' && !/[A-Za-z]{2,}/.test(f.text), f);
    await ctx.close(); }
  { const be = { log: [], courses: [] }; const { ctx, page } = await open(be, { phone: true });
    const empty = await field(page); await addCourse(page, 'ECON 1001', 'Microeconomics with a rather long course name'); const one = await field(page);
    check('on a phone, the course field fits with no course and with one, with no sideways scrolling', empty.button && !empty.wide && empty.buttonInside && one.options && one.options.length === 1 && !one.wide && one.buttonInside, { empty, one });
    await ctx.close(); }

  check('no page errors', errs.length === 0, errs);
  await browser.close();
  const passed = results.filter(Boolean).length;
  console.log(`\n${passed} of ${results.length} checks passed`);
  process.exit(passed === results.length ? 0 : 1);
})().catch(e => { console.error('SCRIPT ERROR', e.message); process.exit(1); });
