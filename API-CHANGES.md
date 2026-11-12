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

## 3. INTEGRATION.md 第 9 节“还没做的”现在的情况

| 项目 | 情况 |
|---|---|
| 上传录音的进度条和取消 | 已做（第 2 节）。断点续传还没做 |
| 课程改名或删除、课堂换到别的课程 | 已做（第 1 节） |
| 邮箱或学校账号登录 | 没做 |
| 搜索全部笔记（需要搜索接口） | 没做 |
| 录音时课件上传失败，之后补传 | 没做 |
| 付款完成后的回跳和结果提示 | 没做 |
