# Sidenote 真机走查包

迁移验收第 5 项用：在真的 iPhone 和 Android 手机上，把原文件和新工程各走一遍，记下差异。原文件在真机上也没测过，所以两边都要测。

## 包里有什么

| 文件 | 内容 |
|---|---|
| `old/index.html` | 原文件 `sidenote.html` |
| `new/` | 新工程的构建产物（`dist/`） |
| `Caddyfile` | 两个 HTTPS 站点：旧版一个域名，新版一个域名 |
| `VERSION.txt` | 打包时间、提交号、模式（示例数据还是真后端）、每个文件的校验值 |

## 为什么是两个 HTTPS 域名

- 手机浏览器只在 HTTPS 页面上允许用麦克风。用电脑的局域网 IP 加 http 打开，录不了音。
- 两个版本放在同一个域名下，会共用 `sidenote.*` 的 localStorage 和 IndexedDB 库，未完成录音的记录会互相干扰。

## 部署

1. 准备一台有公网 IP 的服务器，装好 Caddy 2。
2. 把两个子域名（例如 `old.<你的域名>`、`new.<你的域名>`）的 DNS 指到这台服务器，放开 80 和 443 端口。
3. 在开发机上生成走查包，填入这两个域名：

   ```bash
   npm run walkthrough -- --old=old.<你的域名> --new=new.<你的域名>
   ```

   有后端时加上后端地址，两个版本会一起切到真后端（`USE_MOCK: false`），`/api/` 开头的请求转给它：

   ```bash
   npm run walkthrough -- --old=old.<你的域名> --new=new.<你的域名> --api=127.0.0.1:8000
   ```

4. 把 `deploy/walkthrough/out/sidenote-walkthrough.tar.gz` 传到服务器，解压到 `/srv`（或者生成时用 `--root=` 指定别的目录）：

   ```bash
   sudo tar -xzf sidenote-walkthrough.tar.gz -C /srv
   ```

5. 启动：

   ```bash
   sudo caddy run --config /srv/sidenote-walkthrough/Caddyfile
   ```

   服务器上已经有 Caddy 在跑的话，把这份 Caddyfile 里的两个站点块并进现有配置，再 `caddy reload`。

6. 用电脑浏览器先打开两个地址，确认都能打开、证书正常。

后端如果不是挂在 `/api` 下面（收到的是 `/home` 而不是 `/api/home`），把 Caddyfile 里的 `reverse_proxy /api/* …` 换成 `handle_path /api/* { reverse_proxy … }`。

没有服务器和域名的话，也可以用 HTTPS 隧道服务（例如 Cloudflare Tunnel）把本机的两个静态目录暴露出去。这会让外网能访问你的电脑，用不用由你决定。

## 示例数据和真后端的区别

| | 示例数据（不加 `--api`） | 真后端（加 `--api`） |
|---|---|---|
| 登录 | 任何非空邀请码 | 真邀请码 |
| 麦克风 | 真的在录 | 真的在录 |
| 上传分段 | 交给假的上传函数，不离开手机 | 真的上传，断网时排队、恢复后补发 |
| 结束后的笔记 | 示例课堂的笔记 | 后端生成的笔记 |
| 回放 | 模拟播放，没有声音 | 播放真实录音 |

只有示例数据时，断网、补发和回放这几步看不出真实效果，记录时注明“示例模式”。

## 走查步骤

每台设备、每个版本各一次，每次约 7 分钟：iPhone 用 Safari，Android 用 Chrome。两个版本在不同域名下，互不影响，中间不用清数据。

| 时间 | 操作 | 观察并记录 |
|---|---|---|
| 0:00 | 登录，点“New lecture”，选一门课，开始录音（第一次会弹“Before you record”，点“Start recording”） | 是否要求麦克风权限；计时开始；音量条有动静 |
| 1:00 | 锁屏 30 秒，再解锁回到页面 | 回来后的计时（iPhone 上应停住不走）；是否出现“Recording stopped for about … seconds”；音量条是否恢复 |
| 2:00 | 切到别的 App 30 秒，再切回来 | 同上；屏幕是否保持常亮 |
| 3:00 | 开飞行模式（确认 Wi-Fi 也断了）30 秒，再关掉 | 顶部的离线提示条；录音页的“Connection”提示；恢复后提示消失，积压的分段补发 |
| 5:00 | 点“End and make notes” | 是否误报“Waiting for a connection”；是否跳到笔记页 |
| 结束后 | 在笔记页点一个时间戳，再按播放 | 定位到逐字稿那一行；播放、倍速、前进后退；锁屏界面上的播放控制 |

## 记录

把结果填回仓库里 `DIFFERENCES.md` 第 4 节的表格。两个版本表现不一样的地方，单独写一行说明。

| 设备和浏览器 | 版本 | 计时 | 锁屏 | 切 App | 断网 | 结束 | 回放 | 其他 |
|---|---|---|---|---|---|---|---|---|
| iPhone，Safari | 原文件 | | | | | | | |
| iPhone，Safari | 新工程 | | | | | | | |
| Android，Chrome | 原文件 | | | | | | | |
| Android，Chrome | 新工程 | | | | | | | |
