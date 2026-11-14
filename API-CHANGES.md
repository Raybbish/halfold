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
2. 上传成功后轮询 `GET /lectures/:id/status`，直到不再是 `processing`。轮询间隔是 `POLL_MS`，最多 100 次。
3. 重新读取 `GET /lectures/:id`：
   - `detail.slides` 不为空：提示已加入；
   - 仍然为空：提示未能加入、笔记维持原样；
   - 轮询到上限还是 `processing`：提示仍在处理，学生之后再打开这堂课就能看到结果。

后端需要：

- **笔记已生成后也接收课件。** 以前只在课堂刚建好、生成笔记之前收。
- **在这个请求返回之前，就把状态设为 `processing`。** 否则前端第一次轮询拿到 `ready`，会以为已经处理完。
- **把已有的要点归到课件页下：**
  - 给每个要点填 `slide`，并判断 `off`（老师讲了但课件上没有）；
  - 给每个 section 填 `slides`（例如 `"Slides 3 to 6"`）；
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
| 搜索全部笔记（需要搜索接口） | 已做（第 4 节），等后端加上接口 |
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
- 分享页不带录音（`SHARE_AUDIO` 保持 `false`）。分享是后端第三阶段。
