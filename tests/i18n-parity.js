// Interface language (migration step 4): for every key of the ZH dictionary, and for sentences that hit every ZHR
// pattern, trs() in the build gives exactly what it gave in sidenote.html. Also checks dayMon() in both languages.
const { execFileSync } = require('child_process');
const path = require('path');

const SAMPLES = [
  'Recording stopped for about 42 seconds while Halfold was in the background. Keep this page open with the screen on.',
  'Recording stopped for about 5 min while Halfold was in the background. Keep this page open with the screen on.',
  'The recording of this lecture is kept until 16 Nov, which is today. The notes stay after that.',
  'The recording of this lecture is kept until 16 Nov, 5 more days. The notes stay after that.',
  'The recording of this lecture is kept until 16 Nov, 1 more day. The notes stay after that.',
  'Recording kept until 11 Dec.', 'Recordings are kept for 30 days on your plan.', 'Recordings are kept for 1 day on your plan.',
  'Hi Jasper. Nothing here yet.', 'Hi Jasper', '4 lectures this week', '1 lecture this week', '3 lectures', '1 lecture', '15 days', '1 day', '0 days',
  '3 of 5 correct', '90 min', '90 of 240 recording minutes used today',
  'A recording of ECON 1001 was interrupted at 12:30, before its notes were made.', 'A recording was interrupted at 0:45, before its notes were made.',
  'All 3 lectures in one revision sheet and a mock exam, weighted towards what the lecturer flagged.', 'All 1 lecture in one revision sheet and a mock exam, weighted towards what the lecturer flagged.',
  'Midterm at 0:18', 'Deadline at 52:00', 'Exam hint at 73:08', 'Quiz at 1:35', 'Final at 9:00', 'Open transcript at 4:12', 'Said at 0:18',
  'Downloaded econ-1001-notes.md', 'Flashcards (6)', 'Quiz (5)', 'Keys 1 to 4 answer. Enter continues.',
  'Next up: midterm for ECON 1001, in 15 days.', 'Next up: deadline for ECON 1001, today.', 'Next up: exam hint for MATH 2011, in 1 day.', 'Next up: quiz for X, in 2 days.',
  'No lectures in ECON 1001 yet', 'Open ECON 1001 week 9', 'Recording ECON 1001', 'Paused ECON 1001', 'Retry the 2 you missed',
  'Card 3 of 6', 'Slide 4 of 27', 'Slide 4', 'Week 9', 'Tap the card to flip it. 2 of 6 marked as known.', 'Jasper shared these notes with you. Read only.',
  'Sample build: this transcript is sample text. The microphone is really recording, and audio is handed to the upload function every 15 seconds.',
  'Sample build: this transcript is sample text. The microphone is not recording.',
  "Microphone access was blocked. Allow it in the browser's site settings, then start again. The sample transcript below still plays so you can see the screen.",
  'Something unknown happened. The sample transcript below still plays so you can see the screen.',
  'MP3, M4A, WAV, MP4. Up to 500 MB.', 'That file is larger than 500 MB.',
  '/ New lecture', '/ ECON 1001', '/ Recording', '/ Settings', '/ Review pack', ' / Week 9',
  'ECON 1001, week 9, Tue 10 Nov, 90 min', 'ECON 1001, Today', 'ECON 1001, Principles of Microeconomics', 'ECON 1001, 26 Nov',
  ' Return', 'Recording ECON 1001 ', ' Only what is not on the slides', '\n      Home  ', ' Record one class and the notes are ready when it ends.',
  'ECON 1001', 'Opportunity cost', '', ' ', '.', '0:18', 'Today', 'week 9', 'Nothing to summarise yet. The lecturer has only covered announcements.'
];

function run(target) {
  const code = `
    process.argv.push('--target=${target}');
    const { chromium, ORIGIN } = require(${JSON.stringify(path.join(__dirname, 'harness.js'))});
    (async () => {
      const b = await chromium.launch(); const ctx = await b.newContext(); const page = await ctx.newPage();
      const errs = []; page.on('pageerror', e => errs.push(e.message));
      await page.goto(ORIGIN + '/#/'); await page.waitForFunction(() => window.__sidenote || typeof trs === 'function'); await page.waitForTimeout(300);
      const out = await page.evaluate(samples => {
        const g = n => window.__sidenote ? window.__sidenote[n] : eval(n);
        const dates = ['2026-11-16', '2026-12-11', '2027-01-01'];
        const res = { en: { dayMon: dates.map(g('dayMon')) } };
        g('setLang')('zh');
        const tr_ = g('trs'), keys = Object.keys(g('ZH'));
        res.keys = keys;
        res.zh = { dict: keys.map(k => tr_(k)), dictSpaced: keys.map(k => tr_('  ' + k + '\\n')), samples: samples.map(s => tr_(s)), dayMon: dates.map(g('dayMon')), htmlLang: document.documentElement.lang };
        g('setLang')('en'); res.backToEn = samples.map(s => tr_(s)).every((s, i) => s === samples[i]);
        return res;
      }, ${JSON.stringify(SAMPLES)});
      out.pageErrors = errs; process.stdout.write(JSON.stringify(out)); await b.close();
    })().catch(e => { console.error(e); process.exit(1); });`;
  return JSON.parse(execFileSync(process.execPath, ['-e', code], { cwd: __dirname, maxBuffer: 1 << 26 }).toString());
}

const a = run('legacy'), b = run('dist');
let pass = 0, total = 0;
const check = (name, ok, detail) => { total++; if (ok) pass++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || detail === undefined ? '' : '  -> ' + JSON.stringify(detail).slice(0, 800)}`); };
// Keys are compared by name: entries added after the migration (e.g. the landing page's example notes) are listed, not failed.
// Keys removed on purpose after the migration: sidenote.html itself no longer used them (DIFFERENCES.md part 1, item 4).
const REMOVED = [
  "Tap a timestamp and read the lecturer's exact words.",
  'Anyone with the link can read the notes, flashcards and quiz. They cannot see your other lectures.',
  'The notes, flashcards, quiz and any shared link will be removed. This cannot be undone.',
  'Slides did not upload. You can add them later.',
  'The end of your recording has not been sent yet. Keep this page open and try again when you are back online.',
  'The notes could not be written. Open the lecture to try again.'
];
const byKey = r => Object.fromEntries(r.keys.map((k, i) => [k, [r.zh.dict[i], r.zh.dictSpaced[i]]]));
const ma = byKey(a), mb = byKey(b), added = b.keys.filter(k => !(k in ma)), missing = a.keys.filter(k => !(k in mb) && !REMOVED.includes(k));
const removed = REMOVED.filter(k => k in ma && !(k in mb)), kept = a.keys.length - removed.length;
check(`all ${kept} keys of sidenote.html's dictionary that are in use are still there` + (added.length ? ` (${added.length} added since the migration)` : '') + (removed.length ? ` (${removed.length} unused keys removed)` : ''), missing.length === 0, missing);
if (added.length) console.log('      added: ' + added.map(k => JSON.stringify(k)).join(', '));
if (removed.length) console.log('      removed: ' + removed.map(k => JSON.stringify(k)).join(', '));
const bad = a.keys.filter(k => mb[k] && (ma[k][0] !== mb[k][0] || ma[k][1] !== mb[k][1]));
check(`trs() matches sidenote.html for all ${kept} dictionary keys (also with surrounding whitespace)`, bad.length === 0, bad);
const badS = SAMPLES.map((s, i) => [s, a.zh.samples[i], b.zh.samples[i]]).filter(x => x[1] !== x[2]);
check(`trs() matches sidenote.html for ${SAMPLES.length} sentences covering every ZHR pattern`, badS.length === 0, badS);
check('dayMon() matches in English and Chinese', JSON.stringify(a.en.dayMon) === JSON.stringify(b.en.dayMon) && JSON.stringify(a.zh.dayMon) === JSON.stringify(b.zh.dayMon), { legacy: [a.en.dayMon, a.zh.dayMon], dist: [b.en.dayMon, b.zh.dayMon] });
check('<html lang> is zh-Hant in Chinese, and English text is untouched after switching back', a.zh.htmlLang === b.zh.htmlLang && b.zh.htmlLang === 'zh-Hant' && a.backToEn && b.backToEn);
check('no page errors', !a.pageErrors.length && !b.pageErrors.length, [a.pageErrors, b.pageErrors]);
console.log(`\n${pass} of ${total} checks passed`);
process.exitCode = pass === total ? 0 : 1;   // a failed check fails the run (CI)
