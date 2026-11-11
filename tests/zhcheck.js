// Adapted from tests/original/zhcheck.js for the React build (see tests/harness.js). Only how the page is loaded and configured changed; the checks are as they were.
// Chinese interface on the merged file (sample mode): lecture content stays as it is, every added string is translated.
const fs = require('fs');
const { chromium, ORIGIN } = require('./harness');   // was: playwright from /opt/npm-tools, page from argv[2]
const FILE = ORIGIN + '/';   // was: 'file://' + argv[2]; the build uses module scripts, which do not run from file://
const results = []; const check = (name, ok, detail) => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail !== undefined ? '  -> ' + JSON.stringify(detail) : ''}`); };
(async () => {
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true, permissions: ['microphone'] }); const page = await ctx.newPage(); const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.goto(FILE + '#/'); await page.click('.lang');
  await page.goto(FILE + '#/signin'); await page.fill('input[name=code]', 'x'); await page.click('form.auth button'); await page.waitForSelector('.shell');
  await page.evaluate(() => { const d = DATA.detail; d.transcript.unshift({ t: 5, text: 'Hi everyone, welcome back.' }, { t: 9, text: 'Recording is on, so let us begin.' });
    d.flashcards.unshift({ q: 'Which exam covers chapters 1 to 8?', a: 'Final' }); d.sections[0].points.unshift({ t: 6, text: 'Today', slide: 3 }); d.quiz.unshift({ q: 'Quiz', opts: ['English', 'Notes'], a: 0, why: 'Answer', t: 6 });
    DATA.lectures[0].title = 'Recording techniques'; });
  await page.goto(FILE + '#/lecture/econ-w9'); await page.waitForSelector('.tabs');
  check('note text from the backend is left alone', (await page.locator('.pt .body span[data-notr]').first().innerText()) === 'Today');
  check('lecture title is left alone', (await page.locator('.page-h h1').innerText()) === 'Recording techniques');
  check('interface around it is Chinese', (await page.locator('.tabs button').first().innerText()) === '筆記' && (await page.locator('.mnav').innerText()).replace(/\s+/g, ' ') === '主頁 新增課堂 課程', (await page.locator('.mnav').innerText()).replace(/\s+/g, ' '));
  check('player labels are Chinese', (await page.locator('#pPlay').getAttribute('aria-label')) === '播放錄音' && (await page.locator('.pb.back').getAttribute('aria-label')) === '後退 15 秒');
  await page.click('#pPlay'); await page.waitForTimeout(300);
  check('label follows the state between renders', (await page.locator('#pPlay').getAttribute('aria-label')) === '暫停播放'); await page.click('#pPlay');
  await page.click('.tabs button:nth-child(3)'); await page.waitForTimeout(200);
  check('transcript lines are left alone', JSON.stringify((await page.locator('.seg-line div').allInnerTexts()).slice(0, 2)) === JSON.stringify(['Hi everyone, welcome back.', 'Recording is on, so let us begin.']), (await page.locator('.seg-line div').allInnerTexts()).slice(0, 2));
  await page.click('.tabs button:nth-child(4)'); await page.click('.flip'); await page.waitForTimeout(200);
  check('flashcard answer is left alone', (await page.locator('.flip .f.b').innerText()) === 'Final');
  await page.click('.tabs button:nth-child(5)'); await page.click('.qz .opt >> nth=0'); await page.waitForTimeout(200);
  check('quiz question, options and explanation are left alone', (await page.locator('.qz h3').innerText()) === 'Quiz' && JSON.stringify(await page.locator('.qz .opt').allInnerTexts()) === '["English","Notes"]' && (await page.locator('.qz .why span[data-notr]').innerText()) === 'Answer');
  const t = await page.evaluate(() => [
    'Recording stopped for about 42 seconds while Sidenote was in the background. Keep this page open with the screen on.',
    'Recording stopped for about 5 min while Sidenote was in the background. Keep this page open with the screen on.',
    'The recording of this lecture is kept until ' + dayMon('2026-11-16') + ', 5 more days. The notes stay after that.',
    'The recording of this lecture is kept until ' + dayMon('2026-11-11') + ', which is today. The notes stay after that.',
    'Recording kept until ' + dayMon('2026-12-11') + '.', 'Recordings are kept for 30 days on your plan.', 'Recording ECON 1001',
    'These notes could not be written', 'Make notes from what was saved', 'Not written', 'Not finished', 'End or discard the recording before signing out.',
    'The recording, notes, flashcards, quiz and any shared link will be removed. This cannot be undone.', 'Download recording', 'See plans', 'Connection'].map(trs));
  console.log(t.join('\n'));
  check('every added message has a Chinese version', t.every(x => /[一-鿿]/.test(x)) && t[2].includes('11月16日') && t[6] === '正在錄音 ECON 1001');
  // every English string in the added code is either in the dictionary or matched by a pattern
  const added = ['Main', 'Return to the recording', 'Record', 'Upload', 'Online class', 'Recording of this lecture', 'Play recording', 'Pause recording', 'Position in the recording', 'Back 15 seconds', 'Forward 15 seconds', 'Playback speed',
    'The recording could not be played.', 'Sample build: playback is simulated, so there is no sound.', 'This lecture is being recorded', 'The notes are written when you end the recording.', 'This recording was not finished',
    'The page was closed before the recording ended. Sid can still write notes from the part that was saved.', 'Your recording is safe. Sid can try again from it.', 'This usually takes a minute or two.',
    'The notes could not be written. You can try again from the lecture.', 'The microphone stopped. End the recording to keep what you have so far.',
    'Sidenote could not save the audio just now. Recording continues and it will keep trying. Keep this page open.', 'The end of your recording has not been sent yet. Keep this page open and try again in a moment.',
    'Slides did not upload. The notes will be made without them.', 'The server sent a reply Sidenote could not read.', 'No code? Ask a classmate who uses Sidenote.',
    'The recording of this lecture is no longer kept. The notes, transcript, flashcards and quiz are still here.', "Tap a timestamp to read the lecturer's exact words, or play the recording from that moment.",
    'Anyone with the link can read the notes, transcript, flashcards and quiz. The recording stays private. They cannot see your other lectures.', 'Courses', 'Try again', 'Recording', 'Settings'];
  const miss = await page.evaluate(a => a.filter(x => trs(x) === x), added);
  check('no added string is left in English', miss.length === 0, miss);
  // sweep the visible pages for leftover English interface text (anything outside data-notr that still has 3+ Latin words)
  const left = {};
  for (const h of ['#/home', '#/courses', '#/course/econ1001', '#/lecture/econ-w9', '#/new', '#/settings', '#/pack/econ1001']) { await page.goto(FILE + h); await page.waitForTimeout(500);
    const r = await page.evaluate(() => { const out = [], w = document.createTreeWalker(document.getElementById('app'), NodeFilter.SHOW_TEXT); while (w.nextNode()) { const n = w.currentNode, p = n.parentElement; if (!p || p.closest('[data-notr],script,style') || !p.offsetParent) continue; const v = n.nodeValue.trim(); if (/[A-Za-z]{3,}\s+[A-Za-z]{2,}\s+[A-Za-z]{2,}/.test(v)) out.push(v.slice(0, 70)); } return out; });
    if (r.length) left[h] = r; }
  console.log('English interface text still visible in Chinese mode, by page:', JSON.stringify(left, null, 1));
  if (errs.length) check('no page errors', false, errs);
  await browser.close(); console.log(`\n${results.filter(Boolean).length} of ${results.length} checks passed`);
})().catch(e => { console.error('SCRIPT ERROR', String(e.message).slice(0, 900)); process.exit(1); });
