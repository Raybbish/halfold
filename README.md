# Sidenote 前端（sidenote-web）

`sidenote.html` 单文件前端搬到 React + TypeScript 的工程。界面、文案、接口、本机存储和地址都与原文件一致，见“验收结果”。原文件冻结在 `reference/sidenote.html`，对接文档在 `reference/INTEGRATION.md`。

迁移中发现但没改的问题、实现上和原文件不同的地方、真机走查的结果，都在 [DIFFERENCES.md](DIFFERENCES.md)。

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

验收之后修了几个原文件里就有的问题（中文骨架屏闪英文、落地页示例笔记没有中文、新建课堂可以连点提交、语言按钮的读屏标签），见 [DIFFERENCES.md](DIFFERENCES.md) 第 1 节。所以现在的截图对比里，中文落地页会和原文件不同，`tests/known-differences.js` 把它列为有意的差异，不算失败。

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

一条命令全跑（先构建，再对 `dist` 跑全部检查和截图对比）：

```bash
npm test
```

它依次跑：

1. `npm run build`：`tsc --noEmit` 零错误，构建零警告。
2. `tests/real5.js`（65 项）、`tests/zhscript.js`（16 项）、`tests/real3.js`（11 项）、`tests/zhcheck.js`（10 项），共 102 项。示例模式和真后端模式（请求拦截出来的假接口）都覆盖。
3. `tests/overflow5.js`：8 个宽度、两种语言没有横向滚动；`tests/printcheck.js`：打印时导航、播放器、按钮都隐藏。
4. `tests/shots5.js` 的走查路径分别对原文件和构建结果各截一遍（关掉动画），逐张逐像素对比。

日志、截图和差异图在 `tests/output/`。同一套脚本也能对原文件跑，用来对照：

```bash
npm run test:legacy
```

对构建产物还会多跑一个 `tests/upload.js`（13 项）：上传录音时的进度条和取消按钮，这是迁移之后加的功能，原文件没有。

另外三个迁移时用的对比脚本，单独运行：

| 脚本 | 内容 |
|---|---|
| `node tests/api-parity.js` | 示例模式下 `api` 各函数的返回值与原文件逐字节相同 |
| `node tests/i18n-parity.js` | 词典每个键、每条 `ZHR` 规则的翻译结果与原文件相同 |
| `node tests/pages-compare.js` | 每个页面和弹窗的整页截图，375/1280 宽、中英文，与原文件逐像素对比 |

### GitHub 上的自动检查（CI）

`.github/workflows/ci.yml` 在每个 Pull Request 和每次推送到 `main` 时，在 GitHub 的 Ubuntu 机器上自动跑一遍，大约 20 分钟：

1. 类型检查和构建，有警告也算失败；
2. 仓库里提交的 `dist/` 和这次构建结果一致（`dist/` 是直接部署的，改了源码要记得重新构建并提交）；
3. `npm test`：102 项检查、上传功能的 13 项、横向滚动、打印、截图对比；
4. `tests/api-parity.js` 和 `tests/i18n-parity.js`。

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
  pages/              Landing SignIn Home Course ReviewPack Settings Lecture Shared NewLecture Live
    lecture/          Notes Slides Transcript Cards Quiz 五个标签页，parts（要点、时间轴、工具栏）、actions（按钮动作）
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

`t()` 就是原来的 `trs()`：同一套 `ZH`、`ZHR`，同样的空白处理。每个界面字符串（包括 `placeholder`、`aria-label`、`title` 和 toast）在画的时候过 `t()`；带数字的句子先拼成整句英文再翻译。后端来的内容不过 `t()`，原来带 `data-notr` 的元素继续带。加新的英文句子时，要在 `src/i18n/zh.ts` 的 `ZH` 或 `ZHR` 里补中文。
