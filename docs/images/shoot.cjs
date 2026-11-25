// Screenshots for the README, taken from the build (dist/) in sample mode, so no server or keys are needed.
//   npm run build && node docs/images/shoot.cjs
// Writes the PNG files next to this script. Animations are off so the pictures do not change from run to run.
const path = require('path');
const { chromium, ORIGIN } = require('../../tests/harness');

const OUT = __dirname;
const wait = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await chromium.launch({ headless: true });
  const errs = [];
  const open = async (viewport, scale = 2) => {
    const ctx = await browser.newContext({ viewport, deviceScaleFactor: scale, reducedMotion: 'reduce' });
    await ctx.addInitScript(() => { try { localStorage.setItem('sidenote.lang', 'en'); } catch (e) {} });
    const page = await ctx.newPage();
    page.on('pageerror', e => errs.push(e.message));
    return { ctx, page };
  };
  const signIn = async page => {
    await page.goto(ORIGIN + '/#/signin');
    await page.fill('input[name=code]', 'demo');
    await page.click('form.auth button');
    await page.waitForSelector('.shell');
    const skip = page.locator('#overlay button', { hasText: /skip|later|not now/i });   // the profile asked once after signing in
    if (await skip.count()) await skip.first().click();
  };
  // Opens the sample lecture on one of its tabs, scrolled so the tab row is at the top of the screen.
  const tab = async (page, name) => {
    await page.goto(ORIGIN + '/#/lecture/econ-w9'); await page.waitForSelector('.page-h h1');
    await page.locator('.tabs [role=tab]', { hasText: new RegExp('^' + name) }).click();
    await page.evaluate(() => { const r = document.querySelector('.tabs').getBoundingClientRect(); window.scrollBy(0, r.top - 12); });
  };
  const shot = async (page, name, opts = {}) => { await wait(400); await page.screenshot({ path: path.join(OUT, name), ...opts }); console.log('wrote', name); };

  // Desktop: the landing page and a lecture's notes under its slides.
  let { ctx, page } = await open({ width: 1280, height: 800 });
  await page.goto(ORIGIN + '/#/'); await page.waitForSelector('.hero');
  await wait(400); await page.locator('.dots').screenshot({ path: path.join(OUT, 'landing.png') }); console.log('wrote landing.png');   // the hero only
  await signIn(page);
  await tab(page, 'Slides');
  await shot(page, 'lecture.png');
  await ctx.close();

  // Phone: home, the notes under the slides, flashcards.
  ({ ctx, page } = await open({ width: 390, height: 844 }));
  await signIn(page);
  await page.goto(ORIGIN + '/#/home'); await page.waitForSelector('.shell');
  await shot(page, 'phone-home.png');
  await tab(page, 'Slides');
  await shot(page, 'phone-slides.png');
  await tab(page, 'Flashcards');
  await shot(page, 'phone-cards.png');
  await ctx.close();

  await browser.close();
  if (errs.length) { console.error('page errors:\n' + errs.join('\n')); process.exit(1); }
})().catch(e => { console.error(e); process.exit(1); });
