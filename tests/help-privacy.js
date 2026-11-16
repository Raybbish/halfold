// The public Help and Privacy pages, the landing page's new top bar, footer and sentences, and the sidebar's Help link.
// Build, sample mode (the pages are the same in both modes). Written like tests/failed-reason.js.
const { chromium, ORIGIN, setConfig } = require('./harness');
const results = [];
const check = (name, ok, detail) => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || detail === undefined ? '' : '  -> ' + JSON.stringify(detail)}`); };

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const errs = [];
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await setConfig(ctx, { USE_MOCK: true });
  const page = await ctx.newPage(); page.on('pageerror', e => errs.push(e.message));
  const text = sel => page.locator(sel).first().innerText().catch(() => '');
  const count = sel => page.locator(sel).count();

  // signed out
  await page.goto(ORIGIN + '/#/help'); await page.waitForTimeout(400);
  const helpH1 = await text('h1'), helpUrl = page.url();
  await page.goto(ORIGIN + '/#/privacy'); await page.waitForTimeout(400);
  const privacyH1 = await text('h1'), url = page.url(), privacy = await text('body');
  check('#/help and #/privacy open without signing in', helpH1 === 'Help' && privacyH1 === 'Privacy' && !url.includes('signin') && !helpUrl.includes('signin'), { helpH1, privacyH1, url, helpUrl });

  await page.goto(ORIGIN + '/#/'); await page.waitForTimeout(400);
  const navHelp = await count('.pub-nav a[href="#/help"]') > 0, footHelp = await count('footer.f a[href="#/help"]') > 0, footPrivacy = await count('footer.f a[href="#/privacy"]') > 0;
  const landing = await text('body');
  check('the landing page has Help in the top bar and Help and Privacy in the footer', navHelp && footHelp && footPrivacy, { navHelp, footHelp, footPrivacy });

  check('the privacy page names who handles the data', ['ElevenLabs', 'Deepgram', 'DeepSeek', 'Stripe', 'Resend'].every(n => privacy.includes(n)), privacy.slice(0, 200));
  check('the privacy page marks the two things still to be decided', privacy.includes('[Contact email: to be decided]') && privacy.includes('[Where the server is: to be decided]'));

  await page.goto(ORIGIN + '/#/help'); await page.waitForTimeout(400);
  const shortcuts = await page.evaluate(() => { const h = [...document.querySelectorAll('h2')].find(x => x.textContent.trim() === 'Keyboard shortcuts'); const out = []; for (let e = h && h.nextElementSibling; e && e.tagName !== 'H2'; e = e.nextElementSibling) out.push(e.innerText); return out.join(' '); });
  const keys = [...new Set((shortcuts.toLowerCase().match(/\b(arrows?|space|number keys?|enter|escape|esc|shift|ctrl|control|cmd|alt|tab|delete|backspace)\b/g) || []).map(k => k.replace(/s$/, '').replace(/^esc$/, 'escape').replace(/^number key$/, 'number')))];
  const known = ['arrow', 'space', 'number', 'enter', 'escape'];   // onLectureKey (arrows, space, 1 to 9, Enter) and the Escape listener in main.tsx
  check('help lists only keyboard keys this app has', keys.length >= 4 && keys.every(k => known.includes(k)), { keys, shortcuts });
  const help = await text('body'), sentences = help.split(/(?<=\.)\s+|\n+/);
  const ownCards = sentences.filter(x => /own cards|turn any note/i.test(x)), courseSearch = sentences.filter(x => /search/i.test(x) && /\bCourses\b/.test(x));
  check('help does not mention writing your own cards, and says the search box is on Home only (#/courses has none)', !ownCards.length && !courseSearch.length && sentences.some(x => /^On Home, the search box/.test(x)), { ownCards, courseSearch });
  check('help names the tag the notes use, "Not on slides", not "Halfnotes"', help.includes('Not on slides') && !/Halfnotes?:/.test(help), sentences.filter(x => /slides/.test(x)));

  check('landing says "Works in the browser on a laptop or a phone. Nothing to install." and keeps playing the recording from that moment',
    landing.includes('Works in the browser on a laptop or a phone. Nothing to install.') && /play the recording from that moment/.test(landing) && !/Canvas|Hong Kong/.test(landing), landing.match(/Canvas|Hong Kong/));

  // signed in
  await page.goto(ORIGIN + '/#/signin'); await page.fill('input[name=code]', 'x'); await page.click('form.auth button'); await page.waitForSelector('.shell');
  const sideHelp = await count('.side a[href="#/help"]') > 0;
  check('signed in, the sidebar has Help', sideHelp);

  // translation: no visible run of three English words outside data-notr
  const untranslated = [];
  for (const lang of ['zh-Hant', 'zh-Hans']) {
    await page.evaluate(l => window.__sidenote.setLang(l), lang);
    for (const h of ['#/help', '#/privacy', '#/']) {
      await page.goto(ORIGIN + '/' + h); await page.waitForTimeout(300);
      // On the landing page only the parts this task wrote are swept (the sample slide and the quotes were never translated: they stand for lecture content).
      const left = await page.evaluate(landing => { const out = [], w = document.createTreeWalker(document.getElementById('app'), NodeFilter.SHOW_TEXT);
        while (w.nextNode()) { const n = w.currentNode, p = n.parentElement; if (!p || p.closest('[data-notr],script,style') || (landing && !p.closest('footer.f, .niche, .pub-nav, .said > .wrap > p'))) continue; const v = n.nodeValue.trim(); if (/[A-Za-z]{3,}\s+[A-Za-z]{2,}\s+[A-Za-z]{2,}/.test(v)) out.push(v.slice(0, 70)); } return out; }, h === '#/');
      if (left.length) untranslated.push(lang + ' ' + h + ': ' + left.join(' | '));
    }
  }
  check('both pages are fully translated in 繁體 and 简体', untranslated.length === 0, untranslated);

  check('no page errors', errs.length === 0, errs);
  await browser.close();
  console.log(`\n${results.filter(Boolean).length} of ${results.length} checks passed`);
})().catch(e => { console.error('SCRIPT ERROR', String(e.message).slice(0, 1200)); process.exit(1); });
