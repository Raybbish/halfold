# 部署到一台服务器

一台 Ubuntu 24.04 的小 VPS（2 核 2G 就够，比如腾讯云轻量“锐驰型”，新加坡或香港）。Caddy 负责 HTTPS，systemd 负责开机自启和崩溃后重启，每天凌晨 4:30（香港时间）备份数据库和录音。所有命令都在自己电脑上的仓库里跑，`push.sh` 通过 ssh 去改服务器。

| 文件 | 作用 |
|---|---|
| `push.sh` | 在自己电脑上跑：把**已提交**的代码（HEAD）传到服务器 `/srv/halfold`，装依赖，重启 |
| `setup.sh` | 第一次时 `push.sh --setup` 在服务器上跑：装 ffmpeg、sqlite3、rclone、Caddy、Node 22、yt-dlp、deno；建用户 `halfold`、数据目录、设置文件，配好 Caddy |
| `activate.sh` | 每次部署时 `push.sh` 在服务器上跑：装 systemd 服务和 `halfold` 命令，重启，等服务器答应 |
| `Caddyfile` | HTTPS，所有请求转给 `127.0.0.1:8787` |
| `halfold.service` | 服务器进程：开机启动，崩溃 3 秒后重启，只听 `127.0.0.1` |
| `halfold-backup.service` / `.timer` / `backup.sh` | 每天的备份 |
| `backup.env.example` | 备份到 Cloudflare R2 的设置 |
| `halfold` | 服务器上的日常命令（看日志、改设置、发邀请码……） |

服务器上的位置：代码 `/srv/halfold`（每次部署整个换掉），数据 `/srv/halfold/server/data`（部署不碰），设置 `/etc/halfold/halfold.env`（就是你电脑上的 `server/.env`），备份 `/var/backups/halfold`。

## 第一次部署

**准备**

1. 一台 Ubuntu 24.04 的服务器，能用 `ssh ubuntu@<IP>` 登录，这个用户能 `sudo`。端口或密钥特殊的话写进自己电脑的 `~/.ssh/config`，或者跑 `push.sh` 时加 `SSH="ssh -p 2222"`。
2. 服务器的防火墙（腾讯云在控制台的“防火墙”页）放开 TCP 80 和 443。8787 不用开，服务器只听本机。
3. 一个域名，加一条 A 记录指向服务器 IP。**域名在 Cloudflare 的话，这条记录要关掉代理（灰色云朵）**：Cloudflare 免费版每个请求最多 100 MB，而学生上传录音最多 500 MB，走代理的话大文件会失败。
4. 代码已提交，`dist/` 是最新构建（`npm run build` 后提交）。`push.sh` 只传已提交的东西。

**部署**

```bash
deploy/server/push.sh ubuntu@<IP> --setup halfold.app
```

第一次要几分钟（装软件）。最后打印 `halfold: running <commit>` 就是服务器起来了。Caddy 第一次申请证书要 DNS 已经生效，没生效的话等生效后它会自己再试。

**填 key**

```bash
ssh ubuntu@<IP>
```

```bash
halfold env
```

打开的是 `server/.env.example` 的内容，`PUBLIC_URL` 和 `WEB_URL` 已经填成你的域名。要填的和本机一样（见 `server/README.md`）：`DEEPGRAM_API_KEY`（转写，默认用 Deepgram；`STT_PROVIDER=elevenlabs` 时填 `ELEVENLABS_API_KEY`）、`DEEPSEEK_API_KEY`；给别人用之前一定要填 `RESEND_API_KEY`，`MAIL_FROM` 换成在 Resend 验证过的域名（没填时登录码打印在日志里）；付款用 `STRIPE_SECRET_KEY` 和 `STRIPE_WEBHOOK_SECRET`，见下面的“收款”。存盘退出后自动重启。`HOST` 和 `PORT` 在这里写了也不生效，由 `halfold.service` 定。

然后发邀请码，打开 `https://<你的域名>` 登录：

```bash
halfold invite new
```

## 收款（Stripe）

方案都是一次付清（Stripe Checkout），不自动续费；退款在 Stripe 后台点，服务器按退回的比例扣掉天数（规则见 `server/README.md` 的“方案和付款”）。价格和天数在 `server/plans.json`，改了要提交再 `push.sh`。

先用测试模式（`sk_test_` 开头的 key，测试卡 `4242 4242 4242 4242`）在服务器上走一遍，再换成收真钱：

1. **Stripe 账户**：在 [dashboard.stripe.com](https://dashboard.stripe.com) 用香港的商户资料激活账户（Activate payments）：公司或个人的资料、负责人身份证明、收款的香港银行账户。“Public business name” 和 “Statement descriptor” 会出现在学生的收据和信用卡账单上，写 Halfold。
2. **支付方式**（2026-11-24 定的：卡、支付宝、微信支付）：关掉 Test mode，Settings → Payment methods，确认卡开着（Apple Pay 和 Google Pay 跟着卡），再打开 Alipay 和 WeChat Pay（要另外打开，有的要先审核，审核过了才会出现在付款页）。设置页的卡片上写着 “Pay once by card, Alipay or WeChat Pay”；以后去掉其中一种的话要改 `server/src/billing.ts` 里这句（和 `src/i18n/zh.ts` 的中文）。
3. **收据**：Settings → Customer emails，打开 Successful payments 和 Refunds，学生付款和退款后收到 Stripe 的邮件。
4. **Webhook**（正式模式下）：Developers → Webhooks → Add endpoint，地址 `https://<你的域名>/api/stripe/webhook`，事件选 `checkout.session.completed`、`checkout.session.async_payment_succeeded`、`checkout.session.async_payment_failed`、`checkout.session.expired`、`charge.refunded`、`charge.dispute.closed`。建好后复制 Signing secret（`whsec_` 开头；正式模式和测试模式的不一样）。
5. **Key**：Developers → API keys 的 Secret key（`sk_live_` 开头）。服务器只用它建、查、关 Checkout，所以也可以建一个只开 Checkout Sessions 权限的 Restricted key（`rk_live_` 开头），用测试模式的同样一个先试通。
6. 填进服务器，存盘后自动重启：

   ```bash
   halfold env
   ```

   ```
   STRIPE_SECRET_KEY=sk_live_...
   STRIPE_WEBHOOK_SECRET=whsec_...
   STRIPE_ALLOW_LIVE=on
   ```

   不设 `STRIPE_ALLOW_LIVE=on` 时 live key 会被拒绝，付款关掉，日志里说明原因。`halfold status` 的日志里应该是 `payments: Stripe LIVE`。
7. **验收**：自己买一个 Plus for a month（真卡，HK$98）。设置页显示 “Paid until …”，`halfold plan show <你的邮箱>` 也是；Stripe 后台 → Webhooks 里这个地址的事件都是 200。然后在 Payments 里找到这笔点 Refund（全额）：几秒后设置页回到 Free，`halfold logs` 里有一行 `[billing] refund: ...`。退款几天后回到卡上；Stripe 退款时不退手续费。

回到只收测试付款：`halfold env` 里换回 `sk_test_` 的 key 和测试模式的 `whsec_`，删掉 `STRIPE_ALLOW_LIVE`。

## 以后更新

改完代码，`npm run build`，提交，然后：

```bash
deploy/server/push.sh ubuntu@<IP>
```

`server/package-lock.json` 变了才重装依赖。重启时正在写的笔记会在重启后接着写；正在现场录音的学生会断开几秒，所以尽量别在上课时间更新。

## 服务器上的命令

先 `ssh ubuntu@<IP>`：

| 命令 | 作用 |
|---|---|
| `halfold status` | 在不在跑、哪个 commit、最近的日志 |
| `halfold logs` | 跟着看日志（Ctrl-C 退出） |
| `halfold restart` | 重启 |
| `halfold env` | 改设置和 key，存盘后重启 |
| `halfold invite new` / `add <code>` / `list` | 邀请码，同 `npm run invite` |
| `halfold plan list` / `show` / `give` | 方案和用量，同 `npm run plan`（`give` 也用来补回退款扣掉的天数） |
| `halfold costs` | 每堂课的成本，同 `npm run costs` |
| `halfold feedback` | 学生的反馈，同 `npm run feedback` |
| `halfold backup` | 马上备份一次，看结果 |

## 备份

每天 04:30（香港时间）：

1. 用 sqlite3 的 `.backup` 拷一份数据库（服务器不用停），检查完整性后压缩，放在 `/var/backups/halfold`，留最近 7 份。
2. 设好 R2 的话：这份数据库传到 R2 的 `db/`（留 30 天），录音目录同步到 R2 的 `lectures/`。同步是镜像：学生删掉的、过了保留期的录音，R2 上也删掉。

只有第 1 步的话，硬盘坏了或服务器被删就没了。**接 R2**（10 GB 以内免费）：

1. Cloudflare 后台 → R2 → 建一个 bucket，比如 `halfold-backup`。
2. 在 R2 页面的 API 令牌（API Tokens）处建一个令牌，权限选 Object Read & Write，只给这个 bucket。记下 Access Key ID、Secret Access Key 和账户 ID。
3. 在服务器上填进去：

   ```bash
   sudoedit /etc/halfold/backup.env
   ```

4. 试一次，最后一行应该是 `backup: database and lecture files -> R2 bucket ...`：

   ```bash
   halfold backup
   ```

另外，云服务商控制台的“快照”可以整台机器存一份，升级系统或大改之前点一下。

## 恢复

在服务器上。先停服务器，再换数据库；一定要删掉旧的 `-wal` 和 `-shm`，否则新数据库会被旧日志弄坏。先看有哪些备份：

```bash
sudo ls -l /var/backups/halfold
```

把下面的 `<文件名>` 换成要用的那份：

```bash
sudo systemctl stop halfold
sudo rm -f /srv/halfold/server/data/sidenote.db-wal /srv/halfold/server/data/sidenote.db-shm
sudo sh -c 'gunzip -c /var/backups/halfold/<文件名> > /srv/halfold/server/data/sidenote.db'
sudo chown halfold: /srv/halfold/server/data/sidenote.db
sudo systemctl start halfold
```

从 R2 恢复（换了一台新服务器）：先按“第一次部署”装好，`/etc/halfold/backup.env` 填好，然后：

```bash
sudo systemctl stop halfold
set -a; . /etc/halfold/backup.env; set +a
export RCLONE_CONFIG=/dev/null RCLONE_S3_PROVIDER=Cloudflare RCLONE_S3_ENDPOINT=https://$R2_ACCOUNT_ID.r2.cloudflarestorage.com RCLONE_S3_ACCESS_KEY_ID=$R2_ACCESS_KEY_ID RCLONE_S3_SECRET_ACCESS_KEY=$R2_SECRET_ACCESS_KEY
rclone lsf :s3:$R2_BUCKET/db/
```

上面列出的最新一个就是要用的数据库，替换 `<文件名>`（`sudo -E` 让 sudo 带上刚设的 R2 变量）：

```bash
sudo rm -f /srv/halfold/server/data/sidenote.db-wal /srv/halfold/server/data/sidenote.db-shm
rclone cat :s3:$R2_BUCKET/db/<文件名> | gunzip | sudo tee /srv/halfold/server/data/sidenote.db >/dev/null
sudo -E rclone copy :s3:$R2_BUCKET/lectures /srv/halfold/server/data/lectures
sudo chown -R halfold: /srv/halfold/server/data
sudo systemctl start halfold
```

## 把自己电脑上的数据搬上去

先停掉本机的服务器（这样数据库是完整的），然后在仓库根目录：

```bash
rsync -az server/data/sidenote.db server/data/lectures ubuntu@<IP>:/tmp/halfold-data/
```

```bash
ssh -t ubuntu@<IP> 'D=/srv/halfold/server/data && sudo systemctl stop halfold && sudo rm -f $D/sidenote.db-wal $D/sidenote.db-shm && sudo rsync -a /tmp/halfold-data/ $D/ && sudo chown -R halfold: $D && rm -rf /tmp/halfold-data && sudo systemctl start halfold'
```

本机 `server/.env` 里的 `INVITE_CODES` 和 key 要另外用 `halfold env` 填，`PUBLIC_URL` 保持服务器上的域名。

## 说明

- **只能从 Caddy 进来**：`halfold.service` 设了 `HOST=127.0.0.1`，8787 端口从外面连不上。
- **磁盘**：回放录音每小时 21.5 MB，90 分钟的课约 32 MB。Plus 的录音一直保留，`df -h /` 看剩多少。快满了的话，加一块数据盘挂到 `/srv/halfold/server/data`，或者把录音改存 R2（`server/src/files.ts` 留好了换存储的接口）。
- **yt-dlp** 每天自动更新（`/etc/cron.daily/yt-dlp-update`）。YouTube 常挡数据中心的 IP，所以在服务器上贴 YouTube 链接比在自己电脑上更容易失败；学生会看到原因，可以下载后上传。
- **系统更新**：Ubuntu 默认自动装安全更新。偶尔 `sudo apt upgrade` 并重启机器，服务器和 Caddy 会自己起来。
