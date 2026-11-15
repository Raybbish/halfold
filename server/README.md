# Sidenote 后端（第一到四阶段）

把课堂录音（可带 PDF 课件）变成笔记，前端用 `USE_MOCK: false` 就能显示。录音可以上传，也可以在浏览器里现场录（实时逐字稿、考试提示、Catch me up）；写好笔记后可以回放。之后学生可以改笔记、补传课件、分享给同学、做整门课的复习包、搜索全部笔记。学生用邮箱验证码登录（第一次加邀请码），有免费和付费方案，用 Stripe 付款。设计和取舍见 [DESIGN.md](DESIGN.md)，接口约定见 `../reference/INTEGRATION.md` 和 `../API-CHANGES.md`。

需要 Node 22.12 以上和 `ffmpeg`（含 `ffprobe`）。

## 跑起来

```bash
cd server
npm install
cp .env.example .env      # 填 key 和 INVITE_CODES
npm start                 # http://localhost:8787
```

`npm start` 用同一个地址提供 `/api` 和构建好的前端（`../dist`），并替前端把 `USE_MOCK` 关掉、`API_BASE` 设成 `/api`、登录页换成邮箱模式。改了前端要先在仓库根目录 `npm run build`。用邮箱登录（第一次填 `.env` 里的一个邀请码），新建课程，上传一段录音或点 Record now 现场录，等笔记出现。没设 `RESEND_API_KEY` 时，登录码打印在 `npm start` 的终端里。

现场录音要用麦克风，浏览器只在 `localhost` 或 HTTPS 下给麦克风。用手机试要先配 HTTPS（比如反向代理），并设 `PUBLIC_URL`。

不想把 key 写进文件，也可以在启动时用环境变量给。

## 命令

| 命令 | 作用 |
|---|---|
| `npm start` / `npm run dev` | 启动；`dev` 改了代码会自动重启 |
| `npm test` | 类型检查和全部测试（转写服务和 DeepSeek 用假实现，不花钱） |
| `npm run invite -- add <code> [名字]` / `new` / `list` | 管理邀请码。一个码就是一个账号；邮箱第一次登录时用一次，绑定后用邮箱登录 |
| `npm run plan -- list` / `show <邮箱或邀请码>` / `give <邮箱或邀请码> <天数>` | 看每个学生的方案和本月用量；手动给几天 Plus（测试的人，或用 FPS、PayMe 转账的人），不经过 Stripe |
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
| `CATCHUP_MODEL` | `deepseek-flash` | Catch me up 用的模型，不开思考 |
| `PUBLIC_URL` | 空 | 前端和 API 不在同一个地址时，回放链接用这个地址开头 |

每天现场录音的分钟数和录音保留多久，现在按学生的方案定，在 `plans.json` 里（见下面“方案和付款”）。快用完时录音页会提醒，用完后停止保存，已保存的部分照常写笔记。

现场录音每小时的转写费是上传录音的 2.12 倍：录音时实时转写一次，结束后为了写笔记再整段转写一次（15 秒一段的准确度差一些，尤其是粤语，见 DESIGN.md）。`npm run costs` 会列出实测的倍数和 Catch me up 每次的成本。

## 分享的设置

学生点 Share 得到的链接是前端的 `#/s/<随机 id>`，地址按顺序取：`WEB_URL`；没设就用学生当时打开的页面的地址；再没有就用 `PUBLIC_URL`。前端放在某个路径下（如 `https://uni.example.com/sidenote/`）时要设 `WEB_URL`。

`EXAMPLE_SHARE_ID`：公开页面（首页、登录页）上 “Example notes” 打开的分享课堂，填分享链接最后那串 id。不设就不显示这个入口。

分享页不带录音（INTEGRATION.md 4.3），也不带学习进度。

## 登录

`SIGN_IN=email`（默认）：学生填邮箱，收到 6 位数的码（10 分钟有效），用码登录。邮箱第一次登录还要填一个邀请码，邮箱从此绑到这个码的账号上；以前只用邀请码的学生填原来的码，课都还在。一个码只能绑一个邮箱，新学生发新码（`npm run invite -- new`）。

| 设置 | 默认 | 作用 |
|---|---|---|
| `RESEND_API_KEY` | 空 | [Resend](https://resend.com) 的 key，用来发登录码。空着时码打印在服务器终端里，只适合自己电脑上试 |
| `MAIL_FROM` | `Sidenote <onboarding@resend.dev>` | 发件人。要用你在 Resend 验证过的域名；Resend 的测试发件人只能发到你自己注册 Resend 的邮箱 |
| `EMAIL_DOMAINS` | 空 | 只让这些后缀的邮箱登录，如 `connect.hku.hk,link.cuhk.edu.hk`（子域名也算）。空 = 任何邮箱 |
| `SESSION_DAYS` | 90 | 多少天不用就要重新登录 |
| `SIGN_IN` | `email` | `invite` = 回到只用邀请码登录 |

## 方案和付款

方案在 [`plans.json`](plans.json)，改了重启生效：

| | Free | Plus（HK$98 / 月，或 HK$348 买 120 天） |
|---|---|---|
| 每天现场录音 | 90 分钟 | 240 分钟 |
| 每月课堂（录的和上传的） | 4 | 40 |
| 每月复习包 | 1 | 不限 |
| 录音保留 | 30 天 | 一直保留 |

按月的 Plus 是 Stripe 订阅，自动续费，只能用卡、Apple Pay、Google Pay。120 天的是一次付清，不续费，还能用支付宝、微信支付。付费结束（取消、续费失败、到期）马上回到 Free，内容都在；付费期间的录音从那天起再留 30 天。第一次以这个版本启动之前录的课，从启动那天起算 30 天，不会马上删。

**接 Stripe（测试模式，不会扣真钱）**：

1. 在 [Stripe](https://dashboard.stripe.com) 注册，保持在 **Test mode**。
2. Developers → API keys，把 **Secret key**（`sk_test_` 开头）填进 `server/.env` 的 `STRIPE_SECRET_KEY`。`sk_live_` 开头的 key 会被拒绝。
3. Settings → Payment methods：打开 Alipay 和 WeChat Pay（学期通行证用）。
4. Settings → Billing → Customer portal：存一次设置（学生取消订阅、换卡的页面），允许取消订阅。
5. Webhook，二选一：
   - 自己电脑上：装 [Stripe CLI](https://docs.stripe.com/stripe-cli)，`stripe listen --forward-to localhost:8787/api/stripe/webhook`，把它打印的 `whsec_...` 填进 `STRIPE_WEBHOOK_SECRET`；
   - 有公网地址时：Developers → Webhooks 新建 `https://<你的服务器>/api/stripe/webhook`，事件选 `checkout.session.*` 和 `customer.subscription.*`，把 Signing secret 填进 `STRIPE_WEBHOOK_SECRET`。

   没配 webhook 时，第一次付款在学生回到设置页时也能生效（服务器会去问 Stripe），但取消和续费要靠 webhook。
6. 重启。测试卡号 `4242 4242 4242 4242`，任意未来日期和 CVC。

没设 `STRIPE_SECRET_KEY` 时，设置页照样显示方案，点 “Choose this plan” 提示 “Checkout is not connected yet.”。

## 最后一次端到端检查

一次走完第一到四阶段的所有功能。用真实的课堂录音（最好 5 到 10 分钟以上，粤语或普通话夹英文），手机和电脑各试一部分。每项后面是要的 key（`EL` = `ELEVENLABS_API_KEY`，`DS` = `DEEPSEEK_API_KEY`，`RS` = `RESEND_API_KEY`，`ST` = `STRIPE_SECRET_KEY` 和 `STRIPE_WEBHOOK_SECRET`）。开始前 `npm run costs` 记一下总数，结束后再看一次。

**准备**：仓库根目录 `npm run build`；`server/` 里 `npm start`；`npm run invite -- new` 生成两个邀请码；Stripe 按上面 1 到 6 步配好。

登录（第四阶段）

- [ ] 用邮箱登录：收到登录码邮件（`RS`；没有就看终端），新邮箱要填邀请码，名字可填。
- [ ] 用以前的邀请码绑邮箱：以前的课都在。
- [ ] 错码、过期码有提示；“Send a new code”“Use another email”能用。
- [ ] 第二个学生用另一个邀请码登录，看不到第一个学生的课。

上传和笔记（第一阶段，`EL` `DS`）

- [ ] 新建课程，上传录音和 PDF 课件，进度条走完，等到笔记出现；笔记的要点放在课件各页下面。
- [ ] 上传中途点 Cancel：课堂和文件都删掉。
- [ ] 打开中文解釋，繁／简切换。
- [ ] `npm run costs` 看这堂课的成本。

现场录音（第二阶段，`EL` `DS`）

- [ ] 在手机上 Record now（要 HTTPS 或 localhost）：实时逐字稿出现、考试提示弹出、Catch me up 有三句总结。
- [ ] 结束录音后笔记写好；对一堂没录完的课点“用已保存的部分写笔记”。
- [ ] 回放：点时间戳跳到那一秒，拖动、倍速、手机锁屏控制。

用已有的课（第三阶段，`DS`）

- [ ] 改标题、换课程、改删加要点、闪卡和测验的进度刷新后还在、反馈（`npm run feedback`）。
- [ ] 给一堂没课件的课补传课件。
- [ ] 分享：没登录的浏览器能打开，没有录音；第二个学生“存到我的课”；停止分享后旧链接 404。
- [ ] 复习包：做一个，出处能跳回那一秒。
- [ ] 搜索全部笔记。
- [ ] 改课程编号、删课程（连课一起删）。

设置、方案和付款（第四阶段，`ST`）

- [ ] 设置页改名字、上课语言、中文解釋默认、繁／简，刷新后还在。
- [ ] 方案卡片：Free 显示 “Your plan”，用量条是 90 分钟。
- [ ] Free 的限制：本月第 5 堂课、第 2 个复习包被拒绝，提示写着 Plus 和下个月 1 号。（省钱的试法：先把 `plans.json` 里 Free 的 `lecturesPerMonth` 临时改成 1 再重启，试完改回。）
- [ ] 买 Plus（按月）：测试卡付款，回到设置页是 Plus，“Renews on …”，用量条 240 分钟。
- [ ] 选 Free：去 Stripe 账单页面取消，回来显示 “Ends on …”。在 Stripe 后台把这个订阅立即取消：回到 Free，课都在，录音显示保留到 30 天后。
- [ ] 另一个学生买学期通行证，用支付宝或微信支付的测试付款：显示 “Paid until …”。
- [ ] `npm run plan -- list` 看到两个人的方案。

最后：`npm run costs` 看这次一共花了多少。

```
src/
  index.ts         启动
  app.ts           /api 和前端网页
  routes.ts        第一、二阶段的接口，和课后补传课件
  library.ts       第三阶段的接口：改标题和课程、编辑笔记、进度、反馈、分享、改删课程、复习包、搜索
  login.ts         登录：邮箱验证码，或只用邀请码（SIGN_IN）
  account.ts       第四阶段的接口：设置、方案、付款；Stripe 的 webhook
  billing.ts       学生现在是哪个方案、额度、方案卡片、Stripe 告诉我们的事
  plans.ts         读 plans.json
  pay/stripe.ts    Stripe 的请求和 webhook 签名
  mail.ts          发登录码（Resend）
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
scripts/           invite、plan、costs、compare-stt、feedback
plans.json         方案、价格和每个方案的限制
test/              契约、上传、流程、整理、服务商请求、ffmpeg 和网页；现场录音（模拟浏览器）、真实分段、回放；
                   编辑和课程、分享、复习包、搜索、补传课件；登录、方案和付款、设置、Stripe 和 Resend 的请求
test/fixtures/     Chrome 录下的真实分段（webm 和 MP4），见其中的 README
```

数据在 `data/`（gitignore）：`sidenote.db`，以及 `lectures/<课堂 id>/` 下的原始录音、`audio.m4a`（转码后，用于转写和回放）、`slides.pdf`、转写服务的原始返回；现场录音结束前，分段在 `chunks/` 里。

## 还没做的

- 视频链接（`attachLink` 回 501，请学生下载后上传）。
- FPS、PayMe 付款：Stripe 不支持，要另接 Airwallex 或 PayMe for Business。现在可以收转账后用 `npm run plan -- give` 手动开通。
- Google 登录、学校单点登录。
- 方案卡片的中文：后端不知道学生的界面语言。
- 服务器端的退出登录：前端的 Sign out 只清本机；token 90 天不用自动失效。
- 首页的本周统计（`week`）：学习进度和测验分数已经存了，但“本周”“已掌握的闪卡”“平均分”怎么算还没定，不给时前端不显示这一栏。
- 分享页的录音（4.3）：默认不带，要带是产品和合规上的决定。
- 搜索逐字稿和中文解释（API-CHANGES.md 第 4 节说以后再考虑）。
