# Sidenote 前端（sidenote-web）

`sidenote.html` 单文件前端搬到 React + TypeScript 的工程。界面、文案、接口、本机存储和地址都与原文件一致，见“验收结果”。原文件冻结在 `reference/sidenote.html`，对接文档在 `reference/INTEGRATION.md`；迁移之后新增的接口和接口的新用法见 [API-CHANGES.md](API-CHANGES.md)。

迁移中发现但没改的问题、实现上和原文件不同的地方、真机走查的结果，都在 [DIFFERENCES.md](DIFFERENCES.md)。

**第一批（改名 Halfnote）之后**，前端不再以 `reference/sidenote.html` 为准，而是照设计师的新版 `reference/halfnote.html` 加上我们自己的功能，设计和计划见 `docs/superpowers/`。下面的“验收结果”是迁移当时对原文件的验收，留作记录。

## 验收结果

对构建产物 `dist` 跑，2026-11-11，macOS，Playwright 1.65 自带的 Chromium：

| 验收项 | 结果 |
|---|---|
| 1. 自动检查 102 项 | 全过：real5.js 65、zhscript.js 16、real3.js 11、zhcheck.js 10，示例模式和真后端模式都覆盖 |
| 2. 外观对比 | `shots5.js` 路径：手机 390px 时 88 张中 87 张相同，375px 时 85 张相同；差异全在录音页的麦克风音量条（随实时音量变化，见 DIFFERENCES.md）。逐页整页截图 164 张：162 张相同，2 张只差抗锯齿噪点 |
| 3. 横向滚动和打印 | 8 个宽度、两种语言都没有横向滚动；打印时导航、播放器、标签栏、按钮都隐藏 |
| 4. 工程质量 | `tsc --noEmit` 零错误，`npm run build` 零警告，浏览器控制台零报错，运行时依赖只有 react 和 react-dom |
| 5. 真机走查 | **未做**，需要真的 iPhone 和 Android 手机，方法和记录表见 DIFFERENCES.md 第 4 节 |

同一套检查对原文件也全过（`npm run test:legacy`），所以上面的结果可以直接和原文件对照。

验收之后修了原文件里就有的问题，见 [DIFFERENCES.md](DIFFERENCES.md) 第 1 节；还加了新功能：上传进度和取消、改课程和删课程、把课堂移到别的课程、课后补传课件、搜索全部笔记，接口见 [API-CHANGES.md](API-CHANGES.md)。所以现在的截图对比里有几张会和原文件不同：中文落地页（示例笔记有了中文）、课程页（多了 “Edit course” 按钮）、讲座页的 More 菜单（多了 “Move to another course”）。`tests/known-differences.js` 把它们列为有意的差异并写明原因，不算失败；每张都设了像素上限，差得更多仍算失败。

## 本地运行

需要 Node 22（见 `.nvmrc`，至少 22.12）。

```bash
npm install
```

```bash
npm run dev
```

打开终端里显示的地址（默认 http://localhost:5173）。默认是示例模式（`USE_MOCK: true`），不需要后端，任何非空邀请码都能登录。

## 构建和部署

```bash
npm run build
```

`npm run build` 先跑 `tsc --noEmit`，再用 Vite 构建，结果在 `dist/`：一个 `index.html` 加 `assets/` 下的一个 JS 和一个 CSS。资源用相对路径，路由用 hash（`#/home` 等），服务器只要把 `dist/` 当静态目录发出去，不需要配置路由回退。

前端和后端一起部署到一台 VPS（HTTPS、开机自启、每天备份）见 [deploy/server/README.md](deploy/server/README.md)。下面是只放前端、后端另在别处时的写法。

Caddy，同域部署，`API_BASE` 保持默认的 `/api`：

```
sidenote.example.com {
	root * /srv/sidenote/dist
	reverse_proxy /api/* 127.0.0.1:8000
	file_server
}
```

## 改配置（不用重新构建）

默认值在 `src/config.ts`。运行时在 `dist/index.html` 的 `<head>` 里加一段脚本即可覆盖任意一项，放在模块脚本之前：

```html
<script>window.SIDENOTE_CONFIG = { USE_MOCK: false, API_BASE: "/api" };</script>
```

| 项 | 默认 | 作用 |
|---|---|---|
| `USE_MOCK` | `true` | `false` 时调用真实后端 |
| `API_BASE` | `"/api"` | 所有请求的前缀 |
| `CHUNK_SECONDS` | `15` | 录音时每隔多少秒上传一段 |
| `AUDIO_KBPS` | `32` | 录音码率 |
| `POLL_MS` | `3000` | 等笔记或复习包时多久问一次 |
| `MAX_UPLOAD_MB` | `500` | 上传文件大小上限 |
| `EXAMPLE_SHARE_ID` | `"econ-w9"` | 落地页和登录页“Example notes”的分享 id，`null` 隐藏这些链接 |
| `SHARE_AUDIO` | `false` | 分享页能否播放录音 |

检查脚本用 `page.addInitScript` 设同一个 `window.SIDENOTE_CONFIG`。

## 真机走查包

验收第 5 项要在真机上把原文件和新工程各走一遍。下面的命令生成部署包：两个版本各一个 HTTPS 站点，外加 Caddyfile 和走查说明。

```bash
npm run walkthrough -- --old=old.<你的域名> --new=new.<你的域名>
```

有后端时加 `--api=127.0.0.1:8000`，两个版本一起切到真后端。部署步骤、走查步骤和记录表见 [deploy/walkthrough/README.md](deploy/walkthrough/README.md)。

## 跑检查

第一次先装 Playwright 自带的浏览器：

```bash
npx playwright install chromium
```

一条命令全跑（先构建，再对 `dist` 跑全部检查，最后截图）：

```bash
npm test
```

它依次跑：

1. `npm run build`：`tsc --noEmit` 零错误，构建零警告。
2. 下面的检查脚本，都只跑在构建产物 `dist` 上，每个脚本的项数写在 `tests/run-all.js` 的 `EXPECT` 里，对不上就算失败。
3. `tests/overflow5.js`：8 个宽度、英文、繁体、简体三种语言没有横向滚动；`tests/printcheck.js`：打印时导航、播放器、按钮都隐藏。
4. `tests/shots5.js` 的走查路径在手机 390px 和 375px 各截一遍（关掉动画）。第一批（改名 Halfnote 之后）起**不再和 `reference/sidenote.html` 逐像素对比**：几乎每个页面的文字和图标都变了，比下去没有意义。截图留在 `tests/output/dist/shots5-390` 和 `shots5-375`，给人看；脚本只要求跑完没有控制台和页面报错。

日志和截图在 `tests/output/`。

| 脚本 | 项数 | 内容 |
|---|---|---|
| `tests/real5.js` | 65 | 迁移时的主检查：示例模式和真后端模式（请求拦截出来的假接口），录音、播放、上传、断网、登录过期、分享、设置 |
| `tests/zhscript.js` | 17 | 语言按钮和中文界面；没选过繁简时中文解释跟界面语言 |
| `tests/real3.js` | 11 | 录音保存期限：到期提示、还剩几天、设置里的保留天数 |
| `tests/zhcheck.js` | 10 | 繁体界面：新增的每句话都有翻译，后端给的内容不翻译 |
| `tests/upload.js` | 27 | 上传在后台进行：课堂页的进度条和取消、其他页顶部的 "Uploading" 链接、关页面前提醒、上传失败后重发同一个文件、通知 |
| `tests/backend-text.js` | 13 | 后端给的内容（课程编号和名称、章节名、课件页码标签、文件名）原样显示、不翻译 |
| `tests/courses.js` | 18 | 改课程编号和名称、删课程、把课堂移到别的课程，中文，以及真后端模式的请求和出错 |
| `tests/slides-later.js` | 15 | 课后补传课件（保持锁屏窗口和自己的轮询）：上传、等待、学生自己的笔记保留、取消不删课 |
| `tests/search.js` | 20 | 首页搜索全部笔记 |
| `tests/sharing.js` | 7 | 分享：先说明、点 "Make the link" 才建链接；停止分享后旧链接重新向后端要；"You" 只标在自己的课里 |
| `tests/signin.js` | 14 | 邮件验证码登录和邀请码（邀请码一栏从第一步就在，新邮箱时标出这一栏、不显示红字） |
| `tests/course-picker.js` | 9 | 新建课堂时选课程 |
| `tests/failed-reason.js` | 6 | 视频链接等失败时显示后端给的原因，重试，被拒的链接不留下空课堂 |
| `tests/brand.js` | 19 | 改名 Halfold 和 Hal：页面上没有 "Halfnote"/"Sidenote"/"Sid"，logo（便利贴 Hal，表情跟着变）、favicon、标题 |
| `tests/zh-hans.js` | 21 | 简体界面：没有繁体字（用 OpenCC 判断，并把 `src/i18n/zh.ts` 的全部文案静态查一遍），后端内容不转换（规则句里带的名字、课程编号也不转换），语言选择保存 |
| `tests/background-notes.js` | 16 | 课堂结束后在后台写笔记，不弹锁屏窗口；通知；同一堂课同一时间只有一个轮询；出错时放慢再问、不停；停了之后 "Check again" 重新开始 |
| `tests/stuck-lecture.js` | 19 | 卡住或失败的课堂只显示和它来源相符的按钮（`lecture.source`），可以删除；删掉本机中断的录音后提示不再出现 |
| `tests/quick-record.js` | 17 | 首页一键录音：默认课程、没有课程时建 "My classes"、日期标题、录音中的卡片 |
| `tests/lecture-page.js` | 20 | 课堂页：主题列表和折叠（打印时全部展开）、标题和课程一个窗口、时间点开始播放、有内容才有标签、Send to an app |
| `tests/live-meta.js` | 10 | 录音页：录音中改名字和课程（没离开标题框就按 End 也会先存名字），考试提醒时手机振动，手机上标题框的提示文字不被截断 |
| `tests/help-privacy.js` | 11 | 公开的 Help 和 Privacy 页、落地页顶栏和页脚；Help 只说这个应用有的功能 |
| `tests/kept.js` | 9 | 保留我们自己的东西里别处没人盯着的几条：手机顶栏、底部导航、`#/courses`、"See plans"、分享窗口说明录音不公开（分享页不带链接、失败原因和来源由服务器测试 `server/test/links.test.ts` 盯着） |
| `tests/limits.js` | 12 | 方案上限：新建课堂、首页一键录音、复习包遇到 429 时弹窗说明并提供 "See the plans"；本月已用几堂课；中文 |
| `tests/formulas.js` | 7 | 笔记、中文解释、闪卡、测验里的公式显示成上下标，其他文字不当作标记 |

加上 `overflow5.js`、`printcheck.js` 和 `shots5.js`（390 和 375 两遍）。

设计和计划在 `docs/superpowers/` 下（第一批：`specs/2026-11-16-halfnote-batch1-design.md`，其中 "保留我们自己的" 一节逐条列出了不能碰掉的东西）。

迁移时用的几个脚本和原文件对照，不在 `npm test` 里：`npm run test:legacy` 是把迁移时的检查对 `reference/sidenote.html` 再跑一遍；`tests/api-parity.js`（示例模式下 `api` 返回值，仍然通过，CI 里还在跑）、`tests/i18n-parity.js`（词典，改名之后和原文件对不上，已从 CI 拿掉）、`tests/pages-compare.js`（整页截图，同样对不上）是迁移验收用的。

### GitHub 上的自动检查（CI）

`.github/workflows/ci.yml` 在每个 Pull Request 和每次推送到 `main` 时，在 GitHub 的 Ubuntu 机器上自动跑一遍，大约 20 分钟：

1. 类型检查和构建，有警告也算失败；
2. 仓库里提交的 `dist/` 和这次构建结果一致（`dist/` 是直接部署的，改了源码要记得重新构建并提交）；
3. `npm test`：上面表里的全部检查、横向滚动、打印、截图（截图不再和原文件对比）。

失败时，日志、截图和差异图会作为 `test-output` 附件保存 14 天，在那次运行的页面上下载。

### 检查脚本改了什么

原脚本原样保存在 `tests/original/`。`tests/` 下的版本只改了四处，`check(...)` 断言一行没动：

| 原来 | 现在 |
|---|---|
| `file://` 打开单个 HTML，或拦截请求返回改过的源码 | 拦截 `http://localhost:8765` 的请求，返回 `dist/` 里的文件（`tests/harness.js` 的 `serve()`） |
| 替换源码里的 `USE_MOCK: true` 等字符串 | `page.addInitScript` 设 `window.SIDENOTE_CONFIG`（`setConfig()`） |
| 直接用页面全局的 `S`、`route`、`pl`、`live`、`outbox` 等 | 新工程把它们挂在 `window.__sidenote`，`harness.js` 在页面里给这些名字加了取自 `window.__sidenote` 的只读入口，所以断言里的写法不用改 |
| `/opt/npm-tools/node_modules/playwright` 和 `/usr/bin/google-chrome` | 工程里安装的 Playwright 和它自带的 Chromium |

## 工程结构

```
index.html            #app、#overlay、离线提示条、视口和图标；可在这里设 window.SIDENOTE_CONFIG
src/
  main.tsx            启动顺序和全局监听（只注册一次）
  App.tsx             按路由选页面，取代 render()
  config.ts types.ts styles.css testBridge.ts
  lib/                helpers、store（localStorage）、idb（IndexedDB）、bus（bump/refresh）
  api/                http、api（示例和真实两个分支）、mock（示例数据）
  state/              app（S、state、R、cur、auth、nf）、router（route）、overlay（弹窗状态、busy、act、toast）
  i18n/               zh（ZH、ZHR，原样搬）、index（LANG、trs、t、setLang）、zhScript（繁简）
  features/
    player/           player.ts（pl 和全部 pl* 函数）、PlayerBar.tsx（播放条）
    recording/        recorder、outbox、orphan、tabAudio、finish
    export.ts         Markdown、Anki、逐字稿、打印、日历
  ui/                 icons（图标和 Sid）、Overlay（画弹窗）、Shell（外壳、骨架屏、语言按钮）、useStore、css、form
  pages/              Landing SignIn Home Course ReviewPack Settings Lecture Shared NewLecture Live；courseActions（改课程、删课程）
    lecture/          Notes Slides Transcript Cards Quiz 五个标签页，parts（要点、时间轴、工具栏）、actions（按钮动作，包括移动课堂）
tests/                检查脚本、harness、对比脚本；original/ 是没改过的原脚本
reference/            冻结的 sidenote.html 和 INTEGRATION.md
```

两条约定：`lib`、`api`、`state`、`i18n`、`features` 里的 `.ts` 文件不引用 React；`pages` 和 `ui` 不直接调 `fetch`，都经过 `api`。

## 重画是怎么做的

原文件到处是“改对象，再调 `render()`”。这里对象还是模块级的（`S`、`state`、`live`、`pl` 等），`render()` 换成了 `lib/bus.ts` 的两个函数：

- `bump()`：等同原来的 `render()`。React 通过 `useSyncExternalStore` 订阅，并在 `bump()` 返回前画完（`flushSync`），所以紧接着读页面的代码（`jump()` 里的 `scrollIntoView`、`setTab()` 里的 `#tabtop`）照常工作。页面每次都换成新元素，和原来 `innerHTML` 整页替换一样：下一张闪卡出现时不带翻转动画，跳转时时间轴指针不滑动，页面里的键盘焦点会丢（闪卡和测验的快捷键靠这一点），表单显示的是 `auth`、`nf`、`state` 里存的内容。
- `refresh()`：原来只改局部、不调 `render()` 的地方用它（课堂搜索、逐字稿搜索、实时字幕）。React 原地更新，搜索框不会丢焦点。

不经过 React 的部分和原来一样直接改 DOM：播放进度（`plTick` 改 `#pCur`、`#pBar`、时间轴指针和逐字稿高亮）、播放按钮图标（`plPaint`）、录音计时 `.clk` 和音量条 `#lvl`、闪卡翻面。音频对象 `pl.a` 留在模块里，切标签页不受影响，换路由时才 `plStop()`。

弹窗在另一个通道（`state/overlay.ts`），开关弹窗只重画 `#overlay`，和原来一样不动页面。

## 界面语言

`t()` 就是原来的 `trs()`：同一套 `ZH`、`ZHR`，同样的空白处理。每个界面字符串（包括 `placeholder`、`aria-label`、`title` 和 toast）在画的时候过 `t()`；带数字的句子先拼成整句英文再翻译。后端来的内容（课程编号和名称、讲座标题、章节名、课件页码标签、文件名等）一律不过 `t()`，原样显示；原来带 `data-notr` 的元素继续带。句子里要嵌后端内容时，像 `t("No lectures in " + c.code + " yet")` 这样整句交给一条 `ZHR` 规则，由规则把它原样放回；不要单独 `t(c.code)`，也不要用 `"/ " + ...` 拼（这条规则会翻译后半句）。`tests/backend-text.js` 检查这一点。加新的英文句子时，要在 `src/i18n/zh.ts` 的 `ZH` 或 `ZHR` 里补中文。
