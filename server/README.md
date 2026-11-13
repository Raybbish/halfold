# Sidenote 后端（第一阶段）

把上传的课堂录音（可带 PDF 课件）变成笔记，前端用 `USE_MOCK: false` 就能显示。设计和取舍见 [DESIGN.md](DESIGN.md)，接口约定见 `../reference/INTEGRATION.md` 和 `../API-CHANGES.md`。

需要 Node 22.12 以上和 `ffmpeg`（含 `ffprobe`）。

## 跑起来

```bash
cd server
npm install
cp .env.example .env      # 填三个 key 和 INVITE_CODES
npm start                 # http://localhost:8787
```

`npm start` 用同一个地址提供 `/api` 和构建好的前端（`../dist`），并替前端把 `USE_MOCK` 关掉、`API_BASE` 设成 `/api`。改了前端要先在仓库根目录 `npm run build`。用 `.env` 里的邀请码登录，新建课程，上传一段录音，等笔记出现。

不想把 key 写进文件，也可以在启动时用环境变量给。

## 命令

| 命令 | 作用 |
|---|---|
| `npm start` / `npm run dev` | 启动；`dev` 改了代码会自动重启 |
| `npm test` | 类型检查和全部测试（转写服务和 DeepSeek 用假实现，不花钱） |
| `npm run invite -- add <code> [名字]` / `new` / `list` | 管理邀请码。一个码就是一个账号 |
| `npm run costs` | 每堂课的成本，以及 INTEGRATION.md 第 10 节要的数字 |
| `npm run compare-stt -- --language en-yue a.m4a b.mp3` | 同一批录音跑几家转写服务对比，结果在 `compare-out/` |

## 对比转写服务

用真实课堂录音选转写服务：

1. 准备几段录音，最好包括粤语夹英文和普通话夹英文的课，每段 5 到 10 分钟就够。
2. 可选：在录音旁边放一份人工整理的逐字稿 `<同名>.ref.txt`，会多算一个错误率。英文按词算，中文按字算，繁简不算错。
3. `npm run compare-stt -- --language en-yue 录音1.m4a 录音2.mp3`。默认跑 `elevenlabs:scribe_v3`、`elevenlabs:scribe_v2`、`deepgram:nova-3`，用 `--providers` 改。
4. 看 `compare-out/summary.md` 和各家的逐字稿 `compare-out/<录音>/<服务>.txt`。然后在 `.env` 里设 `STT_PROVIDER`（以及 `ELEVENLABS_MODEL` 或 `DEEPGRAM_LANGUAGES`）。

## 文件

```
src/
  index.ts         启动
  app.ts           /api 和前端网页
  routes.ts        11 个接口
  shapes.ts        回复的 zod schema，和 ../src/types.ts 绑定
  db.ts            SQLite（node:sqlite）
  files.ts         课堂文件（本地磁盘）
  http/upload.ts   流式接收上传，中断不留文件
  media.ts         ffprobe / ffmpeg
  pipeline.ts      录音 -> 笔记的队列
  stt/             转写服务：elevenlabs.ts、deepgram.ts、切句 lines.ts、对比打分 compare.ts
  notes/           DeepSeek：提示词 prompt.ts、调用 deepseek.ts、整理和校验 normalize.ts、繁简 zh.ts
  slides.ts        PDF 每页的文字
scripts/           invite、costs、compare-stt
test/              契约、上传、流程、整理、服务商请求、ffmpeg 和网页
```

数据在 `data/`（gitignore）：`sidenote.db`，以及 `lectures/<课堂 id>/` 下的原始录音、`audio.m4a`（转码后，用于转写和以后的回放）、`slides.pdf`、转写服务的原始返回。

## 第一阶段没做的

现场录音的分段上传（`record`、`tab` 现在回 501，请学生上传录音）、Catch me up、回放（`detail` 不带 `audio`）、编辑笔记、分享、学习进度、复习包、课程管理、搜索、课后补传课件（回 409）、会员和付款、设置保存。这些接口现在回 404 加说明，前端会照常显示或忽略。
