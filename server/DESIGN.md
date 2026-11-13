# Sidenote 后端第一阶段：设计

日期：2026-11-13。范围：上传录音（可带 PDF 课件）到笔记显示在课堂页，这一条路走通。

## 为什么做、做到什么程度

前端（`src/`）一直跑在示例数据上（`USE_MOCK: true`）。这一阶段做最小的闭环：学生上传一段课堂录音，后端转写、写笔记，前端把 `USE_MOCK` 改成 `false` 就能在课堂页看到。同时把每堂课的成本记下来，回答 `reference/INTEGRATION.md` 第 10 节的定价问题。

**做到**

- 11 个接口：`POST /session`、`GET /home`、`POST /courses`、`POST /lectures`、`POST /lectures/:id/recording`、`POST /lectures/:id/slides`、`POST /lectures/:id/finish`、`GET /lectures/:id/status`、`POST /lectures/:id/retry`、`GET /lectures/:id`、`DELETE /lectures/:id`。
- 处理流程：存文件 → 转码 → 转写 → DeepSeek 写笔记 → 校验 → `ready` 或 `failed`。
- 每堂课的成本日志（音频分钟、token、估算美元），以及汇总脚本。
- 两家转写服务，加一个用真实录音对比它们的脚本。
- 契约测试（回复的形状对得上 `src/types.ts`），以及转写服务和写笔记模型都换成假实现的流程测试。

**不做（后面的阶段）**

- 现场录音的分段上传、Catch me up、录音回放（本阶段 `detail` 不带 `audio`，前端不显示播放器）。
- 编辑笔记、分享、学习进度、复习包、课程管理、搜索、课后补传课件。
- 会员方案、付款、正式登录。

**算失败的情况**：接口形状和前端对不上；上传中断后留下残缺文件；同一堂课被重复扣费（重试重新转写、`finish` 被调用两次各跑一遍）；模型写出的东西不合规矩却被标成 `ready`。

## 已定的选择

| 项 | 选择 | 谁定的 |
|---|---|---|
| 技术栈 | TypeScript + Hono，放在本仓库 `server/`，直接 `import type` 前端的 `src/types.ts` | 用户 |
| 转写 | ElevenLabs Scribe 和 Deepgram Nova-3，放在同一个 `Transcriber` 接口后面，由 `.env` 的 `STT_PROVIDER` 选 | 用户 |
| 写笔记 | DeepSeek，放在 `NotesWriter` 接口后面，模型 id 写在 `.env` | 用户 |
| 每日分钟上限 | 只管现场录音（`record`、`tab`），上传不计入也不拦 | 用户 |
| API key | 用户自己写进 `server/.env`（gitignore），仓库里只有 `.env.example` | 用户 |
| Scribe 版本 | 默认 `scribe_v3`：官方文档说它是录好的音频最准的模型，并且能传第二语言（`secondary_language_codes`），正适合粤语或普通话夹英文。改 `ELEVENLABS_MODEL=scribe_v2` 就换回 v2，对比脚本两个都跑 | 我定的 |
| DeepSeek 模型 | 默认 `deepseek-v4-pro`，可改成 `deepseek-flash` | 我定的 |
| 数据库和文件 | Node 自带的 `node:sqlite`（不用编译原生模块），文件放本地 `server/data/`。都在小接口后面，以后换 Postgres 或对象存储只改一处 | 我定的 |
| 邀请码 | 一个邀请码就是一个账号：同一个码再登录，看到的是同一批课。码由 `.env` 的 `INVITE_CODES` 预置，或用 `npm run invite` 添加 | 我定的 |
| 中文解释 | 每个要点都写一句（示例数据就是这样）。模型只写一种字体：`en-zh` 写简体，其他写繁体（香港），另一种用 OpenCC 转出来 | 我定的 |

## 考虑过的做法

**写笔记：一次调用 vs. 分段调用。** 一堂 90 分钟的课转写下来约 2 到 3 万 token，DeepSeek V4 的上下文是 100 万，一次调用就能装下整堂课和课件。分段调用（先分主题，再逐段写要点）能并行，但要多一轮协调，主题边界也容易对不齐。选一次调用；以后真的超时或质量下降再拆。

**课件：直接给模型 PDF vs. 先抽文字。** DeepSeek 的接口对 PDF 的支持没有明确文档。所以先用 `pdfjs-dist` 逐页抽出文字，按“Slide n: 文字”给模型，用来判断要点属于哪一页、`off`（课件上没有）是否成立。缩略图本阶段不做（`slide.image: null`，前端显示页码和标题）。

**逐字稿：让模型输出 vs. 直接用转写结果。** 让模型把逐字稿再写一遍，既贵又可能改字。所以 `detail.transcript` 直接由转写的词和时间戳切成句子；模型只写要点、分节、提示、闪卡和测验。

**大文件上传：Hono 的 `parseBody` vs. 流式解析。** `parseBody` 会把整个文件读进内存，500 MB 的文件不行。所以用 `busboy` 边收边写临时文件，收完整了再改名放到位；请求中断就删掉临时文件。`Content-Length` 超过上限的请求直接回 413，不读请求体。

## 接口行为

通用：

- 所有路径在 `/api` 下（前端 `API_BASE: "/api"`）。出错一律回 `{ "message": "..." }`，这句话会直接显示给用户。
- JSON 请求体最大 64 KB，超过回 413（包括不用登录的 `POST /session`）。上传文件的请求最长可以持续 3 小时（Node 默认 5 分钟，慢网速传 500 MB 会被切断）。
- 分享页的 `GET /shared/:id` 不用登录，本阶段一律回 404 和说明（不能回 401，否则前端会让读者“重新登录”）。
- 除 `POST /session` 外都要 `Authorization: Bearer <token>`，token 无效或缺失回 401。
- 别的用户的课程和课堂一律当作不存在，回 404。
- 文件超过 `MAX_UPLOAD_MB`（默认 500，和前端一致）回 413。

| 接口 | 行为 |
|---|---|
| `POST /session` `{inviteCode, name}` | 码不对回 401 加说明（前端对这个公开接口原样显示）。给了 `name` 就更新名字。回 `{token, user}` |
| `GET /home` | `user`、`courses`、`lectures`（新的在前）、`upcoming`（从笔记里带日期的考试和截止提示汇总，只给今天及以后的）、`settings`、`usage`、`today`（按 `APP_TIMEZONE`，默认香港）。`week` 本阶段不给 |
| `POST /courses` `{code, name}` | `code` 必填，最长 20 字；`name` 最长 80 字。回 `course`，带一个配色 |
| `POST /lectures` `{courseId, title, language, source}` | 检查课程、语言、来源。`record`、`tab` 先查当天现场录音分钟数，超了回 429 加说明；本阶段还不收分段，所以再回 501“录音功能还没开放，请上传录音”（不让前端开始录一堂存不下来的课）。`link` 回 501。`upload` 建课，状态 `recording`（和示例数据一致），回 `lecture` |
| `POST /lectures/:id/recording` | 只在 `recording` 状态收。流式收完用 `ffprobe` 确认有音轨，没有就删掉并回 415。存成固定的文件名 `recording`（不带扩展名），这样 ffmpeg 按内容识别格式，上传的文件名改不了它的读法（比如把文件叫成 `.m3u8` 当播放列表读）。同一堂课再传一次会覆盖 |
| `POST /lectures/:id/slides` | 在 `recording` 或 `failed` 状态收（失败后补上课件再重试）。检查 `%PDF` 文件头，不是 PDF 回 415。笔记已生成后再传（补传课件）本阶段回 409 加说明；这个检查放在文件收完之后，免得浏览器还在发送时就收到回复，把它当成网络错误 |
| `POST /lectures/:id/finish` `{duration}` | 幂等：已经是 `processing` 或 `ready` 就原样回状态，不重复排队。没收到录音回 409“这堂课没有收到录音”。否则设 `processing` 并排队 |
| `GET /lectures/:id/status` | `{status}` |
| `POST /lectures/:id/retry` | 只在 `failed` 时排队重跑，其他状态原样回。已转写过的不再转写，只重跑写笔记 |
| `GET /lectures/:id` | `{lecture, detail}`，笔记没好时 `detail: null` |
| `DELETE /lectures/:id` | 删记录、文件、笔记、成本以外的一切；正在跑的流程会被中止，跑完的结果丢掉。上传进行中被删，收完的文件也会被丢掉。成本日志保留（课堂 id 留着，用来算账） |

`lecture.duration` 用转码后音频的实际长度（`ffprobe`），不用前端传的计时。`lecture.date` 是显示用的文字：当天是 `Today`（中文界面会翻译），否则如 `Tue 10 Nov`。

## 处理流程

在服务进程里跑一个队列（并发数 `PIPELINE_CONCURRENCY`，默认 2）。服务重启时，状态还是 `processing` 的课会重新排队。每一步的结果都存下来，重试时跳过已完成的步骤：

1. **转码**：`ffmpeg` 把录音（视频则抽音轨）转成单声道 AAC 48 kbps 的 `audio.m4a`，带 faststart，可以拖动进度。这个文件用来转写，也留给下一阶段的回放。记下时长和文件大小（第 10 节要“转码后的回放文件每小时多大”）。
2. **转写**：`Transcriber.transcribe(audio.m4a, language)` 返回带时间戳的词。原始返回存成 `transcript.raw.json` 方便对比，切好的句子存进数据库。切句：遇到句末标点且这一句超过 3 秒、停顿超过 1.2 秒或一句超过 25 秒就断开；中日韩字符之间不加空格。
3. **课件**：有 `slides.pdf` 就逐页抽文字。读不了（加了密码、文件损坏）就不用课件，照常写笔记，不让整堂课失败。
4. **写笔记**：`NotesWriter.write(...)` 把课程、标题、日期、语言、时长、带秒数的逐字稿、课件文字交给 DeepSeek（JSON 输出模式、流式、开思考），要回 `sections`、`slides`、`alerts`（带 `date`）、`flashcards`、`quiz`。回复逐项读：数字写成字符串、`"true"`、用字母表示的答案都接受；某一项实在用不了（要点没有时间或文字、闪卡没有答案）就只丢这一项。整份回复不是 JSON、或者一个能用的要点都没有，才把错误告诉模型再要一次，最多两次。
5. **整理和校验**：时间夹到 `[0, 时长]` 并取整；`section` 按时间排好、首尾相接、最后一段到时长为止；没有课件时 `slide: null`、`off: false`，`slides: []`；超出页数的 `slide` 改成 `null`；`section.slides` 由要点的页码算出（如 `Slides 3 to 6`）；`alerts.kind` 规范成 `Midterm`、`Deadline`、`Exam hint`、`Quiz`、`Final`；选项数或答案下标不对的测验题丢掉；中文解释转出另一种字体；逐字稿按 `t` 排序。最后用和 `Detail` 类型绑定的 zod schema 校验，不过就是 `failed`。
6. 存 `detail`，带日期的提示存进 `upcoming`，状态改 `ready`。

任何一步出错：状态 `failed`，错误原因记在数据库（不给前端看），日志里打印。

调用转写服务和 DeepSeek 时，只重试对方明确拒绝的（429、5xx）和根本没送到的（连不上）。超时、回复读到一半断掉这类情况不重试：音频可能已经送到并计费，再试一次就付两次钱。

## 成本日志

表 `costs` 每一步一行：课堂 id、步骤（`stt`、`notes`）、服务商、模型、音频秒数、输入 token（命中缓存和未命中分开）、输出 token、其中思考 token、估算美元、时间。单价写在 `.env`，默认值取自各家价目页：Scribe 和 Deepgram 按小时；DeepSeek 按百万 token，并且分高峰（UTC 周一到周五 01:00–04:00、06:00–10:00）和非高峰半价。

`npm run costs` 打印每堂课的成本，以及“每小时录音的转写成本”“按 90 分钟算每堂课的笔记成本”“有课件和没课件的差”“回放文件每小时多大”，对应第 10 节的表。中文解释多出来的成本：`ZH_EXPLANATIONS=off` 跑同一堂课对比。

## 测试

- `npm test`（在 `server/` 里，Node 自带的 test runner 加 `tsx`）：
  - 契约测试：用 `app.request()` 逐个调接口，回复用 zod schema 校验。这些 schema 声明为 `z.ZodType<Home>` 这样的类型，和 `src/types.ts` 对不上时编译就报错。
  - 401、413、415、409、404 等规则；上传中途断开不留文件；删除正在上传的课。
  - 流程测试：转写和写笔记都用假实现，验证 `ready`、`failed`、重试不再转写、`finish` 幂等、删除时中止，以及整理规则。
  - `ffmpeg` 相关：机器上有 `ffmpeg` 才跑，没有就跳过。
- CI 加一步跑 `server/` 的测试。前端的 `npm test` 不受影响（`server/` 不在前端的 `tsconfig` 和构建里）。

## 端到端

`npm start` 起服务（默认端口 8787），同一个地址既是 `/api`，也把构建好的 `dist/` 当网页发出去，并在 `index.html` 里注入 `window.SIDENOTE_CONFIG = {USE_MOCK:false, API_BASE:"/api"}`。用一段真实录音上传，等笔记出现在课堂页。

## 留给实现时定的

提示词的具体写法、切句的阈值、配色、id 的格式、日志格式。
