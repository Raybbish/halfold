# Halfnote 第一批 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `reference/halfnote.html` 第一批的页面改动搬进 React 版（改名 Halfnote、一键录音、后台写笔记和后台上传、卡住课堂的补救、课堂页和录音页的小改、帮助页和隐私页、简体界面），保留我们已有的东西。

**Architecture:** 在现有 React 代码里逐项加：两个新模块（`features/notes/watch.ts` 后台查笔记、`features/upload/upload.ts` 后台上传），其余改在现有页面里。服务器只改用户看得到的名字，再给课堂数据加 `source`。

**Tech Stack:** React 18 + TypeScript + Vite（`src/`），Node 22 + Hono + node:sqlite + zod（`server/`），Playwright 检查脚本（`tests/`，请求拦截假装后端），`node:test`（`server/test/`）。

**Spec:** `docs/superpowers/specs/2026-11-16-halfnote-batch1-design.md`（中文；本计划和它冲突时以它为准）。设计师原文：`reference/halfnote.html`（下文写作 `H:行号`，行号是大约值，以函数名为准）。

## Global Constraints

- 不加新的运行时依赖。
- 后端返回的内容（标题、笔记、逐字稿、失败原因、课程代码）不进 `t()`，元素带 `data-notr`。
- 每一句新的界面英文都要在 `src/i18n/zh.ts` 的 `ZH` 里有繁体；整句传给 `t()`（"Hi " + name 这种拼好再传）。简体由繁体转换，不单独写。
- 内部名字不改：`localStorage` 的 `sidenote.*`、IndexedDB `sidenote`、BroadcastChannel 名、`window.SIDENOTE_CONFIG`、`window.__sidenote`、环境变量名、包名。
- `src/types.ts` 和 `server/src/shapes.ts` 一起改，严格 schema 保持严格。
- 检查脚本只跑在 build 上（`--target=dist`），写法照 `tests/failed-reason.js`：`require('./harness')`、`setConfig(ctx, { USE_MOCK: false, POLL_MS: 50 })`、`ctx.route` 假装 `/api/*`、`check(name, ok, detail)`、最后一行 `N of M checks passed`；加进 `tests/run-all.js` 的 `SCRIPTS` 和 `EXPECT`。
- 新文案：halfnote.html 里有的照搬英文和 `ZH` 里的繁体；没有的照本计划写。
- 不提交，除非用户要求（每个任务的最后一步是检查点，不是 commit）。
- 用户最后一次性手测；过程中只靠自动检查，不请用户在页面上试。

## Review Focus

测试之外最可能出问题的五处，各自的检查已经加在对应任务里：

1. **上传中刷新页面**：文件没了，课堂停在 `recording`，课堂页要显示"Send a recording file"而不是"Make notes"（任务 7）。
2. **上传中退出登录**：要拦下来，否则上传还在跑、登录状态已经清掉（任务 6）。
3. **笔记一直写不完或课堂被删**：后台轮询要有上限，`getStatus` 404 时安静地停（任务 5）。
4. **简体界面里的规则句和日期**：`ZHR` 产出的句子也要转简体，日期用 `zh-CN`（任务 4）。
5. **后加课件期间刷新**：课堂是 `processing`，后台轮询接手，不能同时有两个轮询（任务 5）。

---

### Task 1: 前端改名 Halfnote / Hal，并让测试不再和 sidenote.html 逐像素比

**Files:**
- Modify: `src/ui/icons.tsx`（`Sid` → `Hal`，`Logo`）、`index.html`、所有用 `<Sid>` 的文件（`grep -rl "Sid" src`）、`src/pages/lecture/parts.tsx`、`src/features/export.ts`、`src/pages/ReviewPack.tsx`、`src/i18n/zh.ts`，以及 `grep -rn "Sidenote\|\bSid\b" src` 列出的其他用户可见文字
- Modify: `tests/run-all.js`；现有脚本里断言旧文字的地方（`grep -n "Sidenote\|Sid " tests/*.js`）
- Delete（若再无引用）: `tests/compare-shots.js`、`tests/known-differences.js`
- Test: `tests/brand.js`（新）

**Interfaces:**
- Produces: `export function Hal({ size, mood, color }: { size?: number; mood?: Mood; color?: string })`，`Mood` 不变；`Logo` 不变签名。后续任务一律用 `<Hal>`。

- [ ] **Step 1: 写 `tests/brand.js`（失败的检查）**

```js
// 真后端模式，假 API 给一门课、一堂 ready 的课（detail 里有一条 off: true 的要点）。
check('title and home-screen name say Halfnote', /^Halfnote: /.test(await page.title()) && await page.getAttribute('meta[name=apple-mobile-web-app-title]', 'content') === 'Halfnote');
check('logo text is "halfnote" and the mascot is the half note', logoText === 'halfnote' && await page.locator('.logo svg ellipse').count() === 1);
check('a point not on the slides is tagged "Not on slides"', offTag === 'Not on slides');
check('the filter says "Only what is not on the slides"', /Only what is not on the slides/.test(toolsText));
for (const [name, hash] of pages)   // #/ , #/home, #/lecture/l1, #/settings, #/new，英文和繁体各一遍
  check(`no "Sidenote" or "Sid " on ${name}`, !/Sidenote|\bSid\b/.test(await page.innerText('body')));
check('the session is still stored under sidenote.session', await page.evaluate(() => !!localStorage.getItem('sidenote.session')));
```

- [ ] **Step 2: 运行，确认失败**

Run: `npm run build && node tests/brand.js --target=dist`
Expected: 标题、logo、标签、文字几项 FAIL；session 那项 PASS。

- [ ] **Step 3: 改名**
  - `icons.tsx`：`Hal` 的 SVG 照 `H:788 sid()`（竖线、斜椭圆、两只眼，三种嘴），保留 `className="sid"` 和 `.eye`（CSS 和动画在用）。`Logo` 文字 `halfnote`，`data-notr`，图标 `size={30}`。
  - `index.html`：favicon、`<title>`、`apple-mobile-web-app-title` 照 `H:1-10`。
  - 文字：英文里的 Sidenote → Halfnote，Sid → Hal（"Sid is writing your notes" → "Hal is writing your notes" 等）；`zh.ts` 的键和值同步改（中文里的名字也是 Halfnote / Hal，照 halfnote.html 的 `ZH`）。
  - `parts.tsx`：标签 `Not on slides`；筛选文字 `Only what is not on the slides`（照 `H` 的 `ZH` 取繁体）；空列表 "No sidenotes in this lecture." 改成 halfnote 的对应句。
  - Markdown 导出、复习包里的名字照 `H:1509`、`H:~1553`。

- [ ] **Step 4: 改测试套件**
  - `run-all.js`：只跑 build；删掉 `legacy` 那一遍和 `shots5` 后面的 `compare(...)` 关卡，`shots5.js` 照旧在 build 上拍截图（只检查没有页面错误）。`SCRIPTS`、`EXPECT` 加 `brand: 7`（按实际条数）。
  - 现有脚本里断言旧名字或旧文字的地方改成新文字，不改断言的意思。

- [ ] **Step 5: 运行，确认通过**

Run: `npm test`
Expected: build 无警告；`brand.js` 全过；其余脚本和 `EXPECT` 一致；overflow5、printcheck 通过。

- [ ] **Step 6: 检查点**（不提交）

---

### Task 2: 服务器上用户看得到的名字改成 Halfnote

**Files:**
- Modify: `server/src/routes.ts`、`login.ts`、`billing.ts`、`library.ts`、`mail.ts`、`config.ts`（`MAIL_FROM` 默认显示名）、`notes/prompt.ts`、`notes/slides.ts`、`notes/pack.ts`；`server/.env.example`、`server/README.md` 里 `MAIL_FROM` 的默认值
- Test: `server/test/login.test.ts`、`billing.test.ts`、`live.test.ts`、`payments.test.ts`、`pack.test.ts`、`slides-later.test.ts` 里断言旧名字的地方

- [ ] **Step 1: 先改测试断言**：上面这些测试里断言 "Sidenote" 的文字改成 "Halfnote"；在 `login.test.ts` 加一条：登录邮件的标题和正文（中英文）都含 "Halfnote"、不含 "Sidenote"。
- [ ] **Step 2: 运行，确认失败**：`cd server && npm test`，Expected: 这些断言 FAIL。
- [ ] **Step 3: 改服务器文字**：`grep -rn "Sidenote\|\bSid\b" server/src` 里用户看得到的（错误信息、邮件、Stripe 商品名、提示词里的产品名）。注释、内部名字不改。
- [ ] **Step 4: 运行，确认通过**：`cd server && npm test`，Expected: 全部通过（原 148 项加新的一项）。
- [ ] **Step 5: 检查点**

---

### Task 3: 课堂数据加 `source`

**Files:**
- Modify: `server/src/views.ts`（`lectureView`）、`server/src/shapes.ts`（`LectureSchema`）、`src/types.ts`（`Lecture`）、`API-CHANGES.md`（新增第 10 节：`lecture.source`、`createLecture` 的 `autoTitle`）
- Test: `server/test/contract.test.ts`

**Interfaces:**
- Produces: `Lecture.source?: Source`（`"record" | "tab" | "upload" | "link"`），`GET /home`、`GET /lectures/:id` 都带；分享页（`GET /shared/:id`）**不带**。

- [ ] **Step 1: 写测试**：`contract.test.ts` 加：四种来源各建一堂课，`GET /lectures/:id` 的 `lecture.source` 等于建课时的值，`/home` 里也一样；分享出去后 `GET /shared/:id` 的 `lecture` 没有 `source`。
- [ ] **Step 2: 运行，确认失败**：`cd server && npm test`
- [ ] **Step 3: 实现**：`lectureView` 加 `source: l.source`；schema 加 `source: SourceSchema.optional()`；`library.ts` 的 `GET /shared/:id` 像去掉 `link`、`error` 一样去掉 `source`。`src/types.ts` 加字段和注释。
- [ ] **Step 4: 运行，确认通过**：`cd server && npm test`；`npm run build`（类型检查）
- [ ] **Step 5: 检查点**

---

### Task 4: 界面语言 English / 简体 / 繁體

**Files:**
- Create: `src/i18n/t2s.ts`（`T2S_PH`、`T2S_CH`、`t2s`，数据照 `H:1885-1887`）
- Modify: `src/i18n/index.ts`、`src/ui/Shell.tsx`（`LangBtn`、周几缩写）、`src/pages/Settings.tsx`、`src/state/app.ts`（`dayMon`）、`src/main.tsx`、`src/testBridge.ts`
- Test: `tests/zh-hans.js`（新）；`tests/overflow5.js` 加简体

**Interfaces:**
- Produces: `export type UiLang = "en" | "zh-Hant" | "zh-Hans"`；`export let LANG: UiLang`；`export function setLang(l: string): void`（`"zh"` 当作 `"zh-Hant"`，其他未知值当 `"en"`）；`export const isZh = () => LANG !== "en"`；`export function t2s(s: string): string`。

- [ ] **Step 1: 写 `tests/zh-hans.js`**（每种情况一个新 context，`locale` 设浏览器语言）

```js
check('new visitor, zh-CN browser: Simplified', lang === 'zh-Hans' && htmlLang === 'zh-Hans' && /简体|课堂/.test(body));
check('new visitor, zh-HK browser: Traditional', lang === 'zh-Hant');
check('new visitor, en-US browser: English', lang === 'en');
check('earlier user (sidenote.session set, no lang), zh-CN browser: stays English and "en" is saved', lang === 'en' && saved === 'en');
check('old saved "zh" opens in Traditional', lang === 'zh-Hant');
check('the language button offers EN, 简体, 繁體', JSON.stringify(opts) === '["EN","简体","繁體"]');
check('Settings has Interface language with three options', settingsOpts.length === 3);
check('Simplified pages carry no character from the Traditional-to-Simplified table', !hasTraditional);   // #/home #/lecture/l1 #/settings #/new，用 T2S_CH 的键检查
check('a rule sentence (ZHR) and a date come out in Simplified', /周|月/.test(ruleAndDate) && !hasTraditional);
check('backend text stays as sent in Simplified', titleText === '週 9 測試');   // 课堂标题故意用繁体字
```

- [ ] **Step 2: 运行，确认失败**：`npm run build && node tests/zh-hans.js --target=dist`
- [ ] **Step 3: 实现**
  - `LANG` 的初始值：存了 `"zh"` → `zh-Hant`；存了三者之一 → 用它；没存时，若有 `sidenote.session` 或其他 `sidenote.*` 键（老用户）→ `en` 并存下；否则按 `navigator.language`：`/^zh/` 且 `/tw|hk|mo|hant/` → `zh-Hant`，其他 `zh` → `zh-Hans`，其他 → `en`（照 `H:1579`，加老用户判断）。
  - `trs()`：查表和 `ZHR` 规则得到繁体后，`LANG === "zh-Hans"` 时过一遍 `t2s`。
  - `setLang`：存值，`<html lang>` 设成 `en` / `zh-Hant` / `zh-Hans`，`bumpAll()`。
  - `LangBtn`：`<select className="lang" data-notr>`，选项 EN / 简体 / 繁體（照 `H:1895`）。设置页 "Interface language" 三个选项（`English`、`简体中文`、`繁體中文`）。
  - 所有 `LANG === "zh"` 改成 `isZh()`；`dayMon` 简体用 `zh-CN`。
  - `zh.ts` 补上 halfnote `ZH` 里新增、React 页面用得到的条目（本批后续任务新增的句子，各任务自己补）。
- [ ] **Step 4: `overflow5.js` 加简体**（宽度和页面不变，多跑一种语言）。
- [ ] **Step 5: 运行，确认通过**：`npm test`；`zhcheck`、`zhscript` 照旧通过（它们用的 `setLang('zh')` 仍是繁体）。
- [ ] **Step 6: 检查点**

---

### Task 5: 下课不用干等（后台查笔记）和新的提示条

**Files:**
- Create: `src/features/notes/watch.ts`
- Modify: `src/state/overlay.ts`（`toast`）、`src/styles.css`（`.toast.bad`、`a.toast`、等待卡片的进度条 `.bar.ind`，照 halfnote CSS）、`src/features/recording/finish.ts`（`finalize`、`afterNotes`、`retryNotes`、`pollNotes`）、`src/pages/Lecture.tsx`（`processing` 卡片）、`src/state/router.ts`（首页数据到了以后接手 `processing` 的课堂）、`src/pages/Settings.tsx`（退出登录时 `unwatchAll()`）、`src/pages/lecture/actions.tsx`（后加课件期间标记"正在对课件"）、`src/testBridge.ts`
- Test: `tests/background-notes.js`（新）；`tests/real5.js`、`tests/real3.js`、`tests/slides-later.js` 里断言"写笔记锁屏窗口"的地方

**Interfaces:**
- Produces:
  - `toast(msg: string, opt?: { error?: boolean; href?: string }): void`：有 `href` 时是 `<a class="toast">`，文字后加 `"  " + trs("Open")`；`error` 加 class `bad`；有其一时停 6000 ms，否则 2600 ms。
  - `watch(id: string): void`、`isWatching(id: string): boolean`、`unwatchAll(): void`、`holdWatch(id: string, on: boolean): void`（后加课件自己轮询时调用，期间 `watch` 跳过这堂课）。
  - `finalize(id: string, duration: number, quiet?: boolean): Promise<void>`：调 `finishLecture`，把课堂设成 `processing`、`S.detail[id] = null`，`watch(id)`，然后：不 quiet 时进这堂课的课堂页；quiet 时（上传完成）若不在这堂课的页面，弹 `toast("Upload finished. The notes are being written.", { href })`。`finishLecture` 失败时弹 `toast("The lecture was saved, but its notes could not be started. Open it to try again.", { error: true, href })`（照 `H:1344`）。

- [ ] **Step 1: 写 `tests/background-notes.js`**（假 API：`/status` 按脚本控制返回 processing / ready / failed / 404；记录每个请求）

```js
check('after "Make notes from what was saved" the lecture page shows "Hal is writing your notes", with no locked dialog', h3 === 'Hal is writing your notes' && !(await page.locator('#overlay .modal').count()));
check('the page updates by itself when the notes are ready', await page.locator('.nsec').count() > 0);
check('on another page a ready lecture gives a toast link "Your notes are ready.  Open"', toast.tag === 'A' && toast.href.endsWith('#/lecture/l2') && /Your notes are ready\.\s+Open/.test(toast.text));
check('a failed lecture gives a red toast', toast.cls.includes('bad') && /could not be written/.test(toast.text));
check('reloading during processing starts watching again', statusCallsAfterReload > 0);
check('one lecture is never polled twice at once', maxInFlight === 1);
check('a 404 from /status stops watching quietly', callsAfter404 === 0 && noToast);
check('watching stops after 600 tries and the page offers "Check again"', checkAgainShown);   // POLL_MS 1
check('Try again on a failed lecture calls /retry and shows the writing card, not a dialog', log.includes('POST /lectures/l3/retry') && writingCard && !modal);
check('adding slides later still waits in its own dialog and the lecture is not polled twice', slidesDialog && maxInFlight === 1);
check('signing out stops watching', callsAfterSignOut === 0);
```

- [ ] **Step 2: 运行，确认失败**：`npm run build && node tests/background-notes.js --target=dist`
- [ ] **Step 3: 实现**
  - `toast` 按上面的签名（照 `H:799`）。
  - `watch.ts` 照 `H:1285 watch()`：每堂课一个循环；第一次 300 ms，之后每 `POLL_MS`；最多 600 次；`getStatus` 出错连续 20 次就停；404 立刻停；结束时更新 `lecture(id).status`、`S.homeLoaded = false`、清掉没有笔记的缓存；正在看这堂课 → `route()`；不在 → ready 弹链接提示，failed 弹红色链接提示。600 次用完：课堂页显示"Check again"按钮（现有 `refreshLecture`）。
  - `finish.ts`：`finalize` 按上面的签名；"Sending the last of the audio"和"Waiting for a connection"照旧；删掉锁屏的"Hal is writing your notes"窗口。`retryNotes` 用 `busy("Starting again", "A few seconds.")` 只盖住请求那一下，然后 `watch`。`pollNotes` 只留给后加课件用。
  - `Lecture.tsx` 的 `processing` 卡片照 `H:1116`："Hal is writing your notes"、"First the transcript, then notes, flashcards and a quiz. This usually takes about two minutes."、不确定进度条、"You do not have to wait here. This page updates by itself, and the lecture is on your home page when it is ready."、按钮 "Go to home"；不在轮询时加 "Check again"。
  - `router.ts`：首页数据加载完，对每个 `status === "processing"` 的课堂 `watch(id)`；打开一个 `processing` 的课堂页也 `watch`。
  - 后加课件：上传前 `holdWatch(id, true)`，结束（成功、失败、取消）后 `holdWatch(id, false)`。
  - 新句子补 `ZH`（照 halfnote 的 `ZH`）。
- [ ] **Step 4: 改现有脚本**：`real5`、`real3`、`slides-later` 里等"写笔记锁屏窗口"的步骤改成等课堂页的卡片或提示条；断言的意思不变。
- [ ] **Step 5: 运行，确认通过**：`npm test`
- [ ] **Step 6: 检查点**

---

### Task 6: 上传时可以走开（后台上传）

**Files:**
- Create: `src/features/upload/upload.ts`
- Modify: `src/pages/NewLecture.tsx`（`submitNew` 的上传分支，删掉 `sendFiles`）、`src/ui/Shell.tsx`（顶部小标签）、`src/pages/Lecture.tsx`（上传中、上传失败两种卡片）、`src/pages/Home.tsx` 和 `src/pages/Course.tsx`（列表里 "Uploading"）、`src/main.tsx`（离开页面提醒）、`src/pages/Settings.tsx`（上传中不让退出）、`src/state/overlay.ts` 和 `src/ui/Overlay.tsx`（若 `upload` 弹窗只剩后加课件在用，保留给它）、`src/styles.css`（`.pill-rec.up`、`.pill-rec.bad`，照 halfnote）
- Test: `tests/upload.js`（改写成新流程，条数写进 `EXPECT`）

**Interfaces:**
- Consumes: `finalize(id, 0, true)`、`toast(msg, opt)`（任务 5）。
- Produces: `export const up: { id: string | null; name: string; file: File | null; slides: File | null; loaded: number; total: number; state: "" | "sending" | "failed"; err: string }`；`startUpload(id: string, file: File, slides: File | null): void`；`runUpload(): Promise<void>`；`cancelUpload(): void`；`uploading(): boolean`（`up.id` 有值且未失败）。

- [ ] **Step 1: 改写 `tests/upload.js`**

```js
check('choosing Upload opens the lecture page at once with the file name, a bar and Cancel upload', url.endsWith('#/lecture/lnew') && h3 === 'Uploading the recording' && name === 'week9.m4a' && hasCancel);
check('no locked dialog while uploading', !modal);
check('other pages show "Uploading N%" at the top, linking to the lecture', /^Uploading \d+%$/.test(pill.text) && pill.href.endsWith('#/lecture/lnew'));
check('the recording, then the slides, then /finish', JSON.stringify(order) === '["POST /lectures/lnew/recording","POST /lectures/lnew/slides","POST /lectures/lnew/finish"]');
check('when it is done the page shows "Hal is writing your notes"', h3After === 'Hal is writing your notes');
check('a failed upload shows the reason, Send it again and Delete this lecture', failH3 === 'The upload did not finish' && /Send it again/.test(btns) && /Delete this lecture/.test(btns));
check('Send it again posts the same file to the same lecture', resent.size === firstSize && resent.path === '/lectures/lnew/recording' && createCount === 1);
check('elsewhere a failed upload is a red pill "The upload did not finish. Open"', pillBad);
check('Cancel upload deletes the lecture, says "Upload cancelled. Nothing was kept." and goes home', log.includes('DELETE /lectures/lnew') && /Nothing was kept/.test(toastText) && url.endsWith('#/home'));
check('a second upload while one runs is refused on New lecture', /Another upload is still running/.test(errText));
check('leaving the page while uploading asks first', beforeUnloadPrevented);
check('signing out while uploading is refused', /Wait for the upload to finish or cancel it/.test(toastText) && stillSignedIn);
check('home and course lists tag the uploading lecture "Uploading"', tag === 'Uploading');
check('a file over MAX_UPLOAD_MB and a non-PDF slide deck are still refused before anything is created', refusedBoth && createCount === 0);
```

- [ ] **Step 2: 运行，确认失败**：`npm run build && node tests/upload.js --target=dist`
- [ ] **Step 3: 实现**
  - `upload.ts` 照 `H:1268-1280`（`runUpload`、`cancelUpload`、`reupload`、`upPill`），用现有 `api.uploadRecording(id, file, { signal, onProgress })` 和 `api.uploadSlides`；进度合并照现在 `sendFiles` 的算法；课件失败时 `toast("Slides did not upload. You can add them later.")` 后照常收尾；失败且不在这堂课页面时弹红色链接提示 "The upload did not finish."。
  - `NewLecture.tsx`：上传分支 = 已有上传在跑就 `nf.err = "Another upload is still running. Wait for it to finish first."`；否则建课、`S.lectures` 加上它、`startUpload`、清表单、`location.hash = "#/lecture/" + id`。
  - 课堂页两张卡片照 `H:1107-1110`。
  - `Shell`：录音小标签旁边加上传小标签（不在这堂课页面时显示），手机和电脑都显示。
  - `main.tsx`：`beforeunload` 条件加 `uploading()`。
  - `signOut`：上传中 `toast("Wait for the upload to finish or cancel it before signing out.")` 并返回（新句子，补 `ZH`："請等上載完成或先取消，再登出。"）。
  - 列表标签：`statusTag` 对 `up.id === l.id` 显示 "Uploading"。
- [ ] **Step 4: 运行，确认通过**：`npm test`
- [ ] **Step 5: 检查点**

---

### Task 7: 卡住的课堂和写笔记失败的课堂

**Files:**
- Modify: `src/pages/Lecture.tsx`（`recording`、`failed` 两种卡片）、`src/pages/lecture/actions.tsx`（导出 `deleteModal`）、`src/features/upload/upload.ts`（`reupload(file)`）
- Test: `tests/stuck-lecture.js`（新）

**Interfaces:**
- Consumes: `Lecture.source`（任务 3）、`startUpload`/`up`（任务 6）、`retryNotes`（任务 5）。
- Produces: `export function deleteModal(): void`（actions.tsx）；`export function reupload(f: File): void`（upload.ts，用 `cur.l.id`；上传中拒绝、超过上限拒绝，照 `H:1278`）。

- [ ] **Step 1: 写 `tests/stuck-lecture.js`**（假 API 给几堂 `recording` / `failed` 的课）

```js
check('a recorded lecture never finished: "Make notes from what was recorded" and "Delete lecture", no file button', btns('lrec') === 'Make notes from what was recorded|Delete lecture');
check('a tab recording: the same', btns('ltab') === 'Make notes from what was recorded|Delete lecture');
check('an upload whose file never arrived: "Send a recording file" first, then "Delete lecture"', btns('lup') === 'Send a recording file|Delete lecture');
check('a link lecture with its link: "Make notes from the link" and "Delete lecture"', btns('llink') === 'Make notes from the link|Delete lecture');
check('a lecture without source behaves like a recording', btns('lold') === 'Make notes from what was recorded|Delete lecture');
check('Send a recording file uploads to the same lecture and then calls /finish', log.includes('POST /lectures/lup/recording') && log.includes('POST /lectures/lup/finish'));
check('a failed lecture: "Try again" and "Delete lecture"', btns('lfail') === 'Try again|Delete lecture');
check('Delete lecture asks first, then deletes and leaves the page', confirmShown && log.includes('DELETE /lectures/lfail') && !url.endsWith('lfail'));
check('the lecture being recorded right now still says "This lecture is being recorded"', liveH3 === 'This lecture is being recorded');
check('after a reload mid-upload the lecture offers "Send a recording file"', btnsAfterReload === 'Send a recording file|Delete lecture');
```

- [ ] **Step 2: 运行，确认失败**：`npm run build && node tests/stuck-lecture.js --target=dist`
- [ ] **Step 3: 实现**：照设计第 5 项。文案照 `H:1112-1114`（"This lecture was never finished"、"It was started, but its notes were not made. Finish it from what was recorded, send the recording again, or delete it."）；链接课用 "Make notes from the link"（新句子，补 `ZH`："用連結整理筆記"）。中断恢复（`S.orphan`）照旧走 `recoverOrphan()`。
- [ ] **Step 4: 运行，确认通过**：`npm test`
- [ ] **Step 5: 检查点**

---

### Task 8: 首页一键录音、上次的课程、日期标题、继续上次的课堂

**Files:**
- Modify: `src/pages/Home.tsx`（录音卡片、继续卡片；学生一堂课都没有时的首页也放录音卡片）、`src/pages/NewLecture.tsx`（课程默认 `lastCourse`、空标题用日期、`autoTitle`、开麦失败删课）、`src/types.ts`（`NewLecture.autoTitle?: boolean`）、`src/api/api.ts`（示例模式接受 `autoTitle`）、`src/pages/Lecture.tsx`（打开课堂时存 `lastLec`）、`src/lib/store.ts`（注释里的键）、`src/styles.css`（`.rec-hero`、`.rec-btn`、`.tcard`，照 halfnote）
- Test: `tests/quick-record.js`（新；启动参数加 `--use-fake-ui-for-media-stream`、`--use-fake-device-for-media-stream`，照 `tests/real5.js`）

**Interfaces:**
- Produces: `export function defaultTitle(): string`（照 `H:1227`，按 `LANG`）；`export function quickRecord(): Promise<void>`（Home.tsx 或 NewLecture.tsx 导出）；`createLecture` 的请求体多 `autoTitle: boolean`（标题是日期时为 `true`）。

- [ ] **Step 1: 写 `tests/quick-record.js`**

```js
check('home shows "Class starting?" with a course list and a Record button', heroH2 === 'Class starting?' && courseOpts.length === 2 && hasRecord);
check('the course list starts at the last course used', selected === 'c2');   // 预先存 sidenote.lastCourse = c2
check('Record creates a recording lecture in that course with a dated title and autoTitle', body.courseId === 'c2' && body.source === 'record' && body.autoTitle === true && /^Lecture, \w{3} \d{1,2} \w{3}$/.test(body.title));
check('and goes to the recording page', url.endsWith('#/live'));
check('while recording the home card says "Recording <code>" and "Return to the recording"', /^Recording TEST 2/.test(heroText) && /Return to the recording/.test(heroText));
check('with no course yet, Record first adds a course called "My classes"', log[0] === 'POST /courses' && courseBody.code === 'My classes');
check('a student with no lectures yet also gets the Record card', emptyHomeHasHero);
check('when the microphone is refused, the new lecture is deleted and the reason shown', log.includes('DELETE /lectures/lnew') && /Microphone access was blocked/.test(errText));
check('New lecture: an empty title becomes the dated title with autoTitle; a typed title is sent as typed with autoTitle false', blank.autoTitle === true && typed.title === 'Week 10' && typed.autoTitle === false);
check('New lecture starts at the last course used', newSelected === 'c2');
check('in Chinese the dated title ends with 課堂 (and 课堂 in Simplified)', /課堂$/.test(zhTitle) && /课堂$/.test(hansTitle));
check('"Pick up where you left off" shows the last lecture opened, and not after it is deleted', lastCard === 'Week 9 replay' && !lastCardAfterDelete);
```

- [ ] **Step 2: 运行，确认失败**：`npm run build && node tests/quick-record.js --target=dist`
- [ ] **Step 3: 实现**
  - 录音卡片和 `quickRecord` 照 `H:921-929`、`H:1229-1231`：卡片里的课程下拉框改变时存 `lastCourse`；`quickRecord` 设好 `nf` 后走现有 `submitNew()`（所以"Before you record"提示、每日分钟上限照旧）。
  - `submitNew`：`title = typed || defaultTitle()`，`autoTitle = !typed`；录音或录标签页建课成功后存 `lastCourse`；`beginRecording` 抛错时删课（`api.deleteLecture`，从 `S.lectures` 拿掉），把错误写进 `nf.err`（在首页时用红色提示条）。
  - 继续卡片照 `H:925`；`LecturePage` 渲染时 `store.set("lastLec", id)`。
  - 新句子补 `ZH`（照 halfnote 的 `ZH`）。
- [ ] **Step 4: 运行，确认通过**：`npm test`（`course-picker.js` 若断言默认第一门课，改成断言 `lastCourse`）
- [ ] **Step 5: 检查点**

---

### Task 9: 课堂页：主题目录、折叠、改标题和课程、点时间就播放、标签按需显示、发到 App

**Files:**
- Modify: `src/pages/lecture/Notes.tsx`、`src/pages/lecture/parts.tsx`、`src/pages/lecture/actions.tsx`（`jump`、`moreMenu`、`detailsModal`，删掉 `renameModal`/`moveModal`、`share`）、`src/pages/Lecture.tsx`（标签、日期旁的 Rename）、`src/state/app.ts`（`state.closed: Set<number>`，换页时清空）、`src/state/router.ts`（换页重置 `closed`）、`src/api/api.ts`（`updateLecture(id, p: { title?: string; course?: string })` 代替 `renameLecture`/`moveLecture`）、`src/styles.css`（`.chips`、`.nsec.closed`、`.sec-t`，照 halfnote）
- Test: `tests/lecture-page.js`（新）；`tests/courses.js` 里"Move to another course"的步骤改走新窗口

**Interfaces:**
- Produces: `api.updateLecture(id: string, p: { title?: string; course?: string }): Promise<null>`（`PATCH /lectures/:id`，只发给了的字段）；`detailsModal(): void`。

- [ ] **Step 1: 写 `tests/lecture-page.js`**（假 API：一堂有 3 个主题、有逐字稿、无测验、有录音的课；一堂没有逐字稿的课）

```js
check('a "Topics" row lists each topic with its start time', chips === 'Opportunity cost 3:20|Supply 10:40|Demand 21:00');
check('clicking a topic chip scrolls to that topic and opens it', sectionInView && !sectionClosed);
check('clicking a topic heading closes it and shows how many notes it has', closedCount === '3 notes');
check('"Collapse all topics" closes every topic and turns into "Expand all topics"', allClosed && toggleText === 'Expand all topics');
check('editing notes opens every topic', allOpenInEdit);
check('the More menu has "Edit title and course" instead of Rename and Move', /Edit title and course/.test(more) && !/^Rename$|Move to another course/m.test(more));
check('the dialog saves only what changed', JSON.stringify(patch1) === '{"title":"Week 9, revised"}' && JSON.stringify(patch2) === '{"course":"c2"}');
check('the small Rename beside the date opens the same dialog', dialogH3 === 'Edit title and course');
check('clicking a timestamp starts the recording from there', played && Math.abs(currentTime - 252) < 2);
check('no Transcript tab when there is no transcript; no Quiz tab when there is no quiz', !tabs.includes('Transcript') && !tabs.some(x => /^Quiz/.test(x)));
check('Share shows "Send to an app" when the browser can share', sendBtn);   // 先 addInitScript 定义 navigator.share
check('no "Send to an app" when it cannot', !sendBtnWithout);
check('the bottom player, 中文解釋 and 繁/简 are still there', hasPlayer && hasZhToggle);
```

- [ ] **Step 2: 运行，确认失败**：`npm run build && node tests/lecture-page.js --target=dist`
- [ ] **Step 3: 实现**
  - 主题目录和折叠照 `H:1121-1133`（`summaryHtml` 去掉"In short"部分，`toggleSec`、`collapseAll`、`openSec`）；一个主题时不显示目录和"Collapse all"。
  - `detailsModal` 照 `H:1182`；保存后更新 `l.title`、`l.course`，课程变了就照现在 `doMove` 处理 `S.upcoming` 和 `S.pack`；只有一门课时不显示课程下拉框。
  - `jump`：在现有行为上，有录音时 `plSeek(t)` 后开始播放（用 player.ts 现有的播放函数）。
  - 标签：`transcript` 只在 `d.transcript.length` 时出现；`quiz` 只在 `d.quiz.length` 时出现；当前标签不存在时回到 `notes`。
  - 分享窗口：`navigator.share` 存在时加 "Send to an app"（照 `H:1161 nativeShare`）。
- [ ] **Step 4: 改 `tests/courses.js`**：移动课堂的步骤改用"Edit title and course"窗口，断言不变（课堂换了课程，雷达和复习包跟着变）。
- [ ] **Step 5: 运行，确认通过**：`npm test`
- [ ] **Step 6: 检查点**

---

### Task 10: 录音页改标题和课程，考试提示时震动

**Files:**
- Modify: `src/pages/Live.tsx`、`src/features/recording/recorder.ts`（`live.title`、`live.courseId`）、`src/features/recording/outbox.ts`（`applyChunk` 收到提示时震动）、`src/styles.css`（`.live-meta`）
- Test: `tests/live-meta.js`（新；假麦克风参数同任务 8）

**Interfaces:**
- Consumes: `api.updateLecture`（任务 9）。
- Produces: `live.title: string`、`live.courseId: string`；`saveLiveMeta(): void`。

- [ ] **Step 1: 写 `tests/live-meta.js`**

```js
check('the recording page has a title box "Name this lecture (optional, you can do it later)" and a course list', placeholder === 'Name this lecture (optional, you can do it later)' && courseOpts === 2);
check('typing a title and leaving the box saves it', patch === '{"title":"Week 10"}');
check('choosing another course saves it, shows its code and remembers it', patchCourse === '{"course":"c2"}' && /TEST 2/.test(topText) && lastCourse === 'c2');
check('with one course there is no course list', !courseList);
check('an exam alert vibrates the phone', vibrated === 1);   // addInitScript 里替换 navigator.vibrate 计数
check('the dated title is not sent again when the box is left empty', patches.length === 2);
```

- [ ] **Step 2: 运行，确认失败**
- [ ] **Step 3: 实现**：照 `H:1368-1369`（输入框和下拉框）、`H:1383 saveLiveMeta`；`beginRecording` 记下 `live.courseId`；`applyChunk` 有新提示时 `try { navigator.vibrate && navigator.vibrate(200) } catch {}`。
- [ ] **Step 4: 运行，确认通过**：`npm test`
- [ ] **Step 5: 检查点**

---

### Task 11: 帮助页、隐私页、落地页

**Files:**
- Create: `src/pages/Help.tsx`、`src/pages/Privacy.tsx`
- Modify: `src/App.tsx`（路由 `help`、`privacy`）、`src/state/router.ts`（`PUBLIC` 加 `help`、`privacy`）、`src/pages/Landing.tsx`（导航 Help、文案、页脚）、`src/ui/Shell.tsx`（侧栏 Help）、`src/i18n/zh.ts`
- Test: `tests/help-privacy.js`（新）

- [ ] **Step 1: 写 `tests/help-privacy.js`**

```js
check('#/help and #/privacy open without signing in', helpH1 === 'Help' && privacyH1 === 'Privacy' && !url.includes('signin'));
check('the landing page has Help in the top bar and Help and Privacy in the footer', navHelp && footHelp && footPrivacy);
check('signed in, the sidebar has Help', sideHelp);
check('the privacy page names who handles the data', ['ElevenLabs', 'Deepgram', 'DeepSeek', 'Stripe', 'Resend'].every(n => privacy.includes(n)));
check('the privacy page marks the two things still to be decided', privacy.includes('[Contact email: to be decided]') && privacy.includes('[Where the server is: to be decided]'));
check('help lists only keyboard keys this app has', keys.every(k => known.includes(k)));
check('landing says "Works in the browser on a laptop or a phone. Nothing to install." and keeps playing the recording from that moment', landing.includes('Nothing to install.') && /play the recording from that moment/.test(landing));
check('both pages are fully translated in 繁體 and 简体', untranslated.length === 0);
```

- [ ] **Step 2: 运行，确认失败**
- [ ] **Step 3: 实现**
  - 帮助页照 `H:1482 helpPage()`：删掉本地模式的内容；补上邮箱登录、搜索笔记、录音保存期限（按套餐）、视频链接（只限公开链接）各一句；快捷键只列 `onLectureKey` 里有的（闪卡左右键和空格、测验 1-9 和 Enter）。
  - 隐私页：服务器模式的版本，按设计第 8 项写；占位就是上面测试里的两句方括号文字（中文："〔聯絡電郵：待定〕"、"〔伺服器所在地：待定〕"）。录音保存天数写"按你的套餐，在设置页可以看到"，不写死数字。
  - 落地页照设计第 8 项；页脚照 `H:1481 footer()`。
- [ ] **Step 4: 运行，确认通过**：`npm test`（`zhcheck` 会扫到新页面）
- [ ] **Step 5: 检查点**

---

### Task 12: 收尾：全套检查、文档、`dist/`

**Files:**
- Modify: `README.md`（测试脚本清单、和 sidenote.html 对比已经退役）、`DIFFERENCES.md`（若它记录和原文件的差异：加一句第一批之后以 halfnote 为准）、`API-CHANGES.md`（任务 3 已加第 10 节，核对）、`dist/`（`npm run build` 的结果）

- [ ] **Step 0: "保留我们自己的"逐条对上检查**：设计里那一节的每一条（手机顶栏和底部导航、`#/courses`、底部播放器、邮箱登录、笔记搜索、录音保存期限提示、后加课件、录音防丢、不支持时隐藏"录网上课堂"、`/retry`、录音中不让退出登录、视频链接失败原因、分享页不带录音和链接），在 `tests/` 里找到盯着它的断言，写成一张表放进计划的执行记录。找不到的，在 `tests/kept.js`（新）里补一条，先在改动前的提交上确认它能通过，再在现在的代码上跑。
- [ ] **Step 1: 全套检查**：`npm test`（前端）和 `cd server && npm test`（后端）。Expected: 全部通过，`EXPECT` 和实际条数一致，build 无警告。
- [ ] **Step 2: 截图人工看一遍**：`tests/output/dist/shots5-390`、`shots5-375` 里首页、课堂页、录音页、新建课堂页、设置页的英文和中文各一张，确认没有错位、没有残留的 "Sidenote"。
- [ ] **Step 3: 文档**：README 的测试清单加新脚本、删掉逐像素对比的说明；`API-CHANGES.md` 第 10 节核对。
- [ ] **Step 4: 重新构建 `dist/`**，确认 `git status` 里 `dist/` 的变化只来自这次构建。
- [ ] **Step 5: 检查点**：列出改动的文件，等用户决定是否提交、是否开 PR（这个分支接在 `feat/public-links` 后面，PR #16 合并后再开）。
