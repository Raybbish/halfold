// Lectures that never got their notes (batch 1, item 5). A lecture still "recording" that is not being recorded or
// uploaded right now offers buttons by how it was made: a recording (or tab) can be finished from what was recorded; an
// upload whose file never arrived can only have the file sent again (the server refuses to make notes without it); a
// link lecture makes its notes from the link; no source behaves like a recording. A failed lecture gets "Delete lecture"
// beside "Try again". Real-backend mode (fake API by request interception, every request logged).
const { chromium, ORIGIN, serve, setConfig } = require('./harness');
const results = [];
const check = (name, ok, detail) => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || detail === undefined ? '' : '  -> ' + JSON.stringify(detail)}`); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const KB = 1024;

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--no-sandbox'] });
  const errs = [], log = [], posts = [];
  const lec = (id, status, extra) => ({ id, course: 'c1', title: 'Week 9', date: 'Today', status, ...extra });
  let LECTURES = [lec('lrec', 'recording', { source: 'record' }), lec('ltab', 'recording', { source: 'tab' }), lec('lup', 'recording', { source: 'upload' }), lec('lup2', 'recording', { source: 'upload' }), lec('lhold', 'recording', { source: 'upload' }), lec('llink0', 'recording', { source: 'link' }), lec('llink', 'recording', { source: 'link', link: 'https://vimeo.com/1' }),
    lec('lold', 'recording'), lec('lfail', 'failed', { source: 'record' }), lec('lfail2', 'failed', { source: 'record' }), lec('lorph', 'recording', { source: 'record' })];
  const cfg = { USE_MOCK: false, POLL_MS: 50, MAX_UPLOAD_MB: 1 };
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, permissions: ['microphone'] });
  await setConfig(ctx, cfg);
  await ctx.addInitScript(() => { try { localStorage.setItem('sidenote.recTip', '1'); } catch (e) {} });
  await ctx.route('**/*', async route => {
    const req = route.request(), u = new URL(req.url()), m = req.method(), j = (o, s = 200) => route.fulfill({ status: s, contentType: 'application/json', body: JSON.stringify(o) }).catch(() => {});
    if (!u.pathname.startsWith('/api/')) return serve(route, cfg);
    const p = u.pathname.slice(4); log.push(m + ' ' + p);
    if (p === '/session') return j({ token: 'tok', user: { name: 'T' } });
    if (p === '/home') return j({ user: { name: 'T' }, courses: [{ id: 'c1', code: 'TEST 1001' }], lectures: LECTURES, upcoming: [], settings: { classLanguage: 'en', zhDefault: false } });
    if (m === 'POST' && p === '/lectures') { const n = lec('llive', 'recording', { source: 'record' }); LECTURES = [n, ...LECTURES]; return j(n); }
    let mm = /^\/lectures\/(\w+)$/.exec(p);
    if (m === 'GET' && mm) { const l = LECTURES.find(x => x.id === mm[1]); return l ? j({ lecture: l, detail: null }) : j({ message: 'Not found' }, 404); }
    if (m === 'DELETE' && mm) { LECTURES = LECTURES.filter(x => x.id !== mm[1]); return route.fulfill({ status: 204 }).catch(() => {}); }
    if (m === 'POST' && (mm = /^\/lectures\/(\w+)\/recording$/.exec(p))) { posts.push(p); if (mm[1] === 'lhold') return new Promise(() => {}); return route.fulfill({ status: 204 }).catch(() => {}); }
    if (m === 'POST' && (mm = /^\/lectures\/(\w+)\/(finish|retry)$/.exec(p))) { const l = LECTURES.find(x => x.id === mm[1]); if (l) l.status = 'processing'; return j({ status: 'processing' }); }
    if (m === 'POST' && /\/chunks$/.test(p)) return j({});
    if (/\/status$/.test(p)) return j({ status: 'processing' });
    return j({ message: 'Not found' }, 404);
  });
  const page = await ctx.newPage(); page.on('pageerror', e => errs.push(e.message));
  await page.goto(ORIGIN + '/#/signin'); await page.fill('input[name=code]', 'abc'); await page.click('form.auth button'); await page.waitForSelector('.shell');
  const go = async id => { await page.evaluate(id => { location.hash = '#/lecture/' + id; }, id); await page.waitForSelector('.main .card h3'); await sleep(200); };
  const btns = async id => { await go(id); return (await page.locator('.main .card .brow .btn, .main .card .brow a.btn').allInnerTexts()).join('|'); };
  const h3 = () => page.locator('.main .card h3').first().innerText();

  const rec = await btns('lrec');
  check('a recorded lecture never finished: finish from what was recorded or delete, and no way to send a file', rec === 'Make notes from what was recorded|Delete lecture', rec);
  check('the card says it was never finished', await h3() === 'This lecture was never finished' && (await page.locator('.main .card p.muted').first().innerText()).startsWith('It was started'));
  const tab = await btns('ltab');
  check('a tab recording: the same', tab === 'Make notes from what was recorded|Delete lecture', tab);
  const upl = await btns('lup');
  check('an upload whose file never arrived: "Send a recording file" first, then "Delete lecture"', upl === 'Send a recording file|Delete lecture', upl);
  const lnk = await btns('llink');
  check('a link lecture with its link: "Make notes from the link" and "Delete lecture"', lnk === 'Make notes from the link|Delete lecture', lnk);
  const lnk0 = await btns('llink0');
  check('a link lecture whose link never attached: only "Delete lecture"', lnk0 === 'Delete lecture', lnk0);
  await go('lhold');
  await page.setInputFiles('#fRe', { name: 'week9.m4a', mimeType: 'audio/mp4', buffer: Buffer.alloc(100 * KB, 1) });
  await page.waitForSelector('.main h3:text-is("Uploading the recording")', { timeout: 5000 }).catch(() => {});
  const during = await h3();
  await page.reload(); await page.waitForSelector('.main .card h3'); await sleep(300);
  const afterReload = (await page.locator('.main .card .brow .btn').allInnerTexts()).join('|');
  check('after a reload mid-upload the lecture offers "Send a recording file"', during === 'Uploading the recording' && afterReload === 'Send a recording file|Delete lecture', { during, afterReload });
  const old = await btns('lold');
  check('a lecture without source behaves like a recording', old === 'Make notes from what was recorded|Delete lecture', old);

  await go('llink'); log.length = 0;
  await page.click('button:text-is("Make notes from the link")'); await page.waitForSelector('.main h3:text-is("Hal is writing your notes")', { timeout: 5000 }).catch(() => {});
  check('Make notes from the link asks the server to finish the lecture', log.includes('POST /lectures/llink/finish'), log);

  await go('lrec'); log.length = 0;
  await page.click('button:text-is("Make notes from what was recorded")'); await page.waitForSelector('.main h3:text-is("Hal is writing your notes")', { timeout: 5000 }).catch(() => {});
  check('Make notes from what was recorded calls /finish', log.includes('POST /lectures/lrec/finish'), log);

  await go('lup'); log.length = 0;
  await page.setInputFiles('#fRe', { name: 'week9.m4a', mimeType: 'audio/mp4', buffer: Buffer.alloc(100 * KB, 1) });
  await page.waitForSelector('.main h3:text-is("Hal is writing your notes")', { timeout: 5000 }).catch(() => {});
  check('Send a recording file uploads to the same lecture and then calls /finish', posts.includes('/lectures/lup/recording') && log.includes('POST /lectures/lup/finish'), { posts, log });

  await go('lold'); log.length = 0; posts.length = 0;
  await page.click('button:text-is("Delete lecture")'); await sleep(200);
  const askedFirst = await page.locator('#overlay .modal h3').innerText().catch(() => '');
  check('Delete lecture asks first and nothing is deleted yet', askedFirst === 'Delete this lecture?' && !log.some(x => x.startsWith('DELETE')), { askedFirst, log });

  await go('lfail');
  const fb = (await page.locator('.main .card .brow .btn').allInnerTexts()).join('|');
  check('a failed lecture: "Try again" and "Delete lecture"', fb === 'Try again|Delete lecture', fb);
  log.length = 0;
  await page.click('.main .card button:text-is("Delete lecture")'); await sleep(200);
  const ask = await page.locator('#overlay .modal h3').innerText().catch(() => '');
  await page.click('#overlay .modal button:text-is("Delete lecture")'); await sleep(500);
  check('Delete lecture asks first, then deletes and leaves the page', ask === 'Delete this lecture?' && log.includes('DELETE /lectures/lfail') && !page.url().endsWith('lfail'), { ask, log, url: page.url() });
  await go('lfail2'); log.length = 0;
  await page.click('.main .card button:text-is("Try again")'); await sleep(300);
  check('Try again still calls /retry', log.includes('POST /lectures/lfail2/retry'), log);

  // A file over the limit is refused with a notice and nothing is sent.
  await go('lup2'); posts.length = 0; await page.evaluate(() => { document.querySelectorAll('.toast').forEach(e => e.remove()); });
  await page.setInputFiles('#fRe', { name: 'big.m4a', mimeType: 'audio/mp4', buffer: Buffer.alloc(1100 * KB, 1) }); await sleep(400);
  const toastText = await page.locator('.toast').last().innerText().catch(() => '');
  check('a file over the limit is refused and not sent', /larger than 1 MB/.test(toastText) && !posts.length && await h3() === 'This lecture was never finished', { toastText, posts });

  // A recording on this device that was cut off by a closed tab (its mark in localStorage, a piece of audio in IndexedDB):
  // deleting its lecture from the "never finished" card also forgets it here, so the "was interrupted" notice is gone,
  // and stays gone after a reload.
  await page.evaluate(async () => { localStorage.setItem('sidenote.live', JSON.stringify({ id: 'lorph', code: 'TEST 1001', sec: 45, at: Date.now() - 600000 }));
    await window.__sidenote.idb.put({ key: 'lorph:0', id: 'lorph', seq: 0, blob: new Blob(['x']), sec: 3, code: 'TEST 1001' }); });
  await page.reload(); await page.waitForSelector('.shell'); await sleep(700);
  const notice = () => page.locator('.main .alert:has-text("was interrupted")').count();
  await go('lorph'); const shown = await notice(), orphBtns = (await page.locator('.main .card .brow .btn').allInnerTexts()).join('|'); log.length = 0;
  await page.click('.main .card button:text-is("Delete lecture")'); await page.click('#overlay .modal button:text-is("Delete lecture")'); await sleep(600);
  const after = await notice(), left = await page.evaluate(async () => ({ mark: localStorage.getItem('sidenote.live'), chunks: ((await window.__sidenote.idb.all()) || []).filter(c => c.id === 'lorph').length }));
  await page.reload(); await page.waitForSelector('.shell'); await sleep(900);
  const gone = await notice();
  check('deleting an interrupted recording\'s lecture also removes the "was interrupted" notice, its saved audio and its mark, also after a reload',
    shown === 1 && orphBtns === 'Make notes from what was recorded|Delete lecture' && log.includes('DELETE /lectures/lorph') && after === 0 && !left.mark && left.chunks === 0 && gone === 0,
    { shown, orphBtns, deleted: log.includes('DELETE /lectures/lorph'), after, left, afterReload: gone });

  // A recording being made right now keeps its own card.
  await page.evaluate(() => { location.hash = '#/new'; }); await page.waitForSelector('.choice'); await page.click('.choice button:nth-child(1)');
  await page.click('form button.btn.blue'); await page.waitForSelector('.live-top', { timeout: 8000 }).catch(() => {});
  await page.evaluate(() => { location.hash = '#/lecture/llive'; }); await page.waitForSelector('.main .card h3').catch(() => {});
  const liveH = await h3().catch(() => ''); 
  check('the lecture being recorded right now still says "This lecture is being recorded"', liveH === 'This lecture is being recorded', liveH);

  await page.evaluate(() => { location.hash = '#/home'; });
  check('no page errors', errs.length === 0, errs);
  await browser.close();
  console.log(`\n${results.filter(Boolean).length} of ${results.length} checks passed`);
})().catch(e => { console.error('SCRIPT ERROR', String(e.message).slice(0, 1200)); process.exit(1); });
