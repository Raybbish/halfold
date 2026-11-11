# 差异清单

迁移验收用。分四部分：迁移中发现但没改的原文件问题、实现方式和原文件不同的地方、检查脚本的改动和无法照搬的检查、真机走查。

## 1. 发现但没改的问题

按派工单的要求，这些都原样保留，等迁移验收后再单独处理。

| # | 位置 | 问题 | 现在的表现 |
|---|---|---|---|
| 1 | 加载中的骨架屏（`route()`） | 原文件把骨架屏直接写进 `#app`，没有经过翻译，所以中文界面下等数据的那一瞬间，外壳（侧栏、手机顶栏和底栏）是英文 | 保留。`ui/Shell.tsx` 的 `raw` 参数专门画这个不翻译的版本 |
| 2 | 语言按钮 | 按钮带 `data-notr`，所以词典里的 "Switch language" 用不上，中文界面下它的 `aria-label` 仍是英文 | 保留 |
| 3 | 落地页 | 示意图里的课件文字和三张便利贴（"Opportunity cost"、"A year here costs the tuition plus..." 等）不在词典里，中文界面下是英文 | 保留 |
| 4 | 词典 | 6 个键原文件已经用不到，是旧文案：<br>"Tap a timestamp and read the lecturer's exact words."<br>"Anyone with the link can read the notes, flashcards and quiz. They cannot see your other lectures."<br>"The notes, flashcards, quiz and any shared link will be removed. This cannot be undone."<br>"Slides did not upload. You can add them later."<br>"The end of your recording has not been sent yet. Keep this page open and try again when you are back online."<br>"The notes could not be written. Open the lecture to try again." | 词典原样搬，没删 |
| 5 | 没标 `data-notr` 的后端内容 | 原文件会翻译页面上所有没标 `data-notr` 的文字，包括侧栏和课程卡片上的课程编号、面包屑里的课程编号、课件页码标签（`section.slides`）、时间轴上的章节名（`title`、`aria-label`）、上传文件名。目前这些内容碰巧都不在词典里，所以看不出来；如果后端给的课程编号正好等于某个词典键，会被翻译 | 保留同样的行为（这些位置照样过 `t()`） |
| 6 | 新建页提交 | `submitNew()` 设 `nf.busy = true` 后没有重画，按钮在请求期间不会马上变灰，连点可能建出两堂课 | 保留 |
| 7 | 派工单的数字 | 派工单写 `ZH` 109 条，那是行数；实际是 332 个键。`ZHR` 41 条一致 | 只是说明 |

## 2. 实现方式不同的地方

这些都看不出来，或者是派工单允许的改法。

| # | 内容 | 说明 |
|---|---|---|
| 1 | `render()` → `bump()` / `refresh()` | `bump()` 在返回前画完，并给页面换新元素，和原来 `innerHTML` 整页替换一样（下一张闪卡不带翻转动画、时间轴指针跳转不滑动、页面里的焦点会丢、表单显示模块对象里存的值）。原来只改局部的三处（课堂搜索、逐字稿搜索、实时字幕）用 `refresh()` 原地更新，搜索框不丢焦点。见 `src/lib/bus.ts` |
| 2 | 实时字幕 `applyChunk` | 原来直接改 `#stream` 和 `#liveAlert` 的 `innerHTML`，现在改 `live` 后 `refresh()`，仍然每次滚到底（派工单允许改成状态驱动）。唯一能看出的差别：原来 `#stream` 这样改写时没有翻译，所以真后端返回空 `segments` 时，中文界面下的“老师开始说话后约半分钟会出现文字”会变回英文；现在保持中文 |
| 3 | 弹窗的锁定 | 原来靠 `.modal` 有没有 `onclick` 属性判断，现在看 `overlay.modal.locked`。六个行为（写进 `#overlay`、聚焦第一个输入框、点背景关闭、锁定时不能关、Esc 只关未锁定的、换路由时关闭）都保留 |
| 4 | 弹窗里输入框的光标 | 原来输入框的值写在标记里，聚焦后光标在开头（长标题显示开头）；React 用属性设值，光标会跑到末尾。`ui/Overlay.tsx` 聚焦前把光标移回开头，和原来一致（截图对比发现的） |
| 5 | 文件划分 | `session` 放在 `state/app.ts`（它读写 `S`），不在 `lib/store.ts`；`modal`、`busy`、`act`、`toast` 的逻辑在 `state/overlay.ts`，`ui/Overlay.tsx` 只负责画。这样 `features` 里的逻辑文件可以开弹窗而不引用 React |
| 6 | 播放条组件叫 `PlayerBar.tsx` | 派工单写 `player/Player.tsx`，但在大小写不敏感的文件系统（macOS 默认）上它和 `player/player.ts` 冲突，TypeScript 会解析错 |
| 7 | 样式表不压缩 | Vite 的 CSS 压缩会删掉 `-webkit-backface-visibility`（老 iPhone 上闪卡翻面要用）等带前缀的规则，所以关掉了，`dist` 里的样式和原文件逐字相同（只差空白） |
| 8 | 离线提示条 | 仍是 `index.html` 里的 `.offline-bar`，文字由 React 写入并随界面语言切换 |
| 9 | 测试入口 `window.__sidenote` | 构建产物里一直有，检查脚本靠它读页面内部对象。只读引用，不影响功能 |
| 10 | 依赖版本 | React 19.2.9、TypeScript 6.0.3、Vite 8.3.8。运行时依赖只有 react 和 react-dom |

## 3. 检查脚本

### 改动

四个检查脚本和截图、横向滚动、打印脚本只改了派工单列出的四处（载入页面、改配置、页面内部对象、本机路径），改法见 README 的“检查脚本改了什么”。`check(...)` 断言一行没改：改造脚本逐行核对过，104 行 `check(` 全部与 `tests/original/` 相同。

### 无法照搬的检查

没有。七个脚本都按原来的步骤和断言跑通。两处补充说明：

- 原脚本用 `file://` 打开页面，现在统一用 `http://localhost:8765`（请求拦截，不开真端口）。为了对照，原文件也用同样的方式打开（`npm run test:legacy`），在这台机器上原文件同样 102 项全过、没有横向滚动、打印正常。
- `shots5.js` 原本手机宽度是 390px，派工单要求 375px。脚本没改，由 `harness.js` 的 `SIDENOTE_PHONE_WIDTH=375` 把手机视口换成 375px，`npm test` 两种宽度各跑一遍。

### 截图对比

`npm test` 对原文件和新工程各走一遍 `shots5.js` 的路径（关掉动画，`prefers-reduced-motion`），逐张逐像素对比：

| 手机宽度 | 张数（手机和 1280 桌面，中英文） | 完全相同 | 有差异 |
|---|---|---|---|
| 390px | 88 | 87 | 1：`15-live` |
| 375px | 88 | 85 | 3：`15-live`（桌面英文、手机英文、手机中文） |

有差异的全是录音页（`15-live`），位置都在麦克风音量条的绿色部分，宽度差 1 到 4 个像素。音量条按麦克风的实时音量变化（检查用的是 Chrome 的模拟麦克风），截图那一刻的音量不同，与迁移无关。之前的一次运行里还出现过录音计时差一秒（`0:09` 和 `0:08`），原因相同：脚本按固定时间等待，截图落在哪一秒不固定。

`tests/pages-compare.js` 另外对每个页面和弹窗截整页图（375 和 1280 宽、中英文，共 164 张）：162 张完全相同，2 张只差抗锯齿噪点，0 张有真正的差异。个别图片只在卡片圆角边缘有几个像素差一个色阶（最大差 1/255），原文件自己连跑两次也会这样，脚本把它标为“抗锯齿噪点”单独列出。截图前把鼠标停在页面顶端没有悬停效果的位置，否则悬停状态会因时机不同而变化（原文件自己对比也会出现）。

## 4. 真机走查

**还没做。** 这一项要用真的 iPhone 和 Android 手机操作，迁移时的环境里没有真机，只能由人来做。下面是走查方法和记录表，原文件和新工程各走一遍。

### 准备

- **必须用 HTTPS。** 手机浏览器只在安全来源（HTTPS 或 localhost）下允许用麦克风，用电脑局域网 IP 加 http 打开是录不了音的。最简单的做法是部署到一个有证书的测试域名，Caddy 会自动申请证书。
- **两个版本放在不同的域名下**，例如 `old.<测试域名>` 放 `reference/sidenote.html`（改名为 `index.html`），`new.<测试域名>` 放 `dist/`。放在同一个域名下，两边会共用 `sidenote.*` 的 localStorage 和 IndexedDB 库，未完成录音的标记会互相干扰。
- 有后端就接真后端（`USE_MOCK: false`），这样才能验证分段上传、结束后生成笔记和真实回放。没有后端时用示例模式：麦克风是真的在录，但分段交给的是假的上传函数，回放是模拟的，这一点要记在结果里。
- 第一次录音前会弹“Before you record”提示，正常确认即可。

### 步骤（每台设备、每个版本各一次，约 7 分钟）

| 时间 | 操作 | 观察并记录 |
|---|---|---|
| 0:00 | 新建课堂，开始录音 | 是否要求麦克风权限；计时开始；音量条有动静 |
| 1:00 | 锁屏 30 秒，再解锁回到页面 | 回来后的计时（iPhone 上应停住不走）；是否出现“Recording stopped for about … seconds”；音量条是否恢复 |
| 2:00 | 切到别的 App 30 秒，再切回来 | 同上；屏幕常亮是否恢复 |
| 3:00 | 开飞行模式或断网 30 秒，再恢复 | 顶部离线提示条；录音页的“Connection”提示；恢复后提示消失，积压的分段补发 |
| 5:00 | 点“End and make notes” | 是否误报“Waiting for a connection”；是否跳到笔记页 |
| 结束后 | 在笔记页点一个时间戳，再播放 | 定位到逐字稿那一行；播放、倍速、前进后退；锁屏界面的媒体控制 |

### 记录

| 设备和浏览器 | 版本 | 计时 | 锁屏 | 切 App | 断网 | 结束 | 回放 | 其他 |
|---|---|---|---|---|---|---|---|---|
| iPhone，Safari | 原文件 | | | | | | | |
| iPhone，Safari | 新工程 | | | | | | | |
| Android，Chrome | 原文件 | | | | | | | |
| Android，Chrome | 新工程 | | | | | | | |
