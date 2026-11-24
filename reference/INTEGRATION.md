# Sidenote 前端对接说明

给后端开发者。前端是一个文件 `sidenote.html`，没有构建步骤，没有依赖，直接部署即可。

## 0. 这一版包含什么

这个文件是在设计师的第二版设计上，合并了此前的手机端、录音回放和对接修复。

**设计师第二版新增的功能**

- 界面语言：English 和繁體中文，可切换。见第 7 节。
- 手动编辑笔记（改、加、删要点）和"笔记有错"的反馈。
- 停止分享；登录用户可以把别人分享的笔记存到自己名下。
- 复习包页面 `#/pack/:courseId`。
- 设置页的会员方案和付款入口。
- 录网课：录浏览器标签页的声音。
- 未发送的录音同时存在本机，关掉页面也不丢，下次打开可以继续生成笔记。
- 导出改成在浏览器里直接下载（Markdown、Anki、逐字稿、打印成 PDF），考试日期可以加到日历。
- 逐字稿搜索、测验重做错题、闪卡和测验的键盘操作、已掌握的闪卡会恢复。

**这次新加的**

- 中文解釋用繁体还是简体，由用户自己选。见 3.2 的 `zhHant`、`zhHans` 和 3.1 的 `settings.zhScript`。

**此前加入、现已合并进来的**

- 手机端布局。见第 6 节。
- 保留录音和回放。见第 4 节。
- 录音保留期限按会员等级区分的预留。见 4.4。
- 一批对接问题的修复。见第 5 节末尾的清单。

**合并时在新功能里修掉的三个问题**

- 中文界面会改动课堂内容：以 Hi 开头的逐字稿、内容是 Final 或 Today 的闪卡和要点，会被当成界面文字翻译。现在后端来的内容一律不翻译。
- 录音进行中另开一个标签页，新标签页会把正在录的课当成"中断的录音"，并提供"丢弃"按钮。现在新标签页会先问其他标签页是否正在录音。
- 弃录之后，下次打开页面仍然提示有一段中断的录音。现在弃录会把本机暂存的音频清干净。

## 1. 怎么接

1. 打开 `sidenote.html`，找到文件开头的 `CONFIG`。
2. 把 `USE_MOCK` 改成 `false`，把 `API_BASE` 改成你的服务地址。
3. 所有网络请求都在 `api` 对象里。每个函数有两个分支：mock 分支从 `DATA` 取示例数据，真实分支调用 `http()`。只要返回的数据结构和下面一致，界面不用改。
4. `DATA` 只是示例内容，接好之后可以整段删掉。

`CONFIG` 里的其他项：

| 项 | 默认 | 作用 |
|---|---|---|
| `CHUNK_SECONDS` | 15 | 录音时每隔多少秒上传一段 |
| `AUDIO_KBPS` | 32 | 录音码率。语音 32 kbps 足够，90 分钟约 22 MB |
| `POLL_MS` | 3000 | 等笔记或复习包时多久问一次状态 |
| `MAX_UPLOAD_MB` | 500 | 上传文件的大小上限 |
| `EXAMPLE_SHARE_ID` | `"econ-w9"` | 落地页和登录页"Example notes"指向的分享 id。后端需要提供这条分享；设成 `null` 则隐藏这些链接 |
| `SHARE_AUDIO` | `false` | 分享页是否可以播放录音。见 4.3 |

请求和响应的约定：

- 登录后前端把 `token` 放在 `Authorization: Bearer <token>` 里。`POST /session` 和 `GET /shared/:id` 是公开接口，不带 token。
- 带 token 的接口返回 401，前端会清掉登录状态并跳到登录页，重新登录后回到原来的页面。公开接口返回 401 只当作普通错误显示。
- 出错时请返回 `{ "message": "..." }`，这句话会直接显示给用户。
- 下面标"无"的接口，返回 204 或者 200 加空 body 都可以。
- 课程、课堂、分享、方案的 `id` 请只用字母、数字、`_` 和 `-`。

路由用的是 hash（`#/home`、`#/courses`、`#/course/:id`、`#/pack/:id`、`#/lecture/:id`、`#/s/:id`），所以服务器只需要返回这一个 HTML 文件，不需要配置路由。

前端在浏览器本机保存的东西：登录状态、界面语言、是否看过录音前提示、正在进行的录音标记（都在 localStorage，键名以 `sidenote.` 开头），以及还没发出去的录音分段（IndexedDB 的 `sidenote` 库）。

## 2. 接口清单

| `api` 函数 | 建议的请求 | 返回 |
|---|---|---|
| `signIn(inviteCode, name)` | `POST /session`（公开） | `{ token, user: { name } }` |
| `getHome()` | `GET /home` | 见 3.1 |
| `addCourse(code, name)` | `POST /courses` | `course` |
| `getLecture(id)` | `GET /lectures/:id` | `{ lecture, detail }`，笔记未生成时 `detail` 为 `null` |
| `createLecture({courseId, title, language, source})` | `POST /lectures` | `lecture` |
| `uploadChunk(id, blob, seq)` | `POST /lectures/:id/chunks`（multipart：`audio`、`seq`） | `{ segments: [], alerts: [] }` |
| `uploadRecording(id, file)` | `POST /lectures/:id/recording`（multipart：`file`） | 无 |
| `uploadSlides(id, file)` | `POST /lectures/:id/slides`（multipart：`file`，PDF） | 无 |
| `attachLink(id, url)` | `POST /lectures/:id/link` | 无 |
| `catchUp(id)` | `POST /lectures/:id/catch-up` | `{ points: ["...", "..."] }` |
| `finishLecture(id, duration)` | `POST /lectures/:id/finish` | `{ status }` |
| `getStatus(id)` | `GET /lectures/:id/status` | `{ status: "processing" \| "ready" \| "failed" }` |
| `retryLecture(id)` | `POST /lectures/:id/retry` | `{ status }` |
| `renameLecture(id, title)` | `PATCH /lectures/:id` | 无 |
| `deleteLecture(id)` | `DELETE /lectures/:id` | 无 |
| `updatePoint(id, section, index, text)` | `PATCH /lectures/:id/points` | 无 |
| `addPoint(id, section, text)` | `POST /lectures/:id/points` | `point` |
| `deletePoint(id, section, index)` | `DELETE /lectures/:id/points`（JSON body） | 无 |
| `sendFeedback(id, text)` | `POST /lectures/:id/feedback` | 无 |
| `saveProgress(id, {known, quizScore})` | `PUT /lectures/:id/progress` | 无 |
| `createShareLink(id)` | `POST /lectures/:id/share` | `{ url }` |
| `revokeShareLink(id)` | `DELETE /lectures/:id/share` | 无 |
| `getShared(id)` | `GET /shared/:id`（公开） | `{ lecture, course, detail, sharedBy }` |
| `saveShared(id)` | `POST /shared/:id/save` | `lecture`（存到当前用户名下的那一份） |
| `makeReviewPack(courseId)` | `POST /courses/:id/review-pack` | `{ status }` |
| `getReviewPack(courseId)` | `GET /courses/:id/review-pack` | 见 3.3 |
| `getPlans()` | `GET /plans` | 见 3.4 |
| `startCheckout(planId)` | `POST /checkout` | `{ url }`，浏览器会跳到这个地址 |
| `updateSettings({name, classLanguage, zhDefault, zhScript})` | `PUT /settings` | 无 |
| `updateProfile({school, major, yearOfStudy, gradYear, origin, consentMarketing, consentSurvey})` | `PUT /profile` | `{ profile }`，见 3.5 |
| `profileLater()` | `POST /profile/later` | 无（学生点了 “Skip for now”，见 3.5） |

路径只是建议。想换路径，改 `api` 里对应那一行即可。上一版的导出接口 `exportLecture` 已经去掉，导出现在全部在浏览器里完成。

几个接口的额外要求：

- `finishLecture` 可能被调用不止一次（用户重试，或对一堂没录完的课补做笔记），请做成幂等。
- `uploadChunk` 同一个 `seq` 可能上传两次：分段在服务器确认之前一直存在本机，如果响应丢了，下次打开页面会重发。请按 `(课堂, seq)` 去重。对已经不存在的课请返回 404 或 410，前端会丢弃这堂课剩下的分段。
- `retryLecture` 用已保存的录音重新生成笔记，在 `status` 为 `failed` 时由用户触发。
- `deleteLecture` 要连同录音文件、笔记和分享链接一起删掉，删除确认框里是这样告诉用户的。
- 编辑笔记的三个接口用"第几个 section 里的第几个要点"来定位，所以同一堂课的要点顺序要保持稳定。`deletePoint` 的参数放在 DELETE 请求的 body 里，有些网关会丢掉这种 body，部署时请确认。`addPoint` 返回的要点请带 `t: null` 和 `mine: true`，界面会把它标成"You"。
- `createShareLink` 返回的 `url` 要指向前端的 `#/s/:id`，例如 `https://你的域名/#/s/k3J9xQ`。分享 id 建议用猜不到的随机串。`revokeShareLink` 之后旧链接必须失效。
- `saveShared` 把分享的笔记复制一份到当前用户名下。分享页默认不带录音（见 4.3），这份副本也不应带。
- `getPlans` 接口不存在或出错时，设置页照常打开，只是不显示方案。
- `createLecture` 时请检查当天的录音分钟上限，超出就拒绝并返回 `message`。前端在录音前也会检查，但不能只靠前端。
- `source: "slides"` 是只用课件、不录音做的学习包：先 `createLecture`，再 `uploadSlides`，再 `finishLecture(id, 0)`。完整流程见 3.6。

`language` 的取值：`en`、`en-yue`（英文夹广东话）、`en-zh`（英文夹普通话）、`auto`。
`source` 的取值：`record`（麦克风）、`tab`（网课，浏览器标签页的声音）、`upload`、`link`、`slides`（只用课件做的学习包，见 3.6）。

## 3. 数据结构

所有时间（`t`、`start`、`end`、`duration`）都是从录音开始算起的秒数，和录音文件是同一条时间线。

### 3.1 `GET /home`

```json
{
  "user": { "name": "Jasper", "profile": null },
  "courses": [{ "id": "econ1001", "code": "ECON 1001", "name": "Principles of Microeconomics", "color": "#FF6B57" }],
  "lectures": [{ "id": "econ-w9", "course": "econ1001", "title": "...", "week": 9, "date": "Tue 10 Nov", "duration": 5400, "status": "ready", "shareUrl": null }],
  "upcoming": [{ "date": "2026-11-26", "kind": "Midterm", "text": "...", "course": "ECON 1001", "lecture": "econ-w9", "t": 18 }],
  "week": { "lectures": 4, "known": 23, "quiz": 86, "days": [1, 1, 1, 0, 0] },
  "settings": { "classLanguage": "en", "zhDefault": false, "zhScript": "hant" },
  "usage": { "minutesToday": 90, "minutesLimit": 240 },
  "today": "2026-11-11"
}
```

- `course.color`、`lecture.week`、`week`、`usage`、`today` 都可以不给，界面会自动隐藏对应部分。
- `user.profile`、`user.profileSkipped` 和 `schoolGuess`：学生的资料和两个同意，见 3.5。不给 `user.profile` 时前端不问资料。
- `usage.audioDays` 是当前套餐下录音保留的天数，给了就显示在设置页。会员功能上线前不用给。
- `settings.zhScript` 是用户选的中文解釋写法：`hant`（繁體）或 `hans`（简体）。用户没选过就不要给，前端会按浏览器语言决定起始写法。
- `today` 是用户所在地的当天日期（`YYYY-MM-DD`），用来算倒计时。不给的话前端用设备的本地日期。
- `lecture.date` 是直接显示的文字，格式由后端决定。
- `lecture.duration` 请以录音的实际长度为准。`finishLecture` 传来的 `duration` 是前端的计时，只能当参考。
- `lecture.shareUrl` 是这堂课已有的分享链接，没分享过就给 `null`。有了它，再点"Share"时不会重复创建。`GET /lectures/:id` 返回的 `lecture` 也要带。
- `lecture.status` 和界面的对应关系：

| 值 | 列表里的标记 | 课堂页 |
|---|---|---|
| `recording` | 正在录的显示 Recording；页面被关掉的显示 Not finished | 可以点"Make notes from what was saved"。本机还有没发出的音频时先补发，然后调 `finishLecture` |
| `processing` | Writing notes | 显示"正在写笔记"和"Check again" |
| `ready` | 时长 | 笔记 |
| `failed` | Not written | 说明录音还在，可以点"Try again"，前端会调 `retryLecture` |

- `lecture.source` 为 `slides`、又没有 `duration` 的课（只用课件做的学习包），列表里不显示时长，显示 Slides 标记。见 3.5。
- `upcoming` 是从所有课堂的考试和截止日期提示里汇总出来的，`date` 用 `YYYY-MM-DD`，倒计时由前端计算。已过期的前端会自动隐藏。每一条都可以下载成日历文件（全天事件）。
- `week.days` 是周一到周五是否录过课。

### 3.2 `detail`（一堂课的全部内容）

```json
{
  "audio": { "url": "https://..." },
  "progress": { "known": [0, 3] },
  "alerts": [{ "t": 18, "kind": "Midterm", "text": "..." }],
  "sections": [{
    "title": "Opportunity cost", "slides": "Slides 3 to 6", "start": 200, "end": 640,
    "points": [{ "t": 252, "text": "...", "zhHant": "...", "zhHans": "...", "off": false, "slide": 3 }]
  }],
  "slides": [{ "n": 3, "title": "Opportunity cost", "image": null }],
  "transcript": [{ "t": 18, "text": "..." }],
  "flashcards": [{ "q": "...", "a": "..." }],
  "quiz": [{ "q": "...", "opts": ["A", "B", "C", "D"], "a": 1, "why": "...", "t": 860 }]
}
```

- `audio.url` 是保留下来的录音。不给 `audio`（或给 `null`）时不显示播放器，其他功能不受影响。要求见第 4 节。
- `audio.keptUntil`（`YYYY-MM-DD`）是这份录音按用户当前套餐保留到哪一天；`audio.expired = true`（不带 `url`）表示录音已经按期限删除。两个都是为会员功能预留的，现在不用给，见 4.4。
- `progress.known` 是用户标记为"已掌握"的闪卡下标，打开课堂时恢复。就是 `saveProgress` 存进去的那个数组。
- `transcript` 必须按 `t` 从小到大排列。前端用"最后一句 `t` 不大于当前时间的"来确定正在说的那一句。
- `point.off = true` 表示"老师讲了但课件上没有"，界面会标成黄色的 Sidenote。这是产品的核心卖点，需要模型在有课件时做这个判断。
- `point.t` 为 `null` 的是用户自己加的要点，不显示时间戳。
- `point.slide` 是这一点对应的课件页码。没有上传课件时，`slides` 给空数组、`point.slide` 给 `null`，"Slides"标签会自动消失。
- `slide.image` 是该页课件的缩略图地址，没有的话显示页码和标题。`slide.n` 请给数字。
- `point.zhHant` 和 `point.zhHans` 是同一句中文解释的繁体和简体写法，可以都不给。**两种都给**，用户才能在课堂页切换；这样分享页上没登录的读者也能选。建议模型只写一种，另一种用简繁转换工具（例如 OpenCC）转出来。
- 只给一种也可以（`zhHant`、`zhHans` 或旧的 `zh` 任选其一）：前端照常显示，只是不出现「繁／简」开关。
- `section.slides` 是显示用的文字，可以不给。各 `section` 的 `start`、`end` 应首尾相接，并且不超过 `lecture.duration`，时间轴按它们的比例画。
- `alerts.kind` 是直接显示的文字。请用 `Midterm`、`Deadline`、`Exam hint`、`Quiz`、`Final` 这几个英文词，中文界面下它们会被翻译；用别的词则原样显示。
- `quiz.a` 是正确选项的下标，`quiz.t` 是老师讲到这一点的时间，可以不给。
- `kind: "slides"` 表示这份内容是只用课件写的学习包（见 3.6）：`point.t` 全是 `null`，`point.slide` 是这一点讲解的那一页，没有 `off`、`alerts`、`transcript`，`section.start`、`section.end` 都是 `0`，`quiz.t` 是 `null`。普通笔记不带 `kind`。

### 3.3 `GET /courses/:id/review-pack`

```json
{
  "status": "ready",
  "hints": [{ "t": 18, "kind": "Midterm", "text": "...", "lecture": "课堂标题", "lectureId": "econ-w9" }],
  "sheet": [{ "topic": "Opportunity cost", "points": [{ "text": "...", "off": false, "t": 252, "lecture": "课堂标题", "lectureId": "econ-w9" }] }],
  "exam": [{ "q": "...", "opts": ["A", "B", "C", "D"], "a": 1, "why": "...", "lectureId": "econ-w9" }]
}
```

- `status` 取 `none`（还没做过）、`processing`、`ready`。不是 `ready` 时不用给其余三项。
- 用户点"Make review pack"后，前端先调 `makeReviewPack`，再每 `POLL_MS` 问一次这个接口，最多 40 次。
- `lecture` 和 `lectureId` 用来显示出处并链接回那堂课的那一秒。
- 页面可以直接打印或存成 PDF。

### 3.4 `GET /plans`

```json
{
  "plans": [{ "id": "plus", "name": "Plus", "priceText": "HK$38 / month", "features": ["...", "..."] }],
  "current": "free"
}
```

- `plans` 为空数组时，设置页显示"方案和价格尚未决定"的占位。
- `current` 是用户现在的方案 id，对应的卡片显示"Your plan"，其余显示"Choose this plan"。
- 点"Choose this plan"会调 `startCheckout(planId)`，然后跳到返回的 `url`。付款完成后请把用户带回 `#/settings`。
- `name`、`priceText`、`features` 都是直接显示的文字，不会被翻译。需要中文的话，后端按用户语言返回。目前界面语言只存在浏览器里，后端拿不到；要做的话可以加一个请求头或设置项。

### 3.5 资料和两个同意（`user.profile`）

第一次登录后问一次，设置页的 “About you” 随时可改（交接文档第 4 项；设计师 2026-11-24 的稿）。

```json
{
  "school": "HKUST", "major": "Economics and Finance", "yearOfStudy": "y2", "gradYear": 2028, "origin": "hk",
  "consentMarketing": false, "consentSurvey": true,
  "consentMarketingAt": "2026-11-24T08:00:00.000Z", "consentSurveyAt": "2026-11-24T08:00:00.000Z"
}
```

- 每一项都可以不填：文本和选项是 `""`，`gradYear` 是 `null`。
- `yearOfStudy`：`y1`、`y2`、`y3`、`y4`（四年级或以上）、`tpg`（授课型硕士）、`rpg`（研究型研究生）、`other`。
- `gradYear`：四位数年份。表单列出今年到六年后。
- `origin`：入读大学前在哪里读书，`hk`、`cn`、`tw`、`mo`、`other`；`""` 是 “Prefer not to say”。
- `consentMarketing`、`consentSurvey`：两个同意，各自独立，默认都是 `false`。`consentMarketingAt`、`consentSurveyAt` 是这个选择是什么时候做的，没存过是 `null`，只读。
- `GET /home` 的 `user.profile` 在学生存过一次之前是 `null`，前端在去主页时就先打开 `#/welcome`。学生点 “Skip for now” 时前端在浏览器里记下，并调 `profileLater()`；之后 `user.profileSkipped` 是 `true`，换设备也不再问，主页只显示一行提示。
- `schoolGuess`（`GET /home` 顶层）：`{ en, zhHant, zhHans }`，邮箱域名对得上学校、还没存学校时才给，前端拿来预填 “University”。
- `updateProfile` 给了的字段才存，没给的不动；返回 `{ profile }`。第一次存（哪怕什么都没填）之后就不再问。同意每次改变都要记下时间。

### 3.6 只用课件做的学习包（`source: "slides"`）

学生没有录音时，可以只交课件（PDF），得到一份学习包：每页的讲解和要点、闪卡和测验。之后再加上这堂课的录音，就变成一堂普通的课，笔记按录音加课件重写。

**流程**

1. `POST /lectures`，`source: "slides"`。`language` 照常传（只用来决定中文解釋用繁体还是简体）。
2. `POST /lectures/:id/slides`，multipart `file`，必须是 PDF，否则 415。前端在上传失败时会删掉刚建的课（`DELETE /lectures/:id`），表单上保留已选的文件和服务器给的原因。
3. `POST /lectures/:id/finish`，`duration` 给 `0`。没有课件时返回 409：`Add the slide deck first. A study pack is made from the slides.` 之后课堂是 `processing`，前端轮询 `GET /lectures/:id/status`，和普通的课一样。
4. `ready` 之后 `GET /lectures/:id` 的 `detail` 带 `kind: "slides"`，格式见 3.2 最后一条。

**服务器怎么写**

- 用读课件的同一段代码（`server/src/slides.ts` `readSlides`）取出每页的文字，再让笔记模型按 `server/src/notes/slidesPack.ts` 的提示写：讲解课件上写了什么，不补课件上没有的内容，不猜老师在课上说了什么，不写考试提醒；封面、目录这类没有内容的页不写要点。
- 闪卡和测验的数量按有文字的页数算：大约每 2 页一张闪卡、每 4 页一道题，最少 2 张、1 道，最多 15 张、10 道（和录音的上限一样）。
- 回复不能用时把回复和问题发回给模型再要一次，和写笔记一样。每次调用都记进费用表，`stage` 是 `slides-pack`，`meta.slidePages` 是页数；`npm run costs` 有单独一列和一行汇总。
- 课件读不出来（加密、损坏）或者没有文字（扫描件），这堂课就是 `failed`，`error` 里写原因。课件文件保留，"Try again"（`POST /lectures/:id/retry`）会重新读。

**额度**

学习包不用录音，所以不计入每月的课堂数（`lecturesPerMonth`），也不占当天的录音分钟：建课时不检查，`quota` 表里不记。怎么给学习包计数（要不要另设上限）还没定，现在是不限。

**之后加录音**

- 在学习包上 `POST /lectures/:id/recording`（multipart `file`）：课堂从此是 `source: "upload"`，按普通上传计数（先检查每月课堂数，超出 429）。
- 学习包已经写好（`ready`）或者失败了（`failed`）时，这个请求返回之前课堂就已经是 `processing`，按普通流程用录音加原来的课件重写笔记；之后前端照常调 `finishLecture`，只会拿到 `processing`。闪卡的"已掌握"记录会清空，因为闪卡会重写。学生在学习包上改过的要点和自己加的要点不会带到新笔记里。
- 重写期间 `GET /lectures/:id` 的 `detail` 是 `null`，课堂页显示"正在写笔记"。
- 学习包还在写（`processing`）时加录音返回 409：`Hal is still reading the slides. Add the recording when the study pack is ready.`
- 学习包还没开始做（`recording`，课件传了但没调 `finish`）时加录音，就是一次普通上传，之后要调 `finish`。

**前端**

- 新建课堂页最后一个选项是"Slides only, no recording"：只要课件，不问上课语言，按钮是"Make the study pack"。首页的录音卡片、落地页和"超出每月课堂数"的提示窗里都有链接直接打开这个选项。
- 写的过程中课堂页显示"Hal is reading your slides"；失败时显示"This study pack could not be written"，说明课件还在，可以 Try again。
- 学习包页面没有时间轴、逐字稿、播放器和"只看课件上没有的"开关；每个要点前显示"Slide N"。顶部有一张卡片：加录音（上传进度显示在这张卡片的位置），或者去录下一堂课。

## 4. 录音保留与回放

### 4.1 前端做了什么

- 课堂页底部有一个播放器：播放和暂停、进度条、后退和前进 15 秒、倍速（1、1.25、1.5、2）。
- 点课堂页里的任何时间戳（笔记要点、考试提示、测验的"Said at"），录音会跳到那一秒，同时打开对应的逐字稿。跳转不会自动开始播放，免得在教室或图书馆突然出声；如果正在播放，就从新位置继续。
- 首页考试雷达和复习包里的出处链接，会打开那堂课并把录音定位到那一秒。
- 播放时，时间轴上的指针和逐字稿的高亮跟着走。
- 离开课堂页就停止播放。在 Flashcards 和 Quiz 标签下，没在播放时播放器会收起来。
- "More"菜单里有"Download recording"，直接打开 `audio.url`。
- 手机上接了系统的媒体控制（锁屏和耳机上的播放、暂停、快进快退）。

### 4.2 后端需要做到的

1. **文件要能拖动进度。** 前端上传的分段按 `seq` 拼起来之后，一般不带时长和索引信息，浏览器里没法直接跳转。请转封装或转码成可以跳转的文件。建议用 M4A（AAC）或 MP3，包括 iPhone 在内的浏览器都能播。
2. **支持 HTTP Range 请求**（返回 206）。不支持的话，每次跳转都要从头下载。
3. **`url` 可以是带签名的临时地址。** 播放出错时，前端会重新调一次 `getLecture`（分享页是 `getShared`）拿新地址，并从原来的位置继续。所以每次请求都返回一个新签名的地址就行。
4. **四种来源都要保留音频。** 上传的是视频时，抽出音轨保存。链接来源能保存就保存，保存不了就不给 `audio`。
5. **没录完的课也要留着已收到的分段。** 用户之后可以用它们生成笔记（见 3.1 的 `recording` 状态）。
6. **删除课堂时删掉录音。**

### 4.3 分享页带不带录音

默认不带：`CONFIG.SHARE_AUDIO` 是 `false`，分享页不显示播放器，分享弹窗里写的是"The recording stays private"。这时建议 `GET /shared/:id` 也不要返回 `audio`，`saveShared` 复制出来的那一份也不带。

如果决定让同学也能听录音：把 `SHARE_AUDIO` 改成 `true`，并让 `GET /shared/:id` 返回 `detail.audio`。弹窗的文字会跟着变。

把老师的原声公开给没有登录的人，是产品和合规上的决定，请先确认学校和课程的规定。

### 4.4 保留期限和会员

已定的方向：录音保留多久，后期作为会员权益来区分，用户付费升级后保留得更久。现阶段录音全部保留，下面这些字段都不用给。

方案和付款的界面已经有了（设置页，由 `GET /plans` 和 `POST /checkout` 驱动）。保留期限这一侧，前端预留的是：

| 后端给的 | 前端的表现 |
|---|---|
| `audio.keptUntil`，离到期超过 7 天 | 只在"More"菜单里显示"Recording kept until 11 Dec" |
| `audio.keptUntil`，7 天以内（含当天） | 课堂页顶部出现提示：录音保留到哪天、还剩几天、之后笔记还在 |
| `audio.expired = true` | 不显示播放器和下载入口，课堂页顶部说明录音已不再保留；笔记、逐字稿、闪卡和测验照常可用，时间戳仍然能打开逐字稿 |
| `usage.audioDays` | 设置页显示"Recordings are kept for N days on your plan"；上面两条提示后面多出一个"See plans"链接，通向设置页的方案 |

这些提示只有课堂的主人看得到，分享页不显示，打印时也不出现。各方案保留多少天，写在 `GET /plans` 的 `features` 里给用户看。

上会员时后端需要定的规则：

- 期限从哪天算起，建议从上课当天。
- 用户升级后，还没删除的录音按新期限顺延。已经删除的无法恢复，这一点要在方案说明里写清楚。
- 录音删除后 `retryLecture` 就用不了了。笔记还没生成成功的课（`failed`、`recording`）建议不要先删录音。
- 如果免费版以后会有期限，请从一开始就在产品里告诉用户。先全部保留、以后再缩短，等于把已经给出去的东西收回来。

## 5. 录音是怎么工作的

- 两种录法：麦克风（`source: "record"`），或者录一个浏览器标签页的声音（`source: "tab"`，用于网课）。后者只在能分享标签页的浏览器里出现，手机上没有这个选项。
- 第一次录音前会弹一次提示：确认这堂课允许录音、坐在听得清的位置、手机保持屏幕亮着。
- 前端用浏览器的 `MediaRecorder` 真实录音，码率由 `CONFIG.AUDIO_KBPS` 指定，每 `CONFIG.CHUNK_SECONDS`（默认 15 秒）产生一段，调用 `uploadChunk(id, blob, seq)`。
- **注意：这些分段不能单独解码。** 只有第一段带容器头，后面的段要按 `seq` 顺序拼起来才是完整文件。服务端要么按顺序拼接后再转写，要么把前端改成每段重启录音器（会有极短的间隙）。
- 格式取决于浏览器：Chrome 一般是 `audio/webm`（Opus），Safari 一般是 `audio/mp4`。以 blob 自带的类型为准。
- `uploadChunk` 的返回值驱动实时界面：`segments` 追加到实时逐字稿，`alerts` 弹出考试提示。如果转写比上传慢，这次返回空数组、下次一起返回即可。
- 分段按顺序一段一段发。发送失败的留在队列里，联网后或每 10 秒重试一次。界面上会区分"断网"和"服务器暂时存不了"（后者是指接口返回了错误码）。
- **每个分段在服务器确认之前，同时存在浏览器本机。** 页面被关掉或崩溃后，下次打开会提示有一段没完成的录音：选"Make notes from it"就把剩下的分段按顺序补发，然后调 `finishLecture`；选"Discard it"就清掉本机的分段并调 `deleteLecture`。
- 判断"是不是中断了"时，新打开的标签页会先问其他标签页有没有正在录音，有就不提示。
- 点"End and make notes"后：前端先等录音器交出最后一段，再等队列全部发完，然后才调 `finishLecture`。所以收到 `finish` 时，这堂课的分段已经到齐。之后每 `CONFIG.POLL_MS`（默认 3 秒）问一次 `getStatus`，最多问 100 次，变成 `ready` 就跳到笔记页。
- 点"Discard"后：前端清掉本机暂存的分段，调 `deleteLecture`，之后不会再发这堂课的分段。
- 计时器按真实流逝的时间累计，浏览器在后台标签页里放慢定时器时不会走慢。
- 用户在录音时可以切到别的页面，录音不会断，页面顶部（手机上是底部导航中间）会显示正在录音和返回入口。录音进行中不能登出。
- 麦克风中途断开（设备被拔掉、被系统收回）时，录音页会提示用户结束录音以保住已录的部分。录网课时，用户停止分享标签页，录音会自动结束并生成笔记。
- iPhone 上锁屏或切到别的 app 会让网页录音暂停，这是浏览器的限制，前端解决不了。前端做了三件事：申请屏幕常亮（Wake Lock），并在每次回到页面时重新申请；页面在后台期间计时器停住；回来时提示用户录音中断了多久。
- 浏览器离线时，页面顶部有一条全局提示。

**这一版修掉的对接问题**（都是接上真实后端才会出现的）：

| 问题 | 现在的行为 |
|---|---|
| 弃录一次后，下一堂课的音频传不上去 | 弃录的课不再进队列；服务器回 404 或 410 的分段直接丢弃 |
| 结束录音时误报"Waiting for a connection" | 等最后一段真正发完再结束，只有真的发不出去才提示 |
| 标"无"的接口回 200 空 body 时界面报错 | 204 和空 body 都按成功处理 |
| 邀请码错误回 401 时，提示变成"Please sign in again" | 登录接口的错误原样显示；登录失败后保留已输入的邀请码 |
| 香港时间 0 到 8 点倒计时差一天 | 用本地日期，或后端给的 `today` |
| `failed` 状态没有界面 | 列表有标记，课堂页可以重试 |
| 示例链接写死 | 由 `CONFIG.EXAMPLE_SHARE_ID` 控制 |
| 课件上传失败时提示"可以之后再加"，但没有入口 | 改成如实说明这堂课的笔记不带课件 |

## 6. 手机端

900px 以下使用手机布局：

- 顶栏是 logo、语言切换和设置入口。底部导航是 Home、New lecture、Courses。课程列表有单独的页面 `#/courses`。
- 录音进行中，底部中间的按钮变成计时，点它回到录音页。
- 录音页：Pause 和 End and make notes 固定在屏幕底部，Discard 移到右上角。"Catch me up"排在逐字稿前面。
- 课堂页：标签栏吸在顶部，播放器浮在底部导航上方，时间轴和时间戳的点击区域放大。没有缩略图的课件只显示一行页码和标题。
- 新建页：几种方式并成一行分段按钮。
- 弹窗从底部滑出，提示条从顶部出现，都不会挡住底部的按钮。
- 输入框字号不小于 16px（否则 iPhone 聚焦时会放大页面），并留出了刘海和底部横条的安全区。
- 打印时不会带上导航和播放器。

**测试范围**：在桌面 Chrome 里模拟了 320 到 900px 的宽度和触屏，英文和中文界面都走过，没有在真实的 iPhone 和 Android 手机上测过。iPhone 后台停录的提示是按 Safari 的已知行为写的。录网课需要真实的标签页分享，自动化环境里测不了。上线前请用真机录一堂课、用电脑录一次网课来确认。

## 7. 界面语言

- 界面有 English 和繁體中文两种，用户在导航栏或设置页切换，选择存在浏览器本机。
- 做法：页面一律先用英文写出来，每次渲染后把页面上的文字按对照表换成中文。对照表是文件里的 `ZH`（整句对应）和 `ZHR`（带数字或名字的句式）。
- **后端来的内容不会被翻译。** 课堂标题、课程名、要点、中文解释、逐字稿、闪卡、测验、考试提示的正文、复习包的内容，都标了 `data-notr`，原样显示。
- 例外是几个约定的词：`alerts.kind` 里的 `Midterm`、`Deadline`、`Exam hint`、`Quiz`、`Final`，`lecture.date` 里的 `Today`，以及课堂信息行里的"week 9""90 min"，中文界面下会换成中文。
- 日期（考试雷达、录音保留到哪天）会跟着界面语言显示。
- 中文解釋的繁简是另一个独立的选择，和界面语言无关：英文界面的用户也可以看简体解释。打开「中文解釋」后，旁边出现「繁／简」开关；设置页也有同一个选项。登录用户的选择通过 `updateSettings` 存进账号（`zhScript`），没登录的读者存在浏览器本机。用户从没选过时，浏览器语言是简体中文的从简体开始，其余从繁体开始。
- 以后在界面里加新的英文句子，要在 `ZH` 或 `ZHR` 里补上中文，否则中文界面下这一句会是英文。把后端内容放进新的位置时，记得加 `data-notr`。

## 8. 示例版本里哪些是假的

| 部分 | 现状 |
|---|---|
| 所有课堂内容、课程、统计数字 | 示例数据 |
| 实时逐字稿 | 示例文字，每 3 秒出一句；但麦克风是真的在录，分段也真的交给了 `uploadChunk` |
| 录音回放 | 播放器是模拟的，没有声音；进度、跳转、倍速都可以试。接上后端后播放的是 `audio.url` |
| 上传录音、课件 | 文件选择和校验是真的，上传是假的 |
| 编辑笔记、反馈、停止分享、存到我的课堂 | 界面是真的，只改了本页的示例数据 |
| 中文解釋的繁体写法 | 示例里是用一张小的对照表从简体转出来的，只覆盖示例用到的字 |
| 复习包 | 用示例课堂的内容拼出来的 |
| 只用课件做的学习包 | 不管传什么课件，都是把示例课堂改成学习包（去掉时间、Not on slides、提醒和逐字稿），页面上标着 Sample；之后加录音得到的是示例课堂的完整笔记 |
| 导出 Markdown、Anki、逐字稿、日历、打印 | 都是真的，在浏览器里生成 |
| 会员方案 | 示例版本返回空列表，显示占位；付款提示"未接通" |
| 登录 | 任何非空邀请码都能进 |

"Sample data"标记只在 `USE_MOCK = true` 时出现（桌面在左下角，手机在顶栏）。

## 9. 还没做的

- 没有邮箱或学校账号登录，沿用了现在的邀请码方式。
- 首页搜索框写的是搜"course, title or notes"，实际只搜得到本次打开过的课的笔记。要搜全部笔记，需要一个搜索接口。
- 上传录音走一次性请求，没有进度条，不能取消，也不能断点续传。
- 录音模式下课件如果上传失败，这堂课的笔记就不带课件（界面会提示），目前没有之后补传的入口。
- 课程不能改名或删除，课堂不能换到别的课程下。
- 付款完成后的回跳和结果提示。

## 10. 定价需要你提供的数字

定价要从成本倒推。请在跑通之后给出下面这些实测值：

| 项目 | 单位 |
|---|---|
| 转写成本 | 每小时录音多少钱 |
| 生成笔记、闪卡、测验的成本 | 每堂课多少钱（按 90 分钟的课） |
| 有课件时多出来的成本（解析 PDF、逐页对齐） | 每堂课多少钱 |
| 中文解释多出来的成本 | 每堂课多少钱 |
| "Catch me up"每点一次的成本 | 每次多少钱 |
| 期末复习包的成本 | 每门课多少钱（按 12 堂课） |
| 录音存储（现在要长期保留） | 每小时录音每月多少钱，以及转码后的回放文件每小时多大 |
| 回放流量 | 每听一小时多少钱 |
| 其他存储和流量 | 每个活跃用户每月多少钱 |
| 实时转写与课后一次性转写的成本差 | 倍数 |

有了这些，就能算出"一个学生一学期的成本"：

> 每周课时数 × 学期周数 ×（转写 + 笔记 + 课件对齐 + 录音存储）+ 复习包 × 课程数 + 回放流量 + 其他存储

录音存储和别的成本不一样，它会随着学期累积：第 12 周时要为前 11 周的录音付费。上传时按 32 kbps 算，每小时录音约 14 MB。保留期限已定为后期按会员等级区分（见 4.4），所以定价时要多定两个数：免费版保留多少天，会员保留多少天。上表里"录音存储"那一行的实测值，就是这两个数的成本依据。

免费额度、每日 240 分钟的上限、复习包是否单独收费，都要等这几个数出来再定。最后一项尤其重要：如果实时转写比课后转写贵很多，可以考虑只在付费版里提供实时逐字稿和"Catch me up"。
