# 标记、提问、跨课复习：把前端稿里的三样搬进来

日期：2026-11-24　分支：`claude/marks-questions-review-cec67c`

## 为什么做

2026-11-23 交接第 6 项最后一条：前端稿里早就写好的三个功能还没合进线上版本。

- 课上的"重点 / 没听懂"标记。
- 向这堂课提问。
- 跨课堂闪卡复习。

来源：`halfold.html`（2026-11-20）的 `addMark`、`marksHtml`、`askLecture`、`reviewPage` 等函数，接口见设计师 `INTEGRATION(2).md` 第 0.1 节和第 2 节。做法和第一批一样（`2026-11-16-halfnote-batch1-design.md`）：在 React 版里一样一样加，文案照搬稿子的英文和繁体。

`halfold(1).html`（2026-11-24）和 11-20 版比，这三个功能的代码一个字没变。新增的是套餐和付款（按小时计费、学期通、充值、优惠码、推荐码）、注册后的资料和两个同意勾选框、只用课件做"学习包"、首页一句普通话和粤语的文案。这些不在这次的范围：套餐和额度规则还在定，注册资料和付款另有会话在做。

## 接口（名字照设计师的建议）

| 函数 | 请求 | 返回 |
|---|---|---|
| `addMark(id, {t, kind})` | `POST /lectures/:id/marks` | 204。`kind` 是 `important` 或 `lost` |
| `ask(id, question)` | `POST /lectures/:id/ask`，body `{ question }` | `{ answer, refs: [{ t, text }] }` |
| `getReview()` | `GET /review` | `{ cards: [{ lectureId, lecture, index, q, a }] }` |
| `setCardKnown(id, index, known)` | `PUT /lectures/:id/cards/known`，body `{ index, known }` | 204 |

另外两个字段：

- `detail.marks: [{ t, kind }]`：`GET /lectures/:id` 里，按时间排。只给课堂的主人：分享页和别人存下的副本都没有。
- `GET /home` 的 `reviewCount`：还没标"记得"的闪卡总数。

## 服务器

- **标记**存在新表 `marks (lecture_id, t, kind, created_at)`，主键 `(lecture_id, t, kind)`，同一秒同一种点两次只算一次（前端出错不重发，但网络重试时不会重复）。每堂课最多 500 个。`t` 是 0 到 12 小时之间的秒数（取整到 0.1 秒）。任何状态的课都收（录音中最常用）；删课时跟着删。
- **提问**：`notes/ask.ts`，照 `notes/catchup.ts` 的样子：
  - 用 DeepSeek，默认和 Catch me up 一样的小模型、不开思考（`ASK_MODEL`、`ASK_REASONING_EFFORT`、`ASK_MAX_TOKENS`、`ASK_USD_PER_M_*`，没设就跟 `CATCHUP_*` 走）。
  - 发给模型：课程代码、标题、上课语言、问题、整份逐字稿（每行带编号和时间）。没有逐字稿的课（目前不会有）退回用笔记要点。
  - 模型回 `{"answer": "...", "refs": [行号]}`。服务器按行号取回原话和时间，模型编的行号丢掉，最多 4 条。这样"老师在哪里说的"一定是逐字稿里真有的句子。
  - 用问题的语言回答；逐字稿里没有就直说没讲到，不编。
  - 成本记在 `costs` 表，stage `ask`，模型回复不能用也记（已经付了钱）。`npm run costs` 多一列。
  - 问题 1 到 300 字。没有笔记的课回 409。模型出错回 502"Hal could not answer that just now. Try again in a moment."
  - 不加次数上限：额度规则还在定。
- **复习**：`GET /review` 从每堂有笔记的课里取闪卡，去掉 `progress` 里标了记得的，新课在前，每堂课里按原来的顺序，最多 1000 张。`PUT /lectures/:id/cards/known` 只改 `progress.known` 里这一张，测验分数不动；卡片不存在回 404。
- `shapes.ts`、`src/types.ts` 加上这些形状，契约测试覆盖。

## 页面

- **录音页**：标题输入框下面一行"Mark this moment"，两个按钮 Important / Lost me，旁边写已经标了几处。点了手机震一下、提示一句。标记同时存在本机（`sidenote.marks.<课堂id>`），服务器没收到时课堂页用本机这份。
- **课堂页笔记标签**：摘要和主题目录下面一张"Your marks from class"卡片，按时间排，每条显示标记那一刻的逐字稿原话。点时间从标记前 15 秒开始放。分享页不显示。
- **课堂页"Ask"标签**：自己的课、有内容时才出现。输入框（最多 300 字）、"Ask"按钮（问的时候变"Looking"）。回答下面是"Where it was said"，每条原话带时间，点了跳过去播放。示例数据版本只按关键词找片段，不写回答，页面上有说明。
- **复习页 `#/review`**：侧栏"Review"带数字；首页"接着上次看"旁边一张"Review"卡片。一张张翻：空格翻面，→"I know this"，↓"Again later"。卡片下面写来自哪堂课，可点。翻完显示标了几张，可以把剩下的再过一遍。课堂页里点"I know this"也会让数字减一。
- 中文：稿子里的繁体照搬进 `src/i18n/zh.ts`，带数字的句子加进 `ZHR`。

## 不做（这次）

- 稿子里服务器没有 `/review`、`/ask` 时的退路（前端逐堂拉取拼复习卡、用 `saveProgress` 存）：服务器这次就有这些接口，退路只会让代码多一条永远不走的路。
- 写笔记时把标记交给模型（"没听懂"的地方讲细、"重点"优先出题）：会改每堂课的笔记提示词，应该先拿实测课比一比再开。
- 提问的次数上限：额度规则还在定。
- 手机底部导航加"复习"：底部只有三格，首页的卡片已经能进。
- `halfold(1).html` 里的套餐、付款、资料和同意、课件学习包（见上）。

## 测试

- 服务器：`server/test/study.test.ts`，三样各一组；`contract.test.ts` 加新回复。
- 页面：`tests/marks.js`、`tests/ask.js`、`tests/review.js`，用请求拦截假装后端，各自含中文检查，加进 `tests/run-all.js`。
