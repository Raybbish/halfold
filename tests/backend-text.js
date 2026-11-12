// Text that comes from the backend is shown as it is, never translated (added after the migration).
// sidenote.html translated every text node not marked data-notr, so a course code, a chapter title, a slide label or
// a file name that happened to equal a dictionary key (or match a ZHR pattern) came out in Chinese. Here the sample
// data is given such values on purpose, the interface is switched to Chinese, and every place that shows them is read.
// Also checks that the six unused dictionary keys are gone.
const { chromium, ORIGIN } = require('./harness');
const results = [];
const check = (name, ok, detail) => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || detail === undefined ? '' : '  -> ' + JSON.stringify(detail)}`); };

// Dictionary keys ("Quiz", "Settings", "Home", "Transcript", "Notes") and a ZHR pattern ("Slide 4" -> 第 4 頁).
// CODE2 is a course with no name, so the course picker shows the code on its own.
const CODE = 'Quiz', NAME = 'Settings', CODE2 = 'Home', CHAPTER = 'Transcript', SLIDES = 'Slide 4', FILE = 'Notes';
const REMOVED = [
  "Tap a timestamp and read the lecturer's exact words.",
  'Anyone with the link can read the notes, flashcards and quiz. They cannot see your other lectures.',
  'The notes, flashcards, quiz and any shared link will be removed. This cannot be undone.',
  'Slides did not upload. You can add them later.',
  'The end of your recording has not been sent yet. Keep this page open and try again when you are back online.',
  'The notes could not be written. Open the lecture to try again.'
];

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage(); const errs = [];
  page.on('pageerror', e => errs.push(e.message)); page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  const text = (sel, how = 'textContent') => page.locator(sel).first().evaluate((el, how) => el[how] !== undefined ? el[how] : el.getAttribute(how), how);

  await page.goto(ORIGIN + '/#/signin'); await page.waitForSelector('form.auth');
  const pre = await page.evaluate(v => {
    const { DATA, setLang, trs } = window.__sidenote;
    const c = DATA.courses.find(x => x.id === 'econ1001'); c.code = v.CODE; c.name = v.NAME;
    const c2 = DATA.courses.find(x => x.id === 'math2011'); c2.code = v.CODE2; c2.name = '';
    const s = DATA.details['econ-w9'].sections[0]; s.title = v.CHAPTER; s.slides = v.SLIDES;
    setLang('zh');
    return { would: [v.CODE, v.NAME, v.CODE2, v.CHAPTER, v.SLIDES, v.FILE].map(x => [x, trs(x)]), home: trs('Home') };
  }, { CODE, NAME, CODE2, CHAPTER, SLIDES, FILE });
  check('the test values would be changed by translation (dictionary words or a pattern)', pre.would.every(([a, b]) => a !== b), pre.would);
  await page.fill('input[name=code]', 'abc'); await page.click('form.auth button'); await page.waitForSelector('.shell');

  // Home: sidebar and course cards
  const side = await page.locator(`.side a.n.c[href="#/course/econ1001"]`).evaluate(a => a.firstChild.nextSibling.textContent);
  check('sidebar shows the course code as it is', side === CODE, side);
  const card = await text(`a[href="#/course/econ1001"] .top`);
  check('course card shows the course code as it is', card === CODE, card);
  const homeLink = await text(`.side a.n[href="#/home"]`);
  check('interface text around it is still in Chinese', homeLink === pre.home && homeLink !== 'Home', homeLink);

  // Course page: heading and breadcrumb
  await page.goto(ORIGIN + '/#/course/econ1001'); await page.waitForSelector('.page-h h1');
  const ch = await text('.page-h h1'), crumb = await text('.crumb');
  check('course page heading and breadcrumb show the course code as it is', ch === CODE && crumb === pre.home + ' / ' + CODE, { ch, crumb });

  // Lecture page: breadcrumb, slide label on the notes, chapter name on the timeline
  await page.goto(ORIGIN + '/#/lecture/econ-w9'); await page.waitForSelector('.nsec');
  const lc = await text(`.crumb a[href="#/course/econ1001"]`);
  check('lecture breadcrumb shows the course code as it is', lc === CODE, lc);
  const tag = await text('.nsec h3 .tag');
  check('slide label on a notes section is shown as it is', tag === SLIDES, tag);
  const seg = await page.locator('.tl .seg').first().evaluate(b => [b.getAttribute('title'), b.getAttribute('aria-label')]);
  check('chapter name on the timeline (title and aria-label) is shown as it is', seg[0] === CHAPTER && seg[1] === CHAPTER, seg);

  // Review pack: breadcrumb and subtitle
  await page.goto(ORIGIN + '/#/pack/econ1001'); await page.waitForSelector('.page-h h1', { timeout: 10000 });
  const pc = await text(`.crumb a[href="#/course/econ1001"]`), ps = await text('.page-h p.muted');
  check('review pack breadcrumb and subtitle show the course as it is', pc === CODE && ps === CODE + ', ' + NAME, { pc, ps });

  // New lecture: course picker and the chosen file
  await page.goto(ORIGIN + '/#/new'); await page.waitForSelector('.choice'); await page.click('.choice button:nth-child(2)');
  const opt = [await text('select option[value="econ1001"]'), await text('select option[value="math2011"]')];
  check('course picker shows each course as it is, with or without a name', opt[0] === CODE + ', ' + NAME && opt[1] === CODE2, opt);
  await page.setInputFiles('#fRec', { name: FILE, mimeType: 'audio/mpeg', buffer: Buffer.alloc(1024, 1) });
  const chip = await text('.filechip b');
  check('chosen file name is shown as it is', chip === FILE, chip);

  // Dictionary: the six keys sidenote.html no longer used are gone
  const left = await page.evaluate(keys => keys.filter(k => k in window.__sidenote.ZH), REMOVED);
  check(`the ${REMOVED.length} unused dictionary keys are removed`, left.length === 0, left);

  check('no page errors', errs.length === 0, errs);
  await browser.close();
  console.log(`\n${results.filter(Boolean).length} of ${results.length} checks passed`);
})().catch(e => { console.error('SCRIPT ERROR', String(e.message).slice(0, 1200)); process.exit(1); });
