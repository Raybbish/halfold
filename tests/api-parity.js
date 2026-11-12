// Sample mode: the mock api answers exactly as it did in sidenote.html (migration step 2).
// Runs the same calls on the original file and on the build and compares the JSON.
const { ORIGIN } = require('./harness');
const { execFileSync } = require('child_process');
const path = require('path');

const CALLS = async () => {
  const out = {};
  out.data = JSON.parse(JSON.stringify(DATA));
  out.getHome = await api.getHome();
  out.signIn = await api.signIn('a3f9c2', '');
  out.signInError = await api.signIn('  ', '').catch(e => 'error: ' + e.message);
  out.getLecture = await api.getLecture('econ-w9');
  out.getLectureNoNotes = await api.getLecture('econ-w8');
  out.getLectureMissing = await api.getLecture('nope').catch(e => 'error: ' + e.message);
  out.getShared = await api.getShared('econ-w9');
  out.getSharedMissing = await api.getShared('econ-w8').catch(e => 'error: ' + e.message);
  out.catchUp = await api.catchUp('x', [252, 408, 663, 860]);
  out.catchUpEmpty = await api.catchUp('x', [18]);
  out.packBefore = await api.getReviewPack('econ1001');
  out.makePack = await api.makeReviewPack('econ1001');
  out.packAfter = await api.getReviewPack('econ1001');
  out.plans = await api.getPlans();
  out.checkout = await api.startCheckout('plus');
  out.addPoint = await api.addPoint('econ-w9', 0, 'Mine');
  out.retry = await api.retryLecture('econ-w8');
  out.finish = await api.finishLecture('econ-w7', 0);
  out.status = await api.getStatus('econ-w7');
  out.after = JSON.parse(JSON.stringify(DATA.lectures));
  return out;
};

async function run(target) {
  // Each target runs in its own process because the harness picks its target at load time.
  const code = `
    process.argv.push('--target=${target}');
    const { chromium, ORIGIN } = require(${JSON.stringify(path.join(__dirname, 'harness.js'))});
    (async () => {
      const b = await chromium.launch(); const ctx = await b.newContext(); const page = await ctx.newPage();
      const errs = []; page.on('pageerror', e => errs.push(e.message));
      await page.goto(ORIGIN + '/#/'); await page.waitForFunction(() => typeof api !== 'undefined' && api && DATA && DATA.details);
      const out = await page.evaluate(${CALLS.toString()});
      out.pageErrors = errs; process.stdout.write(JSON.stringify(out)); await b.close();
    })().catch(e => { console.error(e); process.exit(1); });`;
  return JSON.parse(execFileSync(process.execPath, ['-e', code], { cwd: __dirname, maxBuffer: 1 << 26 }).toString());
}

(async () => {
  const [a, b] = [await run('legacy'), await run('dist')];
  let pass = 0, total = 0;
  for (const k of Object.keys(a)) {
    total++; const ok = JSON.stringify(a[k]) === JSON.stringify(b[k]);
    if (ok) pass++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  mock ${k} matches sidenote.html` + (ok ? '' : '  -> ' + JSON.stringify({ legacy: a[k], dist: b[k] }).slice(0, 600)));
  }
  console.log(`\n${pass} of ${total} checks passed`);
  process.exitCode = pass === total ? 0 : 1;   // a failed check fails the run (CI)
})();
