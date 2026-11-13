// Adapted from tests/original/real5.js for the React build (see tests/harness.js). Only how the page is loaded and configured changed; the checks are as they were.
// Runs the edited page in real-backend mode (USE_MOCK=false) against a fake API served by request interception.
const fs = require('fs');
const { chromium, ORIGIN, serve, setConfig } = require('./harness');   // was: playwright from /opt/npm-tools, page from argv[2]
const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail) => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail !== undefined ? '  -> ' + JSON.stringify(detail) : ''}`); };

// 300 s of 8 kHz 8-bit mono tone as a WAV file, served with Range support like a real audio host
function wav(seconds) {
  const rate = 8000, n = seconds * rate, b = Buffer.alloc(44 + n);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate, 28); b.writeUInt16LE(1, 32); b.writeUInt16LE(8, 34); b.write('data', 36); b.writeUInt32LE(n, 40);
  for (let i = 0; i < n; i++) b[44 + i] = 128 + Math.round(20 * Math.sin(i / 6));
  return b;
}
const WAV = wav(300);

// The date in Hong Kong (where the pages run) `days` from today, as YYYY-MM-DD. The /home fixture below is dated for
// section 5's fixed clock (Thu 12 Nov 2026); sections that click an exam-radar item on the real clock use this instead,
// since the radar hides items whose date has passed.
const hkDate = days => new Date(Date.now() + days * 864e5).toLocaleDateString('en-CA', { timeZone: 'Asia/Hong_Kong' });

const DETAIL = () => ({ alerts: [{ t: 18, kind: 'Midterm', text: 'Midterm on Thu 26 Nov' }],
  sections: [{ title: 'Part one', start: 0, end: 150, points: [{ t: 30, text: 'First point', off: false, slide: null }, { t: 95, text: 'Second point', off: true, slide: null }] },
             { title: 'Part two', start: 150, end: 300, points: [{ t: 200, text: 'Third point', off: false, slide: null }] }],
  slides: [], transcript: Array.from({ length: 30 }, (_, i) => ({ t: i * 10, text: 'Transcript line ' + i })),
  flashcards: [{ q: 'q', a: 'a' }], quiz: [{ q: 'q', opts: ['a', 'b'], a: 0, why: 'w', t: 95 }] });

(async () => {
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true,
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });

  async function session(opts, fn) {
    const ctx = await browser.newContext({ viewport: opts.viewport || { width: 1280, height: 800 }, permissions: ['microphone'], timezoneId: 'Asia/Hong_Kong', ...(opts.ctx || {}) });
    await ctx.addInitScript(() => { try { if (!window.__keepTip) localStorage.setItem('sidenote.recTip', '1'); } catch (e) {} });
    const cfg = { USE_MOCK: false, CHUNK_SECONDS: opts.chunk ?? 3, ...(opts.config || {}) }; await setConfig(ctx, cfg);   // was: SRC.replace(...) on the source text
    if (opts.init) await ctx.addInitScript(opts.init);
    const page = await ctx.newPage();
    const errs = []; page.on('pageerror', e => errs.push(e.message));
    const log = [], t0 = Date.now(), deleted = new Set(); let n = 0;
    const be = { latency: opts.latency ?? 300, sessionStatus: 200, net: true, chunk500: false, expireAudio: false, audioVersion: 1, home401: false,
      lectures: [{ id: 'econ-w9', course: 'econ1001', title: 'Opportunity cost', week: 9, date: 'Tue 10 Nov', duration: 300, status: 'ready' },
                 { id: 'bad1', course: 'econ1001', title: 'Failed one', date: 'Mon 9 Nov', duration: 0, status: 'failed' },
                 { id: 'half1', course: 'econ1001', title: 'Closed early', date: 'Mon 9 Nov', duration: 0, status: 'recording' }] };
    const at = () => ((Date.now() - t0) / 1000).toFixed(1) + 's';
    await ctx.route('**/*', async route => {
      const req = route.request(), u = new URL(req.url()), m = req.method();
      if (u.pathname.startsWith('/audio/')) {
        const v = +u.searchParams.get('v');
        if (be.expireAudio && v < be.audioVersion) { log.push(`${at()} audio v${v} -> 403 expired`); return route.fulfill({ status: 403, body: 'expired' }); }
        const r = /bytes=(\d+)-(\d*)/.exec(req.headers()['range'] || '');
        if (!r) return route.fulfill({ status: 200, contentType: 'audio/wav', headers: { 'Accept-Ranges': 'bytes' }, body: WAV });
        const a = +r[1], b = r[2] ? Math.min(+r[2], WAV.length - 1) : WAV.length - 1;
        return route.fulfill({ status: 206, contentType: 'audio/wav', headers: { 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${a}-${b}/${WAV.length}` }, body: WAV.subarray(a, b + 1) });
      }
      if (!u.pathname.startsWith('/api/')) return serve(route, cfg);   // the app itself (index.html and its assets)
      const p = u.pathname.slice(4), j = (o, s = 200) => route.fulfill({ status: s, contentType: 'application/json', body: JSON.stringify(o) });
      const auth = req.headers()['authorization'] || '';
      let mm;
      if (p === '/session') { log.push(`${at()} POST /session auth=${auth ? 'yes' : 'no'} -> ${be.sessionStatus}`); return be.sessionStatus === 200 ? j({ token: 't', user: { name: 'Jasper' } }) : j({ message: 'That invite code is not valid.' }, be.sessionStatus); }
      if ((mm = p.match(/^\/shared\/([^/]+)$/))) { log.push(`${at()} GET /shared/${mm[1]} auth=${auth ? 'yes' : 'no'}`); const l = be.lectures[0]; const d = DETAIL(); if (opts.sharedAudio) d.audio = { url: ORIGIN + '/audio/a.wav?v=1' }; return mm[1] === 'econ-w9' ? j({ lecture: l, course: { id: 'econ1001', code: 'ECON 1001', name: 'Micro' }, detail: d, sharedBy: 'Jasper' }) : j({ message: 'This link is no longer shared.' }, 404); }
      if (p === '/plans') return opts.noPlans ? j({ message: 'Not found' }, 404) : j({ plans: opts.plans || [], current: opts.plans ? opts.plans[0].id : null });
      if (p === '/home') { if (be.home401) { be.home401 = false; return j({ message: 'expired' }, 401); }
        return j({ user: { name: 'Jasper' }, courses: [{ id: 'econ1001', code: 'ECON 1001', name: 'Micro' }], lectures: be.lectures,
          upcoming: opts.upcoming || [{ date: '2026-11-12', kind: 'Midterm', text: 'Midterm', course: 'ECON 1001', lecture: 'econ-w9', t: 18 }, { date: '2026-11-11', kind: 'Deadline', text: 'PS4 (yesterday, HK time)', course: 'ECON 1001', lecture: 'econ-w9', t: 30 }],
          settings: { classLanguage: 'en', zhDefault: false } }); }
      if (m === 'POST' && p === '/lectures') { const id = 'lec' + (++n); be.lectures.unshift({ id, course: 'econ1001', title: 'New', date: 'Today', duration: 0, status: 'recording' }); log.push(`${at()} POST /lectures -> ${id}`); return j(be.lectures[0]); }
      if ((mm = p.match(/^\/lectures\/([^/]+)\/chunks$/))) {
        if (!be.net) { log.push(`${at()} chunk ${mm[1]} -> network error`); return route.abort('internetdisconnected'); }
        if (be.chunk500) { log.push(`${at()} chunk ${mm[1]} -> 500`); return j({ message: 'storage is down' }, 500); }
        if (deleted.has(mm[1])) { log.push(`${at()} chunk ${mm[1]} -> 404`); return j({ message: 'Lecture not found' }, 404); }
        log.push(`${at()} chunk ${mm[1]} received`); await sleep(be.latency); log.push(`${at()} chunk ${mm[1]} answered`);
        return j({ segments: [{ t: 1, text: 'live text' }], alerts: [] }); }
      const lec = id => be.lectures.find(x => x.id === id);
      if ((mm = p.match(/^\/lectures\/([^/]+)\/finish$/))) { log.push(`${at()} finish ${mm[1]}`); const l = lec(mm[1]); if (l) { l.status = 'ready'; l.duration = 300; } return j({ status: 'processing' }); }
      if ((mm = p.match(/^\/lectures\/([^/]+)\/retry$/))) { log.push(`${at()} retry ${mm[1]}`); const l = lec(mm[1]); if (l) { l.status = 'ready'; l.duration = 300; } return j({ status: 'processing' }); }
      if ((mm = p.match(/^\/lectures\/([^/]+)\/status$/))) return j({ status: 'ready' });
      if ((mm = p.match(/^\/lectures\/([^/]+)$/))) {
        if (m === 'DELETE') { deleted.add(mm[1]); be.lectures = be.lectures.filter(x => x.id !== mm[1]); log.push(`${at()} DELETE ${mm[1]}`); return route.fulfill({ status: 204 }); }
        if (m === 'PATCH') { log.push(`${at()} PATCH ${mm[1]} -> 200 empty body`); return route.fulfill({ status: 200, body: '' }); }
        const l = lec(mm[1]); if (!l) return j({ message: 'This lecture does not exist.' }, 404);
        log.push(`${at()} GET lecture ${mm[1]}`);
        const d = l.status === 'ready' ? DETAIL() : null; if (d && !opts.noAudio) d.audio = { url: `${ORIGIN}/audio/a.wav?v=${be.audioVersion}` };
        return j({ lecture: l, detail: d }); }
      log.push(`${at()} ${m} ${p} -> 404`); return j({ message: 'Not found' }, 404);
    });
    const signin = async () => { await page.goto(ORIGIN + '/#/signin'); await page.fill('input[name=code]', 'abc'); await page.click('form.auth button'); };
    const login = async () => { await signin(); await page.waitForSelector('.shell'); };
    const startRec = async () => { await page.goto(ORIGIN + '/#/new'); await page.waitForSelector('form button.btn.blue'); await page.click('form button.btn.blue'); await page.waitForSelector('.live-top'); };
    const modalText = async () => (await page.locator('#overlay').innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
    try { await fn({ page, ctx, be, log, signin, login, startRec, modalText }); } finally { if (errs.length) check('no page errors in this scenario', false, errs); await ctx.close(); }
  }
  const txt = async l => (await l.innerText()).replace(/\s+/g, ' ').trim();

  console.log('\n=== 1. Discard a recording, then record again ===');
  await session({ chunk: 3, latency: 300 }, async ({ page, log, login, startRec }) => {
    await login(); await startRec(); await page.waitForTimeout(4000);
    await page.click('.live-actions .discard'); await page.click('text=Discard recording'); await page.waitForTimeout(1200);
    await startRec(); await page.waitForTimeout(7500);
    const after = log.slice(log.findIndex(x => x.includes('DELETE lec1')));
    check('second recording uploads its audio', after.filter(x => x.includes('chunk lec2 answered')).length >= 2, after);
    check('nothing more is sent for the discarded lecture', !after.some(x => x.includes('chunk lec1 -> 404')) || after.filter(x => x.includes('chunk lec1 -> 404')).length <= 1);
    check('queue is empty and no connection banner', (await page.evaluate(() => outbox.length)) <= 1 && !(await page.locator('.alert').allInnerTexts()).join(' ').includes('Connection'));
    check('live transcript receives text from chunk replies', (await txt(page.locator('#stream'))).includes('live text'));
  });

  console.log('\n=== 2. End a recording while the last chunk is still uploading (1 s latency) ===');
  await session({ chunk: 3, latency: 1000 }, async ({ page, log, login, startRec, modalText }) => {
    await login(); await startRec(); await page.waitForTimeout(5000);
    await page.click('.live-actions .btn.dark'); await page.waitForTimeout(700);
    const mid = await modalText();
    check('no false "Waiting for a connection"', !mid.includes('Waiting for a connection'), mid);
    await page.waitForSelector('.tabs', { timeout: 15000 });
    const fin = log.findIndex(x => x.includes('finish lec1')), lastChunk = log.map((x, i) => x.includes('chunk lec1 answered') ? i : -1).filter(i => i >= 0).pop();
    check('finish is sent only after the last chunk was answered', fin > lastChunk && !log.slice(fin).some(x => x.includes('chunk')), log);
    check('lands on the notes page of the new lecture', page.url().endsWith('#/lecture/lec1'), page.url());
  });

  console.log('\n=== 2b. Connection drops during recording, then End, then connection returns ===');
  await session({ chunk: 3, latency: 200 }, async ({ page, be, log, login, startRec, modalText }) => {
    await login(); await startRec(); await page.waitForTimeout(3500);
    be.net = false; await page.waitForTimeout(3500);
    check('offline banner is labelled Connection', (await page.locator('.alert').allInnerTexts()).join(' | ').replace(/\s+/g, ' ').includes('Connection Connection lost'), (await page.locator('.alert').allInnerTexts()).join(' | '));
    await page.click('.live-actions .btn.dark'); await page.waitForTimeout(1500);
    check('End while offline asks to try again', (await modalText()).includes('Waiting for a connection'));
    be.net = true; await page.click('button:text-is("Try again")'); await page.waitForSelector('.tabs', { timeout: 15000 });
    const fin = log.findIndex(x => x.includes('finish lec1'));
    check('after reconnecting every chunk is sent before finish', fin > 0 && log.slice(0, fin).filter(x => x.includes('chunk lec1 answered')).length >= 2 && !log.slice(fin).some(x => x.includes('chunk')), log);
  });

  console.log('\n=== 2c. Server error on a chunk is not reported as "connection lost" ===');
  await session({ chunk: 3, latency: 200 }, async ({ page, be, login, startRec }) => {
    await login(); be.chunk500 = true; await startRec(); await page.waitForTimeout(4000);
    const a = (await page.locator('.alert').allInnerTexts()).join(' | ').replace(/\s+/g, ' ');
    check('banner says the audio could not be saved', a.includes('could not save the audio'), a);
    be.chunk500 = false; await page.waitForTimeout(11000);
    check('banner clears once the server recovers', !(await page.locator('.alert').allInnerTexts()).join(' ').includes('could not save'));
    await page.click('.discard'); await page.click('text=Discard recording');
  });

  console.log('\n=== 3. "No body" endpoint answers 200 with an empty body (rename) ===');
  await session({}, async ({ page, login }) => {
    await login(); await page.goto(ORIGIN + '/#/lecture/econ-w9'); await page.waitForSelector('.tabs');
    await page.click('.page-h button:text-is("More")'); await page.click('text=Rename'); await page.fill('input[name=t]', 'Renamed'); await page.click('text=Save title');
    await page.waitForSelector('.toast');
    check('rename succeeds', (await txt(page.locator('.toast'))) === 'Title saved' && (await txt(page.locator('.page-h h1'))) === 'Renamed', await txt(page.locator('.toast')));
  });

  console.log('\n=== 4. Sign-in errors and expired sessions ===');
  await session({}, async ({ page, be, log, signin }) => {
    be.sessionStatus = 401; await signin(); await page.waitForSelector('.err');
    check('wrong invite code shows the server message even with 401', (await txt(page.locator('.err'))) === 'That invite code is not valid.', await txt(page.locator('.err')));
    be.sessionStatus = 200; await page.click('form.auth button'); await page.waitForSelector('.shell');
    await page.goto(ORIGIN + '/#/course/econ1001'); await page.waitForSelector('.page-h');
    be.home401 = true; await page.evaluate(() => { S.homeLoaded = false; route(); }); await page.waitForSelector('form.auth');
    await page.fill('input[name=code]', 'abc'); await page.click('form.auth button'); await page.waitForSelector('.shell');
    check('after an expired session the student returns to the same page', page.url().endsWith('#/course/econ1001'), page.url());
    await page.goto(ORIGIN + '/#/s/econ-w9'); await page.waitForSelector('.shared-bar');
    check('shared pages are fetched without the token', log.some(x => x.includes('GET /shared/econ-w9 auth=no')), log.filter(x => x.includes('shared')));
  });

  console.log('\n=== 5. Hong Kong clock = Thu 12 Nov 2026 02:00, /home has no `today` ===');
  await session({}, async ({ page, login }) => {
    await page.clock.setFixedTime(new Date('2026-11-12T02:00:00+08:00')); await login();
    const radar = (await page.locator('.grid2 .card:nth-child(2) li').allInnerTexts()).map(s => s.replace(/\s+/g, ' '));
    check('today() is the local date', (await page.evaluate(() => today())) === '2026-11-12');
    check('midterm on 12 Nov counts as today and yesterday\'s deadline is hidden', radar.length === 1 && radar[0].startsWith('0 days Midterm') && (await txt(page.locator('.hello p'))).includes('today'), radar);
  });

  console.log('\n=== 6. Failed and unfinished lectures ===');
  await session({}, async ({ page, log, login }) => {
    await login(); await page.goto(ORIGIN + '/#/home'); await page.waitForSelector('#lecList');
    const rows = (await page.locator('#lecList li').allInnerTexts()).map(s => s.replace(/\s+/g, ' '));
    check('home marks failed and unfinished lectures', rows.some(r => r.includes('Failed one') && r.includes('Not written')) && rows.some(r => r.includes('Closed early') && r.includes('Not finished')), rows);
    await page.goto(ORIGIN + '/#/lecture/bad1'); await page.waitForSelector('.main .card h3');
    check('failed lecture explains and offers a retry', (await txt(page.locator('.main .card').first())).startsWith('These notes could not be written'), await txt(page.locator('.main .card').first()));
    await page.click('button:text-is("Try again")'); await page.waitForSelector('.tabs', { timeout: 15000 });
    check('retry calls POST /retry and opens the notes', log.some(x => x.includes('retry bad1')) && page.url().endsWith('#/lecture/bad1'));
    await page.goto(ORIGIN + '/#/lecture/half1'); await page.waitForSelector('.main .card h3');
    check('unfinished recording can still be turned into notes', (await txt(page.locator('.main .card').first())).startsWith('This recording was not finished'));
    await page.click('text=Make notes from what was saved'); await page.waitForSelector('.tabs', { timeout: 15000 });
    check('that calls finish for the unfinished lecture', log.some(x => x.includes('finish half1')));
  });

  console.log('\n=== 7. Example notes link ===');
  await session({}, async ({ page }) => { await page.goto(ORIGIN + '/#/'); await page.click('text=Open example notes'); await page.waitForSelector('.shared-bar');
    check('example link opens the shared lecture named in CONFIG', (await txt(page.locator('.page-h h1'))) === 'Opportunity cost'); });
  await session({ config: { EXAMPLE_SHARE_ID: null } }, async ({ page }) => { await page.goto(ORIGIN + '/#/');
    check('with EXAMPLE_SHARE_ID null the links are hidden', (await page.locator('text=example notes').count()) === 0 && (await page.locator('text=Example notes').count()) === 0);
    await page.goto(ORIGIN + '/#/signin'); check('sign-in page has no dead example link', !(await txt(page.locator('form.auth'))).includes('example notes')); });

  console.log('\n=== 8. Playback with a real audio file (300 s WAV, Range requests) ===');
  for (const [label, viewport, ctx] of [['desktop', { width: 1280, height: 800 }, {}], ['phone', { width: 390, height: 780 }, { isMobile: true, hasTouch: true }]]) {
    // Runs on the real clock (playback needs real time), so the midterm it opens from the radar is dated two weeks from today.
    const upcoming = [{ date: hkDate(14), kind: 'Midterm', text: 'Midterm', course: 'ECON 1001', lecture: 'econ-w9', t: 18 }];
    await session({ viewport, ctx, upcoming }, async ({ page, login }) => {
      await login(); await page.goto(ORIGIN + '/#/lecture/econ-w9'); await page.waitForSelector('#pPlay');
      const st = () => page.evaluate(() => ({ t: pl.a.currentTime, paused: pl.a.paused, rate: pl.a.playbackRate, dur: pl.a.duration, cur: document.getElementById('pCur').textContent, head: document.querySelector('.tl .head').style.left, bar: document.getElementById('pBar').value, tab: state.tab, hit: state.hit, hitEl: (document.querySelector('.seg-line.hit') || {}).id }));
      await page.waitForFunction(() => pl.a && pl.a.readyState >= 1);
      check(`[${label}] audio metadata loads`, Math.round((await st()).dur) === 300, (await st()).dur);
      await page.locator('.pt .ts').nth(1).click(); await page.waitForTimeout(500); let s = await st();
      check(`[${label}] tapping 1:35 seeks the recording and opens that transcript line, still paused`, Math.round(s.t) === 95 && s.paused && s.tab === 'transcript' && s.hit === 90 && s.hitEl === 'seg-90' && s.cur === '1:35', s);
      if (label === 'phone') await page.locator('#pPlay').tap(); else await page.click('#pPlay');
      await page.waitForTimeout(6500); s = await st();
      check(`[${label}] play advances time, bar, timeline head and transcript line`, !s.paused && s.t > 100 && s.t < 104 && s.hit === 100 && s.hitEl === 'seg-100' && parseFloat(s.head) > 33 && +s.bar >= 100, s);
      await page.click('#pRate'); await page.click('.pb.fwd'); await page.waitForTimeout(400); s = await st();
      check(`[${label}] speed 1.25x and +15 s`, s.rate === 1.25 && s.t > 115 && s.t < 121 && (await txt(page.locator('#pRate'))) === '1.25×', s);
      await page.locator('#pBar').evaluate(el => { el.value = 250; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }); await page.waitForTimeout(500); s = await st();
      check(`[${label}] dragging the bar seeks`, s.t >= 250 && s.t < 253 && s.hit === 250, s);
      await page.click('.tabs button:nth-child(1)'); await page.waitForTimeout(300);
      check(`[${label}] playback survives switching tabs`, !(await st()).paused && (await page.locator('.player').count()) === 1);
      await page.click('#pPlay'); await page.waitForTimeout(200);
      const box = await page.locator('.player').boundingBox(), vh = viewport.height, nav = await page.locator('.mnav').boundingBox();
      check(`[${label}] player stays on screen` + (label === 'phone' ? ' above the bottom navigation' : ''), box.y + box.height <= (label === 'phone' ? nav.y : vh) && box.y > vh / 2, { player: box, nav });
      await page.goto(ORIGIN + '/#/home'); await page.waitForSelector('#lecList');
      check(`[${label}] leaving the lecture stops playback`, await page.evaluate(() => pl.a === null));
      await page.click('text=Said at 0:18'); await page.waitForSelector('#pPlay'); await page.waitForFunction(() => pl.a && pl.a.readyState >= 1); await page.waitForTimeout(300);
      check(`[${label}] "Said at 0:18" on the exam radar opens the recording at 0:18`, Math.round(await page.evaluate(() => pl.a.currentTime)) === 18);
    });
  }

  console.log('\n=== 8b. Signed audio link expires while listening ===');
  await session({}, async ({ page, be, log, login }) => {
    await login(); await page.goto(ORIGIN + '/#/lecture/econ-w9'); await page.waitForSelector('#pPlay'); await page.waitForFunction(() => pl.a && pl.a.readyState >= 1);
    be.expireAudio = true; be.audioVersion = 2;
    await page.evaluate(() => { pl.a.src = pl.url; }); // the browser re-requests the stale link, as it would after the cache is dropped
    await page.waitForFunction(() => pl.url && pl.url.endsWith('v=2') && pl.a.readyState >= 1, null, { timeout: 8000 }).catch(() => {});
    check('player fetches a fresh link once and carries on', await page.evaluate(() => pl.url.endsWith('v=2') && !pl.err && pl.a.readyState >= 1), log.filter(x => x.includes('audio') || x.includes('GET lecture')));
  });

  console.log('\n=== 8c. Lecture without audio, and shared pages ===');
  await session({ noAudio: true }, async ({ page, login }) => { await login(); await page.goto(ORIGIN + '/#/lecture/econ-w9'); await page.waitForSelector('.tabs');
    check('no audio in the reply -> no player, timestamps still open the transcript', (await page.locator('.player').count()) === 0);
    await page.locator('.pt .ts').nth(1).click(); await page.waitForTimeout(300); check('timestamp still highlights the line', (await page.locator('.seg-line.hit').getAttribute('id')) === 'seg-90'); });
  await session({ sharedAudio: true }, async ({ page }) => { await page.goto(ORIGIN + '/#/s/econ-w9'); await page.waitForSelector('.shared-bar');
    check('shared page hides the recording while SHARE_AUDIO is false, even if the backend sends it', (await page.locator('.player').count()) === 0); });
  await session({ sharedAudio: true, config: { SHARE_AUDIO: true } }, async ({ page }) => { await page.goto(ORIGIN + '/#/s/econ-w9'); await page.waitForSelector('.shared-bar');
    check('with SHARE_AUDIO true the shared page gets the player', (await page.locator('.player').count()) === 1); });

  console.log('\n=== 9. Recording robustness ===');
  await session({ chunk: 3 }, async ({ page, login, startRec }) => {
    await login(); await startRec(); await page.waitForTimeout(5200);
    const sec = await page.evaluate(() => live.sec); check('clock follows real time', sec >= 4 && sec <= 6, sec);
    check('recorder uses the configured bitrate', (await page.evaluate(() => rec.mr.audioBitsPerSecond)) === 32000, await page.evaluate(() => rec.mr.audioBitsPerSecond));
    await page.evaluate(() => rec.stream.getAudioTracks()[0].dispatchEvent(new Event('ended'))); await page.waitForTimeout(300);
    check('a microphone that stops is reported', (await page.locator('.alert').allInnerTexts()).join(' ').includes('The microphone stopped'));
    await page.click('.discard'); await page.click('text=Discard recording');
    await page.goto(ORIGIN + '/#/settings'); await page.waitForSelector('text=Sign out'); await startRec(); await page.goto(ORIGIN + '/#/settings'); await page.click('button:text-is("Sign out")'); await page.waitForTimeout(300);
    check('sign-out is refused while recording', (await txt(page.locator('.toast').last())).includes('End or discard the recording') && await page.evaluate(() => live.active && !!S.token));
  });
  await session({ chunk: 3, viewport: { width: 390, height: 780 }, ctx: { isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1' } }, async ({ page, login, startRec }) => {
    await login(); await startRec(); await page.waitForTimeout(2200);
    const hide = h => page.evaluate(h => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => h }); document.dispatchEvent(new Event('visibilitychange')); }, h);
    const before = await page.evaluate(() => live.sec); await hide(true); await page.waitForTimeout(4000); const during = await page.evaluate(() => live.sec); await hide(false); await page.waitForTimeout(400);
    const note = (await page.locator('.alert').allInnerTexts()).join(' ').replace(/\s+/g, ' ');
    check('[iPhone] clock waits while the page is in the background', during - before <= 1, { before, during });
    check('[iPhone] returning shows how long recording stopped', /Recording stopped for about 4 seconds/.test(note), note);
    const bar = await page.locator('.live-actions').boundingBox();
    check('[phone] End and Pause sit in a bar at the bottom of the screen', bar.y + bar.height >= 778 && bar.y > 680 && (await page.locator('.mnav').count()) === 0, bar);
  });

  console.log('\n=== 10. New design: unfinished recordings kept on this device ===');
  await session({ chunk: 3, latency: 100 }, async ({ page, ctx, be, log, login, startRec }) => {
    await login(); await startRec(); await page.waitForTimeout(4000);
    await page.click('.live-actions .discard'); await page.click('text=Discard recording'); await page.waitForTimeout(1200);
    await page.reload(); await page.waitForSelector('.shell'); await page.waitForTimeout(900);
    check('discarding leaves nothing behind: no "Unfinished" notice after a reload', (await page.locator('.main .alert').count()) === 0 && (await page.evaluate(async () => ((await idb.all()) || []).length)) === 0, await page.locator('.main .alert').allInnerTexts());
    await startRec(); await page.waitForTimeout(3600); be.net = false; await page.waitForTimeout(6500);
    const p2 = await ctx.newPage(); await p2.goto(ORIGIN + '/#/home'); await p2.waitForSelector('#lecList'); await p2.waitForTimeout(900);
    check('a second tab does not treat the running recording as interrupted', (await p2.locator('.main .alert').count()) === 0 && await page.evaluate(() => live.active), await p2.locator('.main .alert').allInnerTexts());
    const queued = await page.evaluate(() => outbox.length); await page.close();                               // the tab is closed in the middle of the lecture
    await p2.reload(); await p2.waitForSelector('#lecList'); await p2.waitForTimeout(900);
    const note = (await p2.locator('.main .alert').allInnerTexts()).join(' ').replace(/\s+/g, ' ');
    check('after the recording tab is closed, the other tab offers the unfinished recording at once', note.includes('Unfinished A recording of ECON 1001 was interrupted') && queued >= 2, { note, queued });
    const before = log.length; be.net = true; await p2.click('text=Make notes from it'); await p2.waitForSelector('.tabs', { timeout: 20000 });
    const tail = log.slice(before), fin = tail.findIndex(x => x.includes('finish lec2'));
    check('"Make notes from it" sends the saved audio, then finishes the lecture', fin >= 0 && tail.slice(0, fin).filter(x => x.includes('chunk lec2 answered')).length >= queued && (await p2.evaluate(async () => ((await idb.all()) || []).length)) === 0, tail);
    await p2.goto(ORIGIN + '/#/home'); await p2.waitForSelector('#lecList'); check('the notice is gone afterwards', (await p2.locator('.main .alert').count()) === 0);
  });

  console.log('\n=== 11. New design: settings, plans, online-class option ===');
  await session({ noPlans: true }, async ({ page, login }) => { await login(); await page.goto(ORIGIN + '/#/settings'); await page.waitForSelector('text=Plan and usage');
    check('Settings opens even when the backend has no /plans yet', (await page.locator('button:text-is("Sign out")').count()) === 1); });
  await session({ plans: [{ id: 'free', name: 'Free', priceText: 'HK$0', features: ['Recordings kept 30 days'] }, { id: 'plus', name: 'Plus', priceText: 'HK$38 / month', features: ['Recordings kept all year'] }] }, async ({ page, login }) => {
    await login(); await page.goto(ORIGIN + '/#/settings'); await page.waitForSelector('.plans');
    check('plans from the backend are listed with the current one marked', (await page.locator('.plan').count()) === 2 && (await page.locator('.plan.cur').innerText()).includes('Free')); });
  await session({ init: () => { try { Object.defineProperty(navigator.mediaDevices, 'getDisplayMedia', { value: undefined, configurable: true }); } catch (e) {} }, viewport: { width: 390, height: 780 }, ctx: { isMobile: true, hasTouch: true } }, async ({ page, login }) => {
    await login(); await page.goto(ORIGIN + '/#/new'); await page.waitForSelector('.choice');
    check('where a tab cannot be shared (phones) the online-class option is not offered', (await page.locator('.choice button').count()) === 3, await page.locator('.choice button').allInnerTexts()); });
  await session({}, async ({ page, login }) => { await login(); await page.goto(ORIGIN + '/#/new'); await page.waitForSelector('.choice');
    check('on a desktop browser the online-class option is offered', (await page.locator('.choice button').count()) === 4); });

  await browser.close();
  console.log(`\n${results.filter(Boolean).length} of ${results.length} checks passed`);
})().catch(e => { console.error('SCRIPT ERROR', String(e.message).slice(0, 1200)); process.exit(1); });
