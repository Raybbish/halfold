const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const FILE = 'file://' + process.argv[2];
(async () => {
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 794, height: 1123 } }); const page = await ctx.newPage();
  await page.goto(FILE + '#/signin'); await page.fill('input[name=code]', 'x'); await page.click('form.auth button'); await page.waitForSelector('.shell');
  await page.goto(FILE + '#/lecture/econ-w9'); await page.waitForSelector('.tabs');
  await page.emulateMedia({ media: 'print' }); await page.waitForTimeout(300);
  const vis = await page.evaluate(() => ['.mtop', '.mnav', '.player', '.side', '.tabs', '.tl', '.btn'].map(s => { const el = document.querySelector(s); return s + ':' + (el && el.offsetParent !== null ? 'shown' : 'hidden'); }));
  console.log('print view of the notes page ->', vis.join('  '), '| main padding:', await page.evaluate(() => getComputedStyle(document.querySelector('.main')).padding));
  await page.screenshot({ path: 'shots5/print-notes.png' });
  await browser.close();
})().catch(e => { console.error('SCRIPT ERROR', String(e.message).slice(0, 600)); process.exit(1); });
