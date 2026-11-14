# Sidenote 后端（第一到三阶段）

把课堂录音（可带 PDF 课件）变成笔记，前端用 `USE_MOCK: false` 就能显示。录音可以上传，也可以在浏览器里现场录（实时逐字稿、考试提示、Catch me up）；写好笔记后可以回放。之后学生可以改笔记、补传课件、分享给同学、做整门课的复习包、搜索全部笔记。设计和取舍见 [DESIGN.md](DESIGN.md)，接口约定见 `../reference/INTEGRATION.md` 和 `../API-CHANGES.md`。

需要 Node 22.12 以上和 `ffmpeg`（含 `ffprobe`）。

## 跑起来

```bash
cd server
npm install
cp .env.example .env      # 填三个 key 和 INVITE_CODES
npm start                 # http://localhost:8787
```

`npm start` 用同一个地址提供 `/api` 和构建好的前端（`../dist`），并替前端把 `USE_MOCK` 关掉、`API_BASE` 设成 `/api`。改了前端要先在仓库根目录 `npm run build`。用 `.env` 里的邀请码登录，新建课程，上传一段录音或点 Record now 现场录，等笔记出现。

现场录音要用麦克风，浏览器只在 `localhost` 或 HTTPS 下给麦克风。用手机试要先配 HTTPS（比如反向代理），并设 `PUBLIC_URL`。

不想把 key 写进文件，也可以在启动时用环境变量给。

## 命令

| 命令 | 作用 |
|---|---|
| `npm start` / `npm run dev` | 启动；`dev` 改了代码会自动重启 |
| `npm test` | 类型检查和全部测试（转写服务和 DeepSeek 用假实现，不花钱） |
| `npm run invite -- add <code> [名字]` / `new` / `list` | 管理邀请码。一个码就是一个账号 |
| `npm run costs` | 每堂课的成本，以及 INTEGRATION.md 第 10 节要的数字；补传课件和复习包的成本 |
| `npm run feedback` | 学生在课堂页 “What is wrong in these notes?” 里写的反馈，新的在前（`-- --all` 看全部） |
| `npm run compare-stt -- --language en-yue a.m4a b.mp3` | 同一批录音跑几家转写服务对比，结果在 `compare-out/`。加 `--chunks 15` 再按现场录音的做法（每 15 秒一轮）转写一遍，和整段比 |

## 对比转写服务

用真实课堂录音选转写服务：

1. 准备几段录音，最好包括粤语夹英文和普通话夹英文的课，每段 5 到 10 分钟就够。
2. 可选：在录音旁边放一份人工整理的逐字稿 `<同名>.ref.txt`，会多算一个错误率。英文按词算，中文按字算，繁简不算错。数字的写法会算错（参考稿写 three、服务写 3 就算一个错），所以参考稿里的数字请用阿拉伯数字写。
3. `npm run compare-stt -- --language en-yue 录音1.m4a 录音2.mp3`。默认跑 `elevenlabs:scribe_v3`、`elevenlabs:scribe_v2`、`deepgram:nova-3`，用 `--providers` 改。
4. 看 `compare-out/summary.md` 和各家的逐字稿 `compare-out/<录音>/<服务>.txt`。然后在 `.env` 里设 `STT_PROVIDER`（以及 `ELEVENLABS_MODEL` 或 `DEEPGRAM_LANGUAGES`）。

2026-11-13 用一段 62 秒的英文夹粤语录音（macOS 语音合成，不是真实课堂）试过：

| 服务 | 错误率 | 说明 |
|---|---|---|
| ElevenLabs `scribe_v3`（粤语 + 英文） | 4.6% | 字和 v2 一样，差别全在数字写法（写成 1、3、100）；粤语写成简体，流程里会转成繁体 |
| ElevenLabs `scribe_v2`（自动识别） | 1.0% | |
| Deepgram `nova-3`，`zh-HK` | 73% | 英文几乎全部丢掉 |
| Deepgram `nova-3`，`multi` | 73% | 开头的英文之后，大部分英文和一部分粤语都丢了 |

所以粤语夹英文的课先不要用 Deepgram。普通话夹英文还没试。真实课堂有口音、噪音和更快的语速，请用真实录音再比一次。

## 现场录音的设置

都在 `.env` 里，都有默认值（见 `.env.example`）：

| 设置 | 默认 | 作用 |
|---|---|---|
| `LIVE_RECORDING` | `on` | `off` 时不能开始现场录音（回 501，请学生上传） |
| `LIVE_TRANSCRIPT` | `on` | 录音时实时转写：录音页的逐字稿、考试提示、Catch me up。`off` 省掉这部分转写费，笔记不受影响 |
| `DAILY_LIVE_MINUTES` | 240 | 每个学生每天现场录音的分钟数。快用完时录音页会提醒，用完后停止保存，已保存的部分照常写笔记 |
| `CATCHUP_MODEL` | `deepseek-flash` | Catch me up 用的模型，不开思考 |
| `AUDIO_KEEP_DAYS` | 0 | 0 = 录音全部保留。设成 N，写好笔记的课 N 天后删掉录音（笔记保留） |
| `PUBLIC_URL` | 空 | 前端和 API 不在同一个地址时，回放链接用这个地址开头 |

现场录音每小时的转写费是上传录音的 2.12 倍：录音时实时转写一次，结束后为了写笔记再整段转写一次（15 秒一段的准确度差一些，尤其是粤语，见 DESIGN.md）。`npm run costs` 会列出实测的倍数和 Catch me up 每次的成本。

## 分享的设置

学生点 Share 得到的链接是前端的 `#/s/<随机 id>`，地址按顺序取：`WEB_URL`；没设就用学生当时打开的页面的地址；再没有就用 `PUBLIC_URL`。前端放在某个路径下（如 `https://uni.example.com/sidenote/`）时要设 `WEB_URL`。

`EXAMPLE_SHARE_ID`：公开页面（首页、登录页）上 “Example notes” 打开的分享课堂，填分享链接最后那串 id。不设就不显示这个入口。

分享页不带录音（INTEGRATION.md 4.3），也不带学习进度。

## 文件

```
src/
  index.ts         启动
  app.ts           /api 和前端网页
  routes.ts        第一、二阶段的接口，和课后补传课件
  library.ts       第三阶段的接口：改标题和课程、编辑笔记、进度、反馈、分享、改删课程、复习包、搜索
  packs.ts         复习包：每门课一次一个，重启后接着做
  shapes.ts        回复的 zod schema，和 ../src/types.ts 绑定
  db.ts            SQLite（node:sqlite）
  files.ts         课堂文件（本地磁盘）
  http/upload.ts   流式接收上传，中断不留文件
  media.ts         ffprobe / ffmpeg
  pipeline.ts      录音 -> 笔记的队列（现场录音先把分段拼起来）；课后补传的课件放进已有的笔记
  live/            现场录音：每轮转写 transcriber.ts、切窗口 windows.ts、考试提示 alerts.ts
  audio.ts         回放：签名链接、Range、保留期限
  stt/             转写服务：elevenlabs.ts、deepgram.ts、切句 lines.ts、对比打分 compare.ts
  notes/           DeepSeek：提示词 prompt.ts、调用 deepseek.ts、整理和校验 normalize.ts、繁简 zh.ts、Catch me up catchup.ts、
                   补传课件 slides.ts、复习包 pack.ts
  slides.ts        PDF 每页的文字
scripts/           invite、costs、compare-stt、feedback
test/              契约、上传、流程、整理、服务商请求、ffmpeg 和网页；现场录音（模拟浏览器）、真实分段、回放；
                   编辑和课程、分享、复习包、搜索、补传课件
test/fixtures/     Chrome 录下的真实分段（webm 和 MP4），见其中的 README
```

数据在 `data/`（gitignore）：`sidenote.db`，以及 `lectures/<课堂 id>/` 下的原始录音、`audio.m4a`（转码后，用于转写和回放）、`slides.pdf`、转写服务的原始返回；现场录音结束前，分段在 `chunks/` 里。

## 还没做的

- 视频链接（`attachLink` 回 501，请学生下载后上传）。
- 会员和付款（`GET /plans`、`POST /checkout`）、正式登录、设置保存（`PUT /settings`）：第四阶段。这些接口现在回 404 加说明，前端照常显示（设置页显示“方案尚未决定”）或忽略。
- 首页的本周统计（`week`）：学习进度和测验分数已经存了，但“本周”“已掌握的闪卡”“平均分”怎么算还没定，不给时前端不显示这一栏。
- 分享页的录音（4.3）：默认不带，要带是产品和合规上的决定。
- 搜索逐字稿和中文解释（API-CHANGES.md 第 4 节说以后再考虑）。
