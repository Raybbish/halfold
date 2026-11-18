# Halfnote 第一批：留到以后的小问题

第一批（`feat/halfnote-batch1`）每个任务审查、最后整体审查时发现、但判定不必在这一批修的问题。下一批规划时从这里挑。已经在第一批里修掉的没有列进来。

## 学生能看到的

- **上传**
  - 上传失败后又开始一个新上传，失败那份文件会被悄悄丢掉。那堂课仍然可以"Send a recording file"重新选文件。
  - 在失败的上传卡片上按"Delete this lecture"，提示的是"Upload cancelled. Nothing was kept."；删除请求失败时也这样提示。
  - 课堂页上"上传中"的卡片切到"正在写笔记"之间，有一瞬间"Cancel upload"按了没反应。
  - 上传完了但 `/finish` 失败的课，只给"Send a recording file"，要把整个文件再传一次。可以考虑给上传课也加一个"Make notes"。
  - 课堂页的"重新上传"在只有一个失败的上传时也说"Another upload is still running"，和新建课堂页的规则不一致。
  - 登录过期（不是主动退出）后，同一个分页换另一个账号登录，会继承上一个账号的失败上传。
- **后台写笔记**
  - 正在看的那堂课在别的设备上被删，写笔记的卡片会一直转，没有"Check again"。
  - 刚删掉一堂课时，正好在路上的状态查询还可能弹一次"笔记好了"，链接指向已删除的课。
  - 笔记写好时如果正在这堂课的页面上开着对话框，对话框会被关掉，里面打的字会丢。
  - 带链接的提示条对读屏软件来说是"状态"而不是"链接"（照抄设计稿）。
- **首页和新建课堂**
  - 还没有课程时点"Record"，会先建"My classes"再弹录音提示；这时按"Not now"或拒绝麦克风，会留下一门空课程（下次会继续用它）。
  - 首页录音卡片选的课程只写进"上次的课程"，同一次访问里新建课堂页可能还停在之前选的课程。
  - 首页录音卡片下面那行链接用的是设计稿原文"Upload a file, paste a link or record an online class"，设计说明里写的是"More options"。
- **录音页**
  - 改标题或课程的保存失败后，下次离开输入框不会再试；课程名先改了，保存失败也不会改回来。
  - 改了课程后，已经录下的分段记的还是旧课程代码（只影响"录音中断"提示在找不到记录时显示的代码）。
  - 重发的分段如果带着同一条考试提示，手机会再震一次。
- **课堂页**
  - 编辑笔记时，主题标题上还显示折叠箭头，但点了没反应。
- **帮助和隐私**
  - 登录后打开帮助页会离开 App 的外框；手机上登录后没有帮助和隐私的入口（侧栏只在电脑上有）。
- **语言**
  - 第一次来时按浏览器选出的语言会被记住（英文浏览器的新用户也会被存成英文）。
  - 服务器的部分错误提示没有中文翻译（以前就没有）。
  - Markdown 导出里"课件上没有"的要点标的是"**Halfnote:**"，界面上是"Not on slides"。

## 代码和测试

- 手机宽度下 `.mtop` 的间距从 10px 改成 6px，影响顶栏所有元素，不只是语言按钮。
- `src/state/app.ts` 里 `closed` 和 `found` 的注释挤在一行，读不通。
- `src/pages/Home.tsx` 里本地变量 `up`（考试日期）和导入的上传状态 `up` 同名。
- `src/features/recording/recorder.ts` 往 `Lecture` 上写了一个没人读的 `autoTitle: false`。
- 真实模式下拒绝麦克风时，新建的课堂会被删两次（第二次 404，无害）。
- `zh.ts` 里有一批不再用的英文键（"Notes are ready"、"Still working…"、"Hal is still writing these notes"、"Transcribing…"、"Rename lecture"、"Save title"、"Title saved"、"Move to another course"、"Move lecture"）。
- `package.json` 的 `test:legacy` 和 README 里对应的一行已经不起作用（`run-all.js` 只跑 build）。
- `tests/i18n-parity.js`、`tests/pages-compare.js`、`tests/known-differences.js`、`tests/compare-shots.js` 是迁移时对照 `sidenote.html` 用的，已经不在 `npm test` 和 CI 里，里面的说明和选择器也过时了，可以删掉。
- 测试覆盖的小缺口：
  - `zhcheck.js` 没扫到卡住课堂卡片的新句子；
  - `help-privacy.js` 的落地页翻译检查只扫了这次新写的部分；
  - 录音页标题提示文字是否放得下，只检查了英文；
  - `background-notes.js` 的"不会重复查询"检查拆掉去重保护也能通过；
  - `quick-record.js` 双击检查的第二下用了 `.catch(()=>{})`；
  - `stuck-lecture.js` 里多了一个用不到的 `lup2` 测试数据；
  - `tests/zh-hans.js` 约第 504 行缩进不齐；
  - `server/test/payments.test.ts` 的测试邮箱还是 `login@sidenote.example`；
  - `tests/kept.js` 没在第一批之前的代码上实际跑过（只是逻辑上确认）。
