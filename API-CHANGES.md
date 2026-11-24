# 后端接口变更

`reference/INTEGRATION.md` 是迁移时冻结的对接文档。这里记录迁移之后前端新增的接口，以及已有接口的新用法，给写后端的人看。约定和原文档一样：

- 路径只是建议；
- 带 token 的接口返回 401 会让用户重新登录；
- 出错时返回 `{ "message": "..." }`，这句话会直接显示给用户；
- 标“无”的接口，返回 204 或 200 加空 body 都可以。

## 1. 改课程、删课程、把课堂移到别的课程

新增三个 `api` 函数，在 `src/api/api.ts`：

| `api` 函数 | 建议的请求 | 返回 |
|---|---|---|
| `updateCourse(id, code, name)` | `PATCH /courses/:id`，body `{ code, name }` | 无 |
| `deleteCourse(id)` | `DELETE /courses/:id` | 无 |
| `moveLecture(id, courseId)` | `PATCH /lectures/:id`，body `{ course }` | 无 |

前端在请求成功后直接更新页面，不重新请求 `GET /home`。

### `updateCourse`：改课程编号和名称

- 入口：课程页的 “Edit course”。
- 限制和新增课程（`addCourse`）一样：
  - `code` 必填，最长 20 个字；
  - `name` 最长 80 个字，可以是空字符串，表示没有课程名。
- 课程的 `id` 不变。
- 之后 `GET /home` 里 `upcoming[].course` 显示的是课程编号，要换成新编号。
- 如果不允许两门课用同一个编号，请返回 409 加 `message`。前端会显示这句话，课程保持原样。

### `deleteCourse`：删除课程

- 入口：“Edit course” 弹窗里的 “Delete course”。
- 课程里的所有课堂一起删掉。每堂课按 `deleteLecture` 的要求处理，录音文件、笔记和分享链接都要删。
- 这门课的期末复习包也要删掉。
- 删除前，确认框会告诉用户课程里有几堂课会一起删除，而且无法复原。课程里没有课堂时，确认框会说明这一点。
- 如果这门课里有一堂课正在录音，前端会提示先结束录音，不发这个请求。后端也可以拒绝，返回 409 加 `message`。

### `moveLecture`：把课堂移到别的课程

- 入口：讲座页 “More” 菜单里的 “Move to another course”。用户只有一门课时不显示。
- 用的是改标题那个 `PATCH /lectures/:id`，但 body 里只带 `course`（改标题时只带 `title`），请两种都支持。
- `course` 必须是同一个用户的课程，否则返回 403 或 404 加 `message`。
- 课堂的 `id`、分享链接、学习进度和录音都不变。
- `GET /home` 里这堂课的 `upcoming[].course` 要换成新课程的编号。
- 两门课的期末复习包会过时：已经生成的复习包里还留着这堂课在原来位置的内容。前端移动之后会重新请求两门课的 `GET /courses/:id/review-pack`，建议后端把这两个复习包的状态改回 `none`（让学生重新生成），或者自动重新生成。

## 2. 上传录音的进度和取消

- 接口没有变：`uploadRecording` 和 `uploadSlides` 仍是 `POST /lectures/:id/recording` 和 `POST /lectures/:id/slides`（multipart，字段名 `file`）。
- 前端改用 XMLHttpRequest 发送，以便显示进度。
- 用户点 “Cancel upload” 时：
  1. 前端中止请求；
  2. 然后调用 `DELETE /lectures/:id`，删掉刚建好的那堂课。

后端需要：

- 丢弃中途断开的上传，不留下不完整的文件；
- 允许删除一堂还在接收上传、或刚建好还没有内容的课；
- 文件太大时返回 413 加 `message`，前端会直接显示这句话。

## 3. 课后补传课件

接口路径不变，仍是 `uploadSlides(id, file)`：`POST /lectures/:id/slides`（multipart，字段名 `file`，PDF）。

新的用法：笔记已经生成、但没有课件的课，学生可以之后再传课件。老师常常下课后才放出课件；录音时课件没传上去也是这种情况。入口有两个：

- 讲座页 “More” 菜单里的 “Add slides”；
- 笔记最下面的 “No slides for this lecture yet. Add slides”。

两个入口都只在 `detail.slides` 为空时出现。

前端的流程：

1. 上传 PDF，有进度条，可以取消。取消只中止上传，不删除这堂课。
2. 上传成功后窗口就关掉，在后台轮询 `GET /lectures/:id/status`，直到不再是 `processing`（第 12 节）。轮询间隔是 `POLL_MS`，最多 200 次。这期间笔记照常显示，课堂页顶部有一条提示；刷新页面后，课堂是 `processing` 而且已经有笔记，就接着轮询。
3. 重新读取 `GET /lectures/:id`：
   - `detail.slides` 不为空：提示已加入；
   - 仍然为空：提示未能加入、笔记维持原样；
   - 轮询到上限还是 `processing`：提示仍在处理，学生之后再打开这堂课就能看到结果。

后端需要：

- **笔记已生成后也接收课件。** 以前只在课堂刚建好、生成笔记之前收。
- **在这个请求返回之前，就把状态设为 `processing`。** 否则前端第一次轮询拿到 `ready`，会以为已经处理完。
- **把已有的要点归到课件页下：**
  - 给每个要点填 `slide`，并判断 `off`（老师讲了但课件上没有）；
  - 给每个 section 填 `slides`（例如 `"Slides 3 to 6"`；页码不连续时逐个列出，见第 13 节）；
  - 返回 `detail.slides`。
- **不要重写笔记。** 要点的文字和顺序、学生改过的内容、学生自己加的要点（`mine: true`）都保持原样。前端在等待时会告诉学生“你自己加的笔记和修改都会保留”。
- **处理失败时，不要把课堂状态改成 `failed`。** 那会让讲座页显示“笔记未能完成”，原来的笔记反而看不到。请把状态改回 `ready`，笔记保持原样、`slides` 仍为空，前端据此提示失败。
- **文件太大时返回 413 加 `message`。** 前端会直接显示这句话。

## 4. 搜索全部笔记

新增一个 `api` 函数：

| `api` 函数 | 建议的请求 | 返回 |
|---|---|---|
| `searchNotes(q)` | `GET /search?q=<查询>` | `{ results: [{ lecture, text, t }] }` |

- `lecture`：课堂的 `id`；
- `text`：要点的原文；
- `t`：要点的时间（秒），学生自己加的要点为 `null`。

入口是首页的搜索框（“Search course, title or notes”）。以前它只在浏览器里比对，课程编号、课程名和标题都搜得到，笔记却只搜得到这次打开过的课。现在：

1. 标题、课程编号和课程名还是在浏览器里比对，即打即出。
2. 输入满 2 个字、停顿 0.3 秒后，请求 `GET /search`。
   - `q` 已经去掉首尾空格、多个空格并成一个、转成小写；
   - 一次停顿只发一次请求；
   - 回复到之前框里的字又变了，就丢掉这次回复。
3. 课堂列表里加上笔记里有匹配的课。列表下面多一块 “Found in the notes”，逐条列出匹配的要点，查询的词会高亮。
4. 点一条结果，打开那堂课，并标出那条要点、滚到它的位置。播放位置跳到这条要点的时间。前端先找原文相同的要点，找不到再找时间相同的。

后端需要：

- **搜这个用户所有课堂的笔记要点。**
  - 学生改过的要点，按改过之后的文字搜；
  - 学生自己加的要点（`mine: true`）也要搜到；
  - 已经删掉的课和要点，不要再返回。
- **不区分大小写。** 多个词时，建议每个词都要出现，不必相连，顺序不限。示例模式就是这样搜的。
- **最多返回 20 条，新的课排在前面。** 前端最多显示 20 条。`lecture` 不在 `GET /home` 课堂列表里的结果，前端会略过。
- **没有匹配时，返回 `{ "results": [] }`。**
- **还没有这个接口时，返回 404（或 405、501）。** 前端会在这次访问里不再请求这个接口，搜索框照旧只在浏览器里搜，也不显示错误。其他错误码会显示“暂时无法搜索笔记，请稍后再试”，课堂列表照常可用。

之后可以考虑：搜逐字稿，以及搜中文解释（`zhHant`、`zhHans`）。这两项现在都不搜。

## 5. INTEGRATION.md 第 9 节“还没做的”现在的情况

| 项目 | 情况 |
|---|---|
| 上传录音的进度条和取消 | 已做（第 2 节）。断点续传还没做 |
| 课程改名或删除、课堂换到别的课程 | 已做（第 1 节） |
| 邮箱或学校账号登录 | 没做 |
| 搜索全部笔记（需要搜索接口） | 已做（第 4 节），后端第三阶段已加上接口（第 7 节） |
| 录音时课件上传失败，之后补传 | 已做（第 3 节），没交课件的课也可以补 |
| 付款完成后的回跳和结果提示 | 没做 |

## 6. 后端第二阶段：录音和回放的实际行为

后端第二阶段（`server/`，见 `server/DESIGN.md`）做了现场录音、Catch me up 和回放。下面是和 `reference/INTEGRATION.md` 写法不完全一样、或者原文没说清楚的地方。前端不用改也能用；个别地方给了建议。

### `uploadChunk`：410 不只表示“课堂不存在”

`POST /lectures/:id/chunks` 在这几种情况回 410 加 `message`：

| 情况 | `message` |
|---|---|
| 今天的现场录音分钟数用完了 | Today's recording minutes are used up, so Sidenote has stopped saving this recording. End it to get notes for what was saved. |
| 这堂课收到的音频超过 `MAX_UPLOAD_MB` | This recording has reached 500 MB, so Sidenote has stopped saving it. ... |
| 这堂课已经结束（调过 `finishLecture`），这一段之前没收到过 | This recording has ended, so this piece of audio was not added. |

- 前端现在的处理正合适：丢掉这堂课剩下的分段，结束录音时照常调 `finishLecture`，用已保存的部分写笔记。
- 不用 429：前端会把那一段留在队列里一直重试，结束录音时会卡在 “Waiting for a connection”。
- 已经收到过的那一段再发一次，任何状态下都回 200。
- 课堂不存在仍是 404。

**建议**：前端目前不显示 410 的 `message`。如果正在录的这堂课收到 410，可以把 `message` 显示在录音页上（和 “Connection” 提示同一个位置）。

### `uploadChunk` 回复里的 `alerts` 可能不是考试提示

快用完当天的分钟数时，后端在分段回复的 `alerts` 里放一条 `kind: "Recording"` 的提醒，录音页会像考试提示一样弹出（`Recording` 有中文翻译）：

- 剩约 5 分钟时：`About 4 recording minutes are left today. Sidenote stops saving this recording when they run out; end it then to get notes for what was saved.`
- 用完时（这一段还会保存）：上表第一行那句话。

这两条只出现在录音页，不会进笔记和首页的考试雷达。

### `uploadChunk` 的其他细节

- 同一个 `seq` 发两次只存一次，回复和第一次一样（第一次的回复丢了也不会漏字）。
- 分段可以乱序到达。缺了中间某段时，实时逐字稿等它到了再往后走；写笔记时缺的那段当静音，后面的时间不变。
- 一段最大 `MAX_CHUNK_MB`（默认 10 MB），超过回 413。Chrome 录 MP4 时不管 `AUDIO_KBPS`，实测约 105 kbps。
- 回复最多等实时转写 8 秒，转写比较慢时这次回空数组，字随下一次回复一起来（INTEGRATION.md 第 5 节）。

### `createLecture`：429 也算上正在录的课

当天的分钟数包括正在录的课已经收到的音频。一台设备在录时，另一台设备开始录音会按已经用掉的分钟数判断。`GET /home` 的 `usage.minutesToday` 也一样。

### `finishLecture`

现场录音的课一段音频都没收到（或者缺了第一段，第一段带文件头）时回 409：`Sidenote did not receive any audio for this lecture. Delete it and record again.`

### `catchUp`

| 情况 | 回复 |
|---|---|
| 还没有可以总结的内容 | 200，`{ points: ["Nothing has been said yet that Sid can sum up. Try again in a minute."] }` |
| 模型出错 | 502，`Sid could not sum up the last few minutes just now. Try again in a moment.` |
| 后端关掉了实时转写（`LIVE_TRANSCRIPT=off`） | 501，`Catch me up is not available right now. ...` |
| 不是现场录音的课 | 409 |

前端会把 `message` 显示成提示，录音不受影响。

### `detail.audio`

- `url` 默认是相对路径 `/api/lectures/:id/audio?exp=…&sig=…`，前端和 API 在同一个地址时直接能用；后端设了 `PUBLIC_URL` 时是完整地址。
- 链接 12 小时有效，过期或被改动回 403；前端播放出错时重新调 `getLecture`（4.2 第 3 条）就拿到新链接。
- 支持 Range（206）。
- `keptUntil` 和 `expired` 只在后端设了 `AUDIO_KEEP_DAYS` 时出现，默认全部保留，两个都不给（4.4）。设了的话，`GET /home` 的 `usage.audioDays` 也会给。

### 还没有的

- `attachLink`（`POST /lectures/:id/link`）和 `createLecture` 的 `source: "link"` 仍回 501 加说明。
- 分享页不带录音（`SHARE_AUDIO` 保持 `false`）。分享在后端第三阶段做了，见第 7 节。

## 7. 后端第三阶段：改笔记、分享、课程、复习包、搜索的实际行为

后端第三阶段（`server/`，见 `server/DESIGN.md`）做了第 1、3、4 节和 INTEGRATION.md 第 2 节里剩下的学生操作。前端不用改；下面是原文没说清楚、或者后端的具体做法。

### `renameLecture`、`moveLecture`

- 同一个 `PATCH /lectures/:id`，`{title}` 和 `{course}` 都支持，一起给也行。标题 1 到 200 字。
- `course` 不是这个学生的课程：404，`That course does not exist.`
- 两门课的复习包都会变回 `none`（见下面的复习包）。

### `updatePoint`、`addPoint`、`deletePoint`

- 只改文字；时间、页码、`off`、中文解释不变。
- `addPoint` 加在这一节的最后，回 `{ t: null, text, mine: true, off: false, slide: null }`。
- 一节的要点删光了，这一节仍然留着（`points: []`），和前端删完后的样子一致，后面各节的序号不变。
- 找不到这个要点：404，`This note is no longer there. Open the lecture again to see the latest notes.`
- 笔记还没写好：409。补传课件正在处理时：409，`Sid is putting the notes under the slides. Try again in a minute.`
- 文字最长 2000 字（前端限 600）。

### `saveProgress`

- `detail.progress.known` 就是存进去的数组（去重、从小到大）。
- `quizScore` 为 `null` 时保留上一次的分数。

### `createShareLink`、`revokeShareLink`、`getShared`、`saveShared`

- 链接的地址：后端设了 `WEB_URL` 就用它，否则用学生点 Share 时页面的地址（请求的 `Origin` 头）。前端放在某个路径下时后端要设 `WEB_URL`。
- 笔记还没写好的课不能分享：409。
- `getShared` 回的 `lecture.id` 是分享 id（就是路由里的那个），不是课堂自己的 id；`lecture.status` 总是 `ready`；`detail` 不带 `audio` 和 `progress`。分享者没有名字时 `sharedBy` 是 `A classmate`。链接无效：404，`This link is no longer shared.`
- `saveShared`：
  - 放进读者名下编号相同的课程（不分大小写和空格），没有就新建一门（编号和名称照分享者的）；
  - 副本带笔记和带日期的提示，不带录音和进度，日期是原来上课的那天；
  - 同一份存第二次，回第一次那份副本；
  - 分享者存自己分享的课，回原课堂，不复制。

**前端已改**：`stopSharing` 原来按课堂 id 删 `S.shared`，但它是按链接里的分享 id 存的，接上后端后两者不同：同一次访问里先预览过分享页、再停止分享，旧链接还会显示存下的内容。现在按 `shareUrl` 末尾的分享 id 删（`tests/sharing.js`）。

**前端已改**：“You” 原来按 `t == null` 标，分享者自己加的要点在分享页和读者的副本里也会标成 “You”。现在只在自己的课（`!cur.shared`）里、`mine` 为真的要点上标；其他没有时间的要点那一格留空，文字照样对齐（`tests/sharing.js`）。后端要继续给学生自己加的要点带 `mine: true`。

### `updateCourse`、`deleteCourse`

- 允许两门课用同一个编号（`addCourse` 也允许），所以 `updateCourse` 不回 409。
- `deleteCourse`：课程里有一堂现场录音在 2 分钟内还收到过分段时回 409，`A lecture in this course is being recorded. End the recording, then delete the course.` 页面早就关掉、没录完的课不拦。

### `makeReviewPack`、`getReviewPack`

- `POST` 回 `{ status: "processing" }`。课程里还没有一堂有笔记的课时直接做好一个空的复习包（回 `{ status: "ready" }`，`GET` 得到三个空数组，前端显示 “Nothing to revise yet”）。正在做时再 `POST` 不会重做。
- `sheet` 的每一条都是笔记里的原文（学生改过的就是改过的），`lecture` 是课堂现在的标题。`exam` 是模型新出的综合题，每题带出处 `lectureId` 和 `t`。
- 课程里有笔记的课堂变了（新课写好、移进移出、删掉），`GET` 回 `none`，学生可以再做一次。前端在 `ready` 之后不显示“重新做”，所以用 `none` 表示过时。只改笔记文字不算过时。
- 做失败时，下一次 `GET` 回 502，`Sid could not make the review pack just now. Try again in a moment.`，之后回 `none`。前端正在轮询，会把这句话显示出来，页面回到 “Make review pack”。
- 一门两堂课的实测：约 1 分钟，0.013 美元。

### `searchNotes`

和第 4 节一致：按空白分词，每个词都要出现（不分大小写、不限顺序），新的课在前，同一堂课按笔记顺序，最多 20 条；改过的要点按新文字；学生自己加的也搜（`t: null`）；`q` 为空回 `{ results: [] }`。

### `uploadSlides`（课后补传，第 3 节）

- 回复之前状态已经是 `processing`。处理期间 `GET /lectures/:id` 照常回原来的笔记（`detail` 不是 `null`），所以学生这时打开课堂页能看到笔记，列表里显示 “Writing notes”。
- 已经有课件的课再传：409，`This lecture already has slides.`
- 失败（课件读不出、扫描件没有文字、模型给不出能用的结果）时按第 3 节：状态回 `ready`，笔记原样，`slides` 为空，可以再传一次。
- 一堂课的实测：约 1 分钟，0.007 美元。

### 还没有的

- `getPlans`、`startCheckout`、`updateSettings`：第四阶段做了，见第 8 节。
- `GET /home` 的 `week` 仍不给（进度已经存了，算法待定）。

## 8. 后端第四阶段：邮箱登录、方案和付款、保存设置

这一节有一处前端改动（登录页），其余都是现有接口的实际行为。

### 登录：邮箱验证码（前端有改动）

后端默认 `SIGN_IN=email`：学生填邮箱，收到 6 位数的码，用码登录。邮箱第一次登录还要填一个邀请码，邮箱从此绑定到这个邀请码的账号。第一到三阶段的老用户填一次原来的邀请码，课都还在。一个邀请码只能绑一个邮箱。

前端为此新增：

| 位置 | 改动 |
|---|---|
| `src/config.ts` | `CONFIG.SIGN_IN`：`"invite"`（默认，和 sidenote.html 一样的邀请码页）或 `"email"`。后端提供前端网页时把它设成 `"email"`（`window.SIDENOTE_CONFIG`），所以示例模式和已有的测试都不受影响 |
| `src/api/api.ts` | `sendCode(email)` → `POST /session/code`（公开），body `{ email }`，回 204。`signInWithCode(email, code, name, inviteCode)` → `POST /session`（公开），body `{ email, code, name, inviteCode }`，回 `{ token, user }` |
| `src/pages/SignIn.tsx` | `SIGN_IN` 为 `"email"` 时：先填邮箱（Send code），再填码（Sign in）。服务器回 403 时多出邀请码和名字两栏，已经填的码保留。还有 “Use another email” 和 “Send a new code” |
| `src/state/app.ts`、`src/i18n/zh.ts` | 登录表单的状态；新文字的中文，以及服务器登录报错的中文 |
| `tests/signin.js` | 13 项检查，`npm test` 在构建上跑 |

`signIn(inviteCode, name)` 和邀请码页都还在，`SIGN_IN=invite` 时用。

后端的回复：

- `POST /session/code`：邮箱格式不对 400；设了 `EMAIL_DOMAINS` 而邮箱不在其中 400；同一邮箱一分钟内再要 429（`A code was sent to this address less than a minute ago. ...`），一小时内超过 5 次 429；所有邮箱一小时内合计超过 `LOGIN_CODES_PER_HOUR` 429；发信失败 502。
- `POST /session`：码不是 6 位数 400；码错 401（`That code is not right. ...`），错 5 次码作废；码过期（默认 10 分钟）401。码对但邮箱是新的、又没给邀请码：403（`This email is new to Sidenote. Enter your invite code ...`），码仍然有效，前端带上邀请码再发一次即可。邀请码无效 403；邀请码已经绑了别的邮箱 403。
- 旧页面只发 `{ inviteCode, name }` 时回 400，提示刷新页面。
- 登录 90 天不用（`SESSION_DAYS`）就失效，回 401，前端按原规则跳到登录页。

### `getPlans`

`{ plans, current }`，形状同 INTEGRATION.md 3.4。方案在 `server/plans.json`，现在是三张卡片：

| `id` | `name` | `priceText` |
|---|---|---|
| `free` | Free | Free |
| `plus` | Plus | HK$98 / month（按月订阅，自动续费） |
| `plus-semester` | Plus for a semester | HK$348 for 120 days（一次付清，不续费） |

- `features` 是这个方案每天能现场录几分钟、每月几堂课、每月几个复习包、录音保留多久，加一句怎么付款。当前方案的第一条是 `Renews on 14 Dec 2026`、`Ends on 14 Dec 2026`（已取消、到期结束）或 `Paid until 14 Mar 2027`。
- 文字只有英文：界面语言只在浏览器里，后端不知道（INTEGRATION.md 3.4）。

### `startCheckout`

回 `{ url }`，前端跳过去：

- 付费方案：Stripe Checkout 页面。付完或取消都回到 `<前端地址>/#/settings`，地址的取法和分享链接一样（`WEB_URL` > 页面的 `Origin` > `PUBLIC_URL`）。
- 按月订阅中选 `free`：Stripe 的账单页面，在那里取消（用到这个月底）或换卡。上一次续费没扣成功时，选 `plus` 也去账单页面换卡。
- 服务器没设 Stripe：`{ url: null }`，前端提示 “Checkout is not connected yet.”。
- 409（带说明）：选的就是现在的方案；学期通行证没到期时选 `free` 或 `plus`；按月订阅中选 `plus-semester`。
- 方案不存在 404；Stripe 出错 502。

每次 `startCheckout` 都会关掉这个学生之前还没付的 Checkout，旧标签页里的付款页会显示已过期，不会重复订阅。

付完回到设置页时，即使 Stripe 的通知（webhook）还没到，`GET /home` 和 `GET /plans` 也会先问 Stripe 这笔付款，所以页面上马上是新方案。

### 方案的限制

| | Free | Plus |
|---|---|---|
| 每天现场录音 | 90 分钟 | 240 分钟 |
| 每月课堂（录的和上传的都算） | 4 | 40 |
| 每月复习包 | 1 | 不限 |
| 录音保留 | 30 天 | 一直保留 |

- `GET /home` 的 `usage.minutesLimit` 和 `usage.audioDays` 跟着方案变（Plus 不给 `audioDays`）。`usage.lecturesThisMonth` 和 `usage.lecturesLimit` 是本月已算的课堂数和方案的上限，方案不限课堂数时两个都不给（第 11 节）。
- `createLecture` 超出每月课堂数：429，`You have used the 4 lectures that Free includes this month. Choose Plus in Settings for more lectures, or wait until 1 Dec.`。还在录或在上传的课也算；笔记写好以后删掉的课仍然算；笔记写好之前删掉的不算；失败的课不算（重试时又算上）；`saveShared` 存的副本不算。
- `makeReviewPack` 超出每月复习包数：429，说明类似。正在做时再点不算；课程里还没有笔记（空复习包）不算。
- 前端遇到这两个 429（或 402）时弹一个窗口：标题 “You have reached the limit of your plan”，下面是这句话、本月已用几堂课，按钮 “See the plans” 去设置页（`src/ui/limit.tsx`，第 11 节）。新建课堂页、首页一键录音、复习包页都一样。
- 每天现场录音的分钟数照第 6 节的规则，只是上限按方案。
- 付费到期、取消或续费失败：马上回到 Free，笔记、闪卡、测验、分享都在。录音按 Free 的 30 天算，但从付费结束那天算起，所以前端会照 INTEGRATION.md 4.4 显示 “Recording kept until …”。开启方案之前录的课，从开启那天算起，不会一上线就被删。

### `updateSettings`

- `name` 必填，最长 60 字；`classLanguage` 是 `en`、`en-yue`、`en-zh`、`auto` 之一；`zhDefault` 是布尔值；`zhScript` 是 `hant` 或 `hans`，不给就保留原来的。不对回 400 加说明，成功回 204。
- 存好之后 `GET /home` 的 `user.name` 和 `settings` 就是新的。


## 9. 视频链接（`source: "link"`）

后端装了 yt-dlp 时，贴链接的课堂和上传录音一样会写出笔记。设计见 `server/DESIGN.md` 的“视频链接（公开链接）”一节。

### 流程（前端不用改）

1. `createLecture({ source: "link", ... })`：正常建课。和上传一样算每月课堂数，不算每天现场录音分钟。服务器上没有 yt-dlp 时仍回 501，文案不变。
2. `attachLink(id, url)`：`POST /lectures/:id/link`，body `{ url }`，成功回 204。
   - 只收来源是 `link`、状态是 `recording` 的课；上传课、已经开始写笔记的课回 409。
   - 链接不对回 400，`message` 可以直接显示：`Paste the full link, starting with https://`、`Only public links can be opened. This one points to a private network.` 等。
   - 再发一次就覆盖原来的链接。
3. `finishLecture`：照常调用。还没发链接就 finish 回 409（`Paste the link to the lecture video first.`）。之后状态是 `processing`，下载、转写、写笔记都在后台，前端照常轮询 `getStatus`。下载一般几十秒到几分钟。

### 新字段

- `lecture.link`（`GET /home`、`GET /lectures/:id`）：学生贴的链接，可以用来显示“打开原视频”。
- `lecture.error`：课堂是 `failed` 并且后端知道原因时，给一句可以直接显示的英文，目前只有链接下载失败时才有。可能的原因：
  - 要登录或要权限才能看；
  - 网站（多半是 YouTube）暂时拒绝下载；
  - 超过 5 小时，或者是直播；
  - 超过上传上限；
  - 链接里找不到视频；
  - 网站连不上；
  - 下载超时。

  这句话原样显示，不要翻译（和其他后端文字一样）。没有这个字段时照旧显示通用的文字。
- `retryNotes` 对链接课：下载失败的会重新下载；下载成功、后面的步骤失败的，从已下载的文件重来，不再下载。

### 能下载的链接

公开链接：YouTube、Google Drive 公开文件、Vimeo、Dropbox、不设密码的 Zoom 分享录像、公开的 Panopto，以及直接指向 .mp4、.mp3、.m3u8 的地址。要学校账号登录的回放（Panopto、Canvas、Moodle、学校的 Zoom）下载不了，失败原因里会请学生改用“录网上课堂”或下载后上传。

### 前端要改的

- **本仓库（`src/pages/Lecture.tsx`）**：已改。失败的课堂页有 `lecture.error` 时显示它，代替 “Your recording is safe. Sid can try again from it.”。检查在 `tests/failed-reason.js`。
- **本仓库（`src/pages/NewLecture.tsx`）**：已改。`attachLink` 被拒（400）时删掉刚建的课，表单保留链接让学生改。不删的话，这堂空课停在 `recording`，一直算进每月课堂数。
- **`halfnote.html`**：已改，改好的文件是 `reference/halfnote.html`，和收到的版本只差下面两处。
  - 课堂页 `status === "failed"` 那段（第 1113 行）：原来第二句写死了 “The recording is still saved.”，链接课失败时这句不对，也没说原因。现在有 `l.error` 时显示 `esc(l.error)`，外面包一层 `data-notr`，免得被界面翻译替换；没有时还是原来那句。`l.link` 原来就在用（“Open the original video”），没改。
  - `submitNew` 里 `attachLink` 失败时（第 1257 行）：关掉“Saving the link”对话框，`api.deleteLecture(lec.id)`，从 `S.lectures` 里拿掉，错误显示在表单里，链接留着。
  - “Try again” 在 halfnote 里调用的是 `finishLecture`，不是 `retryLecture`。后端对失败的链接课两个都接受，都会重新下载，所以不用改。
- 分享页（`GET /shared/:id`）不带 `lecture.link`。

## 10. 课堂的来源（`lecture.source`）和新建课时的 `autoTitle`

### 新字段

- `lecture.source`：`"record" | "tab" | "upload" | "link"`，这堂课是怎么做出来的（现场录音、录网上课堂、上传、视频链接）。`GET /home` 的每堂课和 `GET /lectures/:id` 都带。前端可以用它决定卡住的课堂显示哪些按钮。
- 分享页（`GET /shared/:id`）不带 `lecture.source`，和 `link`、`error` 一样。
- 字段是可选的：旧的前端不认识它也不会出错，没有这个字段时按没有来源处理。

### 前端发的新字段

- `createLecture` 现在多发一个 `autoTitle: boolean`：学生没写标题、标题是前端用日期填的就是 `true`。后端记下它，笔记写好时换成模型起的标题（第 12 节）。

## 11. 设计师 11 月 19 日的改动，第一批（2026-11-20）

设计师 11 月 18 日测试 halfold.app 后发来的 `halfold.html` 没有直接部署（它没有本仓库后来的修复，课堂语言的取值也和后端对不上），其中第一批改动按本工程的写法搬了进来。

### 后端

- `GET /home` 的 `usage` 多了 `lecturesThisMonth`、`lecturesLimit`：本月已算的课堂数（和 `createLecture` 判断 429 用的是同一个数）和方案的每月上限。方案不限课堂数时两个都不给。
- 测验选项打乱：模型常把正确答案放在第一个（测试时 13 题有 12 题）。`detail.quiz` 和复习包的 `exam` 在读出时按“题目加选项”的哈希排列（`server/src/notes/mix.ts`）：同一道题每次顺序相同（分享页也一样），打乱两次结果不变，所以以前存的笔记也一起打乱，数据库不用改。`a` 跟着改，仍然指向正确的选项。
- 写笔记和复习包的提示词多了一句：选项会被打乱，所以不能写 “all of the above”、“both A and B” 这类指向别的选项的选项。

### 前端（请求不变）

- 额度上限弹窗，见第 8 节“方案的限制”。新建课堂页和设置页显示 “4 of 4 lectures used this month”（有 `lecturesThisMonth` 时）。
- 公式：笔记、中文解释、闪卡、测验、复习包里的 `x^{2}`、`a_{k}`、`x^2` 显示成上下标（`src/ui/Fx.tsx`）。模型照旧用这种写法即可。
- 中文解释的繁简：学生没选过时，界面是简体就显示简体，界面是繁体就显示繁体；界面是英文时才看浏览器语言。
- 自动标题带上时间（“Lecture, Fri 20 Nov, 14:05”），同一天两堂课不再同名。
- 分享：第一次点 “Share with class” 先说明链接是什么，点 “Make the link” 才调 `createShareLink`。已经有链接时直接显示链接。
- 邮箱登录：邀请码一栏从第一步就在表单上（以前用这个邮箱登录过的人留空）。`POST /session` 的请求体不变。服务器对新邮箱回 403 时，这一栏被标出来，服务器那句话显示成说明而不是红字，并说明刚才的登录码仍然有效（后端本来就不会作废它）。
- 简体字表补了 15 个字和“电邮”几个词。`tests/zh-hans.js` 改用 OpenCC 判断繁体字，不再拿字表检查字表自己，所以以后漏字会直接报出来。

## 12. 设计师 11 月 19 日的改动，第二批（2026-11-20）

### 后端

- **失败的课不算本月课堂数。** 课堂变成 `failed` 时，这堂课的额度记录被删掉；`retry` 或对它再调 `finishLecture` 时又算上。笔记写好以后再删的课仍然算，和以前一样。
- **闪卡和测验的数量随录音长短变化。** 提示词里写明上限：大约每 6 分钟一张闪卡、每 10 分钟一道题，最少 2 张和 1 题，最多 15 张和 10 题（90 分钟的课是 15 张、9 题；1 分钟的录音是 2 张、1 题），内容少时可以更少或没有。不许考课堂怎么上（点名、休息、课件放在哪）、老师的习惯和口头禅。模型多给的部分在 `buildDetail` 里截掉（`server/src/notes/prompt.ts` 的 `studyCounts`）。
- **`detail.summary`：** 模型写的 3 到 5 句摘要（短录音 1 到 2 句），可以没有。字段本来就在 INTEGRATION.md 3.2 里，现在后端真的会给。
- **模型起的标题：** 模型同时写一个标题（最多 8 个词，英文，不带日期和课程编号）。`createLecture` 带 `autoTitle: true` 时后端记下来（`lectures.auto_title`），笔记写好时把标题换成模型的；这之前学生改过名字（`PATCH /lectures/:id` 带 `title`），就不换。

### 前端（请求不变）

- 笔记最上面是 “In short”（`detail.summary`），打印时也保留；Markdown 导出也带上。
- 设置页的套餐卡片跟着界面语言显示：后端写的名字、价格和句子都是固定的几种（`server/src/billing.ts` 的 `plans()`），翻译在 `src/i18n/zh.ts` 里，句子带数字和日期的用规则翻译。认不出的句子原样显示。后端以后加了新句子，要在那里补翻译。
- 补传课件：只有上传时有窗口（可以取消）；把笔记放到课件下的过程在后台检查，笔记照常可读，课堂页顶部有提示，完成后提示 “Your notes are now under the slides.”（在别的页面时可以点过去）。见第 3 节。
- 复习包：点 “Make review pack” 后不再锁屏，页面显示正在制作，在后台每 `POLL_MS` 查一次（最多 300 次），学生可以离开；做好时在别的页面弹一条可以点过去的提示。刷新页面后，`GET` 回 `processing` 就接着查。`GET` 回 502 时显示这句话，页面回到 “Make review pack”。

## 13. 设计师 11 月 19 日的改动，第三批：小修和调查（2026-11-20）

### 后端

- **课件页码标签。** 线上那堂带课件的课，第一节只讲第 1 页，却标成 “Slides 1 to 3”。原因：标签取这一节要点页码的最小到最大，而这一节有一个要点（31 秒）被放到了第 3 页，是提前讲到后面的内容。现在每一页只算在要点最多的那一节（并列时都算），页码不连续时逐个列出（“Slides 1 and 3”、“Slides 1 to 3 and 5”）。要点自己的 `slide` 不变。标签在读出时重新计算（`Store.detail`），以前存的笔记也一起改好。
- **现场录音拼接。** 下课后把各段拼成一个文件时，每段都在同一个写入流上多挂一组监听器，日志里有 `MaxListenersExceededWarning`，90 分钟的课会挂 360 组。改成逐段写进同一个文件句柄。
- `server/test/zh-messages.test.ts`：服务器写的每一句视频链接失败原因，前端都要有中文（`src/i18n/zh.ts` 的 `SERVER`）。以后后端加了新句子而前端没补，这个测试会失败。

### 前端（请求不变）

- 付款没开通（`startCheckout` 回 `{ url: null }`）时，点 “Choose this plan” 弹一个窗口说明，而且没有扣费。
- 下课后等笔记的页面显示刚才的实时转写（只在这次访问里有，刷新就没了）。
- 失败课堂的原因（`lecture.error`）如果是我们服务器自己写的那几句链接失败原因，中文界面显示中文；其他后端文字照旧原样显示。

### 查过、没有改的

- **维基共享资源的音频直链**（`https://upload.wikimedia.org/.../Velocity_of_money.ogg`）：服务器日志里，维基媒体对第一个请求就回了 HTTP 429（“Too many requests. Please contact the Wikimedia SRE team”）。我们只请求了一次，所以多半是维基媒体对没有说明身份的程序化请求的拦截（它要求带上能识别身份、有联系方式的 User-Agent）。已改：设了 `CONTACT_EMAIL` 时，下载 `wikimedia.org`、`wikipedia.org` 的链接会给 yt-dlp 加 `--user-agent "Halfold/1.0 (<PUBLIC_URL>; <CONTACT_EMAIL>)"`，其他网站不变（YouTube 等靠 yt-dlp 自己的请求头）。这个原因还没在线上确认：部署后贴一次这条链接，能写出笔记就说明是这个原因。
- **从分享页注册时自动填邀请码**：做不了。邀请码是一个码对应一个账户、只能用一次（`server/scripts/invite.ts`），分享者自己的码已经绑定了邮箱。要做的话需要另外一套可以给多人用的推荐码。

### 联系邮箱（`CONTACT_EMAIL`）

- 后端的新设置 `CONTACT_EMAIL`（见 `server/.env.example`）：隐私页的联系邮箱，也用来向维基媒体说明身份（见上）。不设时隐私页仍显示“待定”。
- 后端把它放进页面的 `window.SIDENOTE_CONFIG.CONTACT_EMAIL`（只在设了时）；前端的 `CONFIG.CONTACT_EMAIL` 默认是 `null`。
- 线上定为 `support@halfold.app`，用 Cloudflare Email Routing 转发。转发设好、能收到信之后，再在服务器上设这个值（`halfold env`）。
- 隐私页的“谁处理你的数据”改为按服务类别和所在地写（语音转文字服务在美国，AI 模型服务在中国内地，付款服务、邮件发送服务），不写服务商名字；服务器写成“新加坡的云服务商”。换服务商时只要所在地没变，这一页就不用改；所在地变了要同步改 `src/pages/Privacy.tsx`。

## 14. 注册后的资料和两个同意（2026-11-24，交接文档第 4 项，按设计师 11-24 稿）

第一次登录后问一次资料和两个同意，设置页随时可改资料、取消同意。做法和字段跟设计师 11 月 24 日的稿（`halfold(1).html` 的 `profileFields`、`readProfile`、`needsWelcome`、`welcomePage`、`saveProfile`、`skipProfile`）一致。登录接口（`/session`）没有改。

### 字段名（`src/types.ts` 的 `Profile`）

每一项都可以不填。`""`（`gradYear` 是 `null`）就是没填。

| 字段 | 值 |
|---|---|
| `school` | 文本，最长 80 字，任何文字都可以。前端有建议列表（`CONFIG.SCHOOLS`），并按邮箱域名预填（`schoolGuess`） |
| `major` | 文本，最长 80 字（界面上是 “What you study”） |
| `yearOfStudy` | `y1`、`y2`、`y3`、`y4`（四年级或以上）、`tpg`（授课型硕士）、`rpg`（研究型研究生）、`other`，或 `""` |
| `gradYear` | 四位数年份，或 `null`。表单给今年到六年后；服务器收今年前后 10 年内的，`"2028"` 和 `2028` 都收，返回数字 |
| `origin` | 入读大学前在哪里读书：`hk`、`cn`、`tw`、`mo`（澳门）、`other`，或 `""`（“Prefer not to say”，也是默认） |
| `consentMarketing` | 布尔值：愿意接收适合自己课程和年级的招聘、升学和学生优惠信息。默认不勾 |
| `consentSurvey` | 布尔值：愿意参加有偿的学生问卷调查。默认不勾 |
| `consentMarketingAt`、`consentSurveyAt` | 这个选择是什么时候做的（ISO 时间）：同意、取消，或第一次存时没勾；没存过是 `null`。只读 |

### `getHome`

- `user.profile`：上面的 `Profile`；**还没存过时是 `null`**。前端在去主页时看到 `null`，就先跳到 `#/welcome`（和稿里的 `needsWelcome` 一样：有没录完的录音时不跳）。不认识资料的服务器不给这个字段，前端就不问，设置页也不显示“About you”。
- `user.profileSkipped`：学生点过 “Skip for now”、之后还没存过资料时是 `true`，否则不给。
- `schoolGuess`：`{ en, zhHant, zhHans }`，邮箱域名对得上学校、而且还没存学校时才有（`server/src/schools.ts`，内地、港澳台和海外常见学校）。海外学校三种语言都是英文名。

### `updateProfile`：`PUT /profile`

- body 是上面七个可写字段的任意几个：给了的存，没给的不动。前端每次都发七个（跟稿里的 `readProfile` 一样，`gradYear` 是字符串，没选是 `""`）。
- 返回 `{ profile }`。第一次存（哪怕什么都没填）之后，`user.profile` 就不再是 `null`，不会再问。
- 值不对回 400，`message` 可以直接显示（中文在 `src/i18n/zh.ts`）。
- 同意第一次存或改变时，记下时间，并在 `consents` 表另记一行（同意/不同意、显示的文字版本 `CONSENT_WORDING`、`first` 或 `change`、时间），所以每次同意和取消都查得到。存同样的值不记、时间不变。

### “Skip for now”：`POST /profile/later`

- 谁都可以跳过，新注册的也一样。前端先在浏览器里记下（`sidenote.welcomed`，和稿一样；登出时清掉，免得同一部电脑上的下一个人不被问），再调这个接口，成功回 204。
- 服务器也记下来，`GET /home` 之后带 `user.profileSkipped: true`，所以换一部设备也不会再问。只看 `user.profile === null` 的前端（比如稿本身）照样能用，只是换设备会再问一次。
- 跳过的人在主页看到一行提示 “Tell Halfold your university and year”，点了回到 `#/welcome`；设置页的 “About you” 也能填。

### 同意的文字

- 用稿里的写法，中英文都是稿里的（`src/pages/Profile.tsx`、`src/i18n/zh.ts`），`CONSENT_WORDING` 是 `draft-2026-11-24`。定稿来了改这两处，并改 `server/src/profile.ts` 的 `CONSENT_WORDING`，这样每个回答都对得上当时看到的文字。
- 两个勾选框各自独立，不和服务条款合在一起（现在登录流程里没有服务条款的勾选）。
- 稿里欢迎页的推广码一栏没有做：付款还没接上。

### 数字（交接文档第 8 项）

- `cd server && npm run signups`：最近 30 天每天注册数（按 `APP_TIMEZONE`），存过资料、跳过了还没存、两样都还没有的人数，以及两个同意各占回答过的人多少、同意后又取消的人数。`-- --days=90` 换天数，`-- --json` 出 JSON。
- 注册时间是邮箱绑定到账户的时间（`users.signed_up_at`）。2026-11-24 之前注册的账户没有这个时间，单独计数。

## 15. 课上标记、向课堂提问、跨课复习（2026-11-24）

设计师稿（`halfold.html` 2026-11-20，`INTEGRATION.md` 2026-11-19 第 0.1 节）里早就有、线上还没合进来的三样。接口名照设计师的建议，已经写进 `reference/INTEGRATION.md` 第 2 节和 3.1、3.2。设计和取舍见 `docs/superpowers/specs/2026-11-24-marks-ask-review-design.md`。

### 新接口

| `api` 函数 | 请求 | 返回 |
|---|---|---|
| `addMark(id, {t, kind})` | `POST /lectures/:id/marks` | 204 |
| `ask(id, question)` | `POST /lectures/:id/ask`，body `{ question }` | `{ answer, refs: [{ t, text }] }` |
| `getReview()` | `GET /review` | `{ cards: [{ lectureId, lecture, index, q, a }] }` |
| `setCardKnown(id, index, known)` | `PUT /lectures/:id/cards/known`，body `{ index, known }` | 204 |

新字段：`detail.marks: [{ t, kind }]`（`GET /lectures/:id`），`reviewCount`（`GET /home`）。

### 后端的实际行为

- **标记**：`kind` 只能是 `important` 或 `lost`，`t` 是 0 到 12 小时之间的秒数，存到 0.1 秒。同一秒同一种只留一个。每堂课最多 500 个（多了回 409）。任何状态的课都收。标记只在 `GET /lectures/:id` 里给，分享页、存下来的副本都没有；删课时跟着删。写笔记时还没交给模型。
- **提问**：问题 1 到 300 字（否则 400）；还没有笔记的课回 409 "Ask about this lecture once its notes are ready."；模型出错回 502 "Hal could not answer that just now. Try again in a moment."。模型拿到的是整份逐字稿（每行带编号）和问题，回答用问题的语言；`refs` 是服务器按模型给的行号取回的原句，所以一定是逐字稿里真有的话，最多 4 条，按时间排。默认用 Catch me up 的小模型（`ASK_*` 可以单独设，见 `server/.env.example`）。每次调用记在 `costs`，stage `ask`，不存问题本身；`npm run costs` 有一列。没有次数上限。
- **复习**：`GET /review` 新课在前、每堂课按卡片原来的顺序，最多 1000 张。`PUT /lectures/:id/cards/known` 卡片不存在回 404 "This flashcard is no longer there. Open the lecture again to see its cards."。`reviewCount` 和 `GET /review` 是同一个查询。

### 前端

- 录音页：标题框下面"Mark this moment"一行，"Important"和"Lost me"两个按钮，旁边写标了几处。点了手机震一下、提示一句，页面原地更新（标题框里打的字不丢）。标记同时存在本机 `sidenote.marks.<课堂id>`；服务器没收到的那几个，课堂页也照样显示；服务器都有了就删掉本机这份。
- 课堂页：摘要和主题目录下面"Your marks from class"。自己的课（有逐字稿或带时间的笔记）多一个"Ask"标签。答案在换到别的课堂之后才回来的话不显示。
- 复习页 `#/review`：侧栏"Review"带数字，首页"接着上次看"旁边一张卡片。空格翻卡，→ 记得，↓ 稍后再看。在课堂页点"I know this"也会让数字减一。
- 中文：`src/i18n/zh.ts` 加了这三样的繁体（照搬设计师稿）和服务器那几句话。

### 没做的

- 设计师稿里服务器没有 `/review`、`/ask` 时的退路（前端逐堂拉取拼复习卡、用 `saveProgress` 存）：后端这次就有这些接口。
- 写笔记时把标记交给模型。
- 提问的次数上限（额度规则还在定）。
