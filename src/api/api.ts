/* Every network call goes through `api`. Each function has a mock branch (answers from DATA) and a real branch
   (calls http()). Keep the return shapes and the screens need no other change. Paths are suggestions, see
   reference/INTEGRATION.md section 2. */
import { CONFIG } from "../config";
import { wait } from "../lib/helpers";
import { S } from "../state/app";
import { http, form1, upload, type UploadOptions } from "./http";
import { DATA, fakeUpload, fileUnderSlides, mockSlides, samplePack, withoutSlides } from "./mock";
import type {
  AskReply, CatchUpReply, ChunkReply, Course, Home, Lecture, LectureReply, Mark, NewLecture, PackHint, PackQuestion, PackTopic, Plans, Point, ProfileReply,
  ProfileUpdate, ProgressUpdate, ReviewPack, ReviewReply, SearchReply, SessionReply, SettingsUpdate, SharedReply, StatusReply, Upcoming, UrlReply
} from "../types";

/* Sample build: the flashcards not marked as known, from every lecture with notes (what GET /review answers). */
const mockReview = (): ReviewReply["cards"] => DATA.lectures.flatMap(l => { const d = DATA.details[l.id], known = (d && d.progress && d.progress.known) || [];
  return d ? d.flashcards.map((c, index) => ({ lectureId: l.id, lecture: l.title, index, q: c.q, a: c.a })).filter(c => !known.includes(c.index)) : []; });

export const api = {
  /* POST /session {inviteCode, name} -> {token, user:{name}} */
  async signIn(inviteCode: string, name: string): Promise<SessionReply> {
    if (!CONFIG.USE_MOCK) return http("POST", "/session", { inviteCode, name }, true);
    await wait(400); if (!inviteCode.trim()) throw new Error("Enter your invite code.");
    return { token: "mock-token", user: { name: name.trim() || DATA.user.name } };
  },
  /* POST /session/code {email}   SIGN_IN "email": sends a 6-digit code to the address (added in backend phase 4) */
  async sendCode(email: string): Promise<null> {
    if (!CONFIG.USE_MOCK) return http("POST", "/session/code", { email }, true);
    await wait(400); if (!/^\S+@\S+\.\S+$/.test(email.trim())) throw new Error("Enter your email address."); return null;
  },
  /* POST /session {email, code, name, inviteCode} -> {token, user:{name}}   403 = an email new to Halfold: ask for the invite code */
  async signInWithCode(email: string, code: string, name: string, inviteCode: string): Promise<SessionReply> {
    if (!CONFIG.USE_MOCK) return http("POST", "/session", { email, code, name, inviteCode }, true);
    await wait(400); if (!/^\d{6}$/.test(code.replace(/\s+/g, ""))) throw new Error("Enter the 6-digit code from the email.");
    return { token: "mock-token", user: { name: name.trim() || DATA.user.name } };
  },
  /* GET /home -> {user, courses[], lectures[], upcoming[], week, settings, usage, today?} */
  async getHome(): Promise<Home> {
    if (!CONFIG.USE_MOCK) return http("GET", "/home");
    await wait(250);
    return { user: { ...(S.user || DATA.user), profile: DATA.profile ? { ...DATA.profile } : null }, courses: DATA.courses.slice(), lectures: DATA.lectures.slice(), upcoming: DATA.upcoming.slice() as Home["upcoming"], week: DATA.week, settings: { ...DATA.settings },
      usage: { minutesToday: DATA.user.minutesToday, minutesLimit: DATA.user.minutesLimit }, today: "2026-11-11" };   // no reviewCount: tests/api-parity.js keeps this answer as sidenote.html gave it; opening Review counts the cards
  },
  /* POST /courses {code, name} -> course */
  async addCourse(code: string, name: string): Promise<Course> {
    if (!CONFIG.USE_MOCK) return http("POST", "/courses", { code, name });
    const c = { id: code.toLowerCase().replace(/\W+/g, "") + Date.now().toString(36).slice(-3), code, name }; DATA.courses.push(c); return c;
  },
  /* GET /lectures/:id -> {lecture, detail|null}   detail is null while notes are still being written. detail.audio = {url} is the kept recording */
  async getLecture(id: string): Promise<LectureReply> {
    if (!CONFIG.USE_MOCK) return http("GET", "/lectures/" + encodeURIComponent(id));
    await wait(200); const l = DATA.lectures.find(x => x.id === id); if (!l) throw new Error("This lecture does not exist.");
    return { lecture: l, detail: DATA.details[id] || null };
  },
  /* GET /shared/:id (no sign-in) -> {lecture, course, detail, sharedBy} */
  async getShared(id: string): Promise<SharedReply> {
    if (!CONFIG.USE_MOCK) return http("GET", "/shared/" + encodeURIComponent(id), undefined, true);
    await wait(200); const l = DATA.lectures.find(x => x.id === id); if (!l || !DATA.details[id] || l.unshared) throw new Error("This link is no longer shared.");
    return { lecture: l, course: DATA.courses.find(c => c.id === l.course), detail: DATA.details[id], sharedBy: DATA.user.name };
  },
  /* POST /lectures {courseId, title, language, source:"record"|"tab"|"upload"|"link"|"slides"} -> lecture   "slides": a study
     pack from the slide deck alone (POST /lectures/:id/slides, then finish); a recording added later makes it an upload */
  async createLecture(p: NewLecture): Promise<Lecture> {
    if (!CONFIG.USE_MOCK) return http("POST", "/lectures", p);
    const l: Lecture = { id: "lec-" + Date.now().toString(36), course: p.courseId, title: p.title || "Untitled lecture", date: "Today", duration: 0, status: "recording", ...(p.source === "slides" ? { source: p.source } : {}) };
    DATA.lectures.unshift(l); DATA.feed = 0; return l;
  },
  /* POST /lectures/:id/chunks (multipart: audio, seq) -> {segments:[{t,text}], alerts:[{t,kind,text}]} */
  async uploadChunk(id: string, blob: Blob, seq: number): Promise<ChunkReply> {
    if (!CONFIG.USE_MOCK) return http("POST", "/lectures/" + id + "/chunks", form1("audio", blob, { seq }));
    return { segments: [], alerts: [] };
  },
  /* POST /lectures/:id/recording (multipart: file)   opts: progress reports and cancelling, see UploadOptions */
  async uploadRecording(id: string, file: File, opts: UploadOptions = {}): Promise<null> { if (!CONFIG.USE_MOCK) return upload("/lectures/" + id + "/recording", form1("file", file), opts); await fakeUpload(file.size, 900, opts); return null; },
  /* POST /lectures/:id/slides (multipart: file, PDF) */
  async uploadSlides(id: string, file: File, opts: UploadOptions = {}): Promise<null> { if (!CONFIG.USE_MOCK) return upload("/lectures/" + id + "/slides", form1("file", file), opts); await fakeUpload(file.size, 300, opts);
    /* Slides for a lecture that already has notes: the notes are filed under them, so the lecture is processing again. */
    mockSlides.add(id); const l = DATA.lectures.find(x => x.id === id), d = DATA.details[id]; if (l && d && !d.slides.length) l.status = "processing"; return null; },
  /* POST /lectures/:id/link {url} */
  async attachLink(id: string, url: string): Promise<null> { if (!CONFIG.USE_MOCK) return http("POST", "/lectures/" + id + "/link", { url }); await wait(600); return null; },
  /* POST /lectures/:id/catch-up -> {points:[string]}   summary of the last five minutes of a live recording */
  async catchUp(id: string, seen: number[]): Promise<CatchUpReply> {
    if (!CONFIG.USE_MOCK) return http("POST", "/lectures/" + id + "/catch-up");
    await wait(700); const pts = DATA.detail.sections.flatMap(s => s.points).filter(p => seen.includes(p.t as number)).slice(-3).map(p => p.text);
    return { points: pts.length ? pts : ["Nothing to summarise yet. The lecturer has only covered announcements."] };
  },
  /* POST /lectures/:id/marks {t, kind:"important"|"lost"}   a moment marked while recording; it comes back in detail.marks.
     Sample build: nothing to send it to (the lecture page reads the copy kept in this browser). */
  async addMark(id: string, m: Mark): Promise<null> { if (!CONFIG.USE_MOCK) return http("POST", "/lectures/" + encodeURIComponent(id) + "/marks", m); return null; },
  /* POST /lectures/:id/ask {question} -> {answer, refs:[{t, text}]}   refs: the lines of the transcript the answer rests on.
     Sample build: no model, so no answer: the lines that mention the words of the question. */
  async ask(id: string, question: string): Promise<AskReply> {
    if (!CONFIG.USE_MOCK) return http("POST", "/lectures/" + encodeURIComponent(id) + "/ask", { question });
    await wait(300); const d = DATA.details[id]; if (!d) throw new Error("This lecture has no notes yet.");
    const stop = new Set(["what", "the", "and", "for", "was", "did", "does", "how", "why", "with", "that", "this", "are", "about", "lecturer", "say", "said", "mean", "means"]);
    const words = (question.toLowerCase().match(/[a-z0-9]{3,}|[\u4e00-\u9fff]{2,}/g) || []).filter(w => !stop.has(w));
    const pool = d.transcript.length ? d.transcript : d.sections.flatMap(s => s.points).filter(p => p.t != null).map(p => ({ t: p.t as number, text: p.text }));
    const refs = words.length ? pool.map(s => ({ s, n: words.filter(w => s.text.toLowerCase().includes(w)).length })).filter(x => x.n).sort((a, b) => b.n - a.n || a.s.t - b.s.t).slice(0, 4).sort((a, b) => a.s.t - b.s.t).map(x => ({ t: x.s.t, text: x.s.text })) : [];
    return { answer: "", refs };
  },
  /* GET /review -> {cards:[{lectureId, lecture, index, q, a}]}   every flashcard not marked as known, from every lecture */
  async getReview(): Promise<ReviewReply> { if (!CONFIG.USE_MOCK) return http("GET", "/review"); await wait(200); return { cards: mockReview() }; },
  /* PUT /lectures/:id/cards/known {index, known}   one card, from the Review page; the quiz score stays */
  async setCardKnown(id: string, index: number, known: boolean): Promise<null> {
    if (!CONFIG.USE_MOCK) return http("PUT", "/lectures/" + encodeURIComponent(id) + "/cards/known", { index, known });
    const d = DATA.details[id]; if (d) { const k = new Set((d.progress && d.progress.known) || []); if (known) k.add(index); else k.delete(index); d.progress = { known: [...k].sort((a, b) => a - b) }; } return null;
  },
  /* POST /lectures/:id/finish {duration} -> {status} */
  async finishLecture(id: string, duration: number): Promise<StatusReply> {
    if (!CONFIG.USE_MOCK) return http("POST", "/lectures/" + id + "/finish", { duration });
    let l = DATA.lectures.find(x => x.id === id); if (!l) { l = { id, course: DATA.courses[0].id, title: "Recovered recording", date: "Today" }; DATA.lectures.unshift(l); } l.status = "processing"; if (l.source !== "slides") l.duration = 5400; return { status: "processing" };
  },
  /* GET /lectures/:id/status -> {status:"processing"|"ready"|"failed"} */
  async getStatus(id: string): Promise<StatusReply> {
    if (!CONFIG.USE_MOCK) return http("GET", "/lectures/" + id + "/status");
    await wait(1500); const l = DATA.lectures.find(x => x.id === id); if (l) l.status = "ready";
    const prev = DATA.details[id];   // notes with slides stay; slides sent later are filed in; no slides sent: notes without slides
    /* A study pack from the slides alone is the sample lecture as a pack; a recording added to a pack gives the full notes, with its slides. */
    DATA.details[id] = l && l.source === "slides" ? samplePack(DATA.detail) : prev && prev.kind === "slides" ? DATA.detail
      : prev && prev.slides.length ? prev : mockSlides.has(id) ? (prev ? fileUnderSlides(prev) : DATA.detail) : withoutSlides(DATA.detail); return { status: "ready" };
  },
  /* POST /lectures/:id/retry -> {status}   write the notes again from the kept recording, after status "failed" */
  async retryLecture(id: string): Promise<StatusReply> {
    if (!CONFIG.USE_MOCK) return http("POST", "/lectures/" + id + "/retry");
    const l = DATA.lectures.find(x => x.id === id); if (l) l.status = "processing"; return { status: "processing" };
  },
  /* POST /lectures/:id/share -> {url} */
  async createShareLink(id: string): Promise<UrlReply> { if (!CONFIG.USE_MOCK) return http("POST", "/lectures/" + id + "/share"); const l = DATA.lectures.find(x => x.id === id), url = location.href.split("#")[0] + "#/s/" + id; if (l) { l.shareUrl = url; l.unshared = false; } return { url }; },
  /* DELETE /lectures/:id/share   the old link must stop working */
  async revokeShareLink(id: string): Promise<null> { if (!CONFIG.USE_MOCK) return http("DELETE", "/lectures/" + id + "/share"); const l = DATA.lectures.find(x => x.id === id); if (l) { l.shareUrl = null; l.unshared = true; } return null; },
  /* POST /shared/:id/save -> lecture   a signed-in reader keeps a copy of shared notes */
  async saveShared(id: string): Promise<Lecture> { if (!CONFIG.USE_MOCK) return http("POST", "/shared/" + encodeURIComponent(id) + "/save"); const src = DATA.lectures.find(x => x.id === id)!, l = { ...src, id: "lec-" + Date.now().toString(36), shareUrl: null }; DATA.lectures.unshift(l); DATA.details[l.id] = DATA.details[id]; return l; },
  /* PATCH /lectures/:id/points {section, index, text} */
  async updatePoint(id: string, section: number, index: number, text: string): Promise<null> { if (!CONFIG.USE_MOCK) return http("PATCH", "/lectures/" + id + "/points", { section, index, text }); await wait(200); return null; },
  /* POST /lectures/:id/points {section, text} -> point */
  async addPoint(id: string, section: number, text: string): Promise<Point> { if (!CONFIG.USE_MOCK) return http("POST", "/lectures/" + id + "/points", { section, text }); await wait(200); return { t: null, text, mine: true, off: false, slide: null }; },
  /* DELETE /lectures/:id/points {section, index} */
  async deletePoint(id: string, section: number, index: number): Promise<null> { if (!CONFIG.USE_MOCK) return http("DELETE", "/lectures/" + id + "/points", { section, index }); await wait(200); return null; },
  /* POST /lectures/:id/feedback {text}   a user says the notes are wrong */
  async sendFeedback(id: string, text: string): Promise<null> { if (!CONFIG.USE_MOCK) return http("POST", "/lectures/" + id + "/feedback", { text }); await wait(300); return null; },
  /* GET /courses/:id/review-pack -> {status:"none"|"processing"|"ready", hints[], sheet[], exam[]} */
  async getReviewPack(courseId: string): Promise<ReviewPack> {
    if (!CONFIG.USE_MOCK) return http("GET", "/courses/" + courseId + "/review-pack");
    await wait(900); const st = DATA.packs[courseId] || "none"; if (st !== "ready") return { status: st as "none" | "processing" };
    const hints: PackHint[] = [], sheet: PackTopic[] = [], exam: PackQuestion[] = [];
    DATA.lectures.filter(l => l.course === courseId && DATA.details[l.id]).forEach(l => { const d = DATA.details[l.id];
      d.alerts.forEach(a => hints.push({ ...a, lecture: l.title, lectureId: l.id }));
      d.sections.forEach(s => sheet.push({ topic: s.title, points: s.points.map(p => ({ text: p.text, off: !!p.off, t: p.t, lecture: l.title, lectureId: l.id })) }));
      d.quiz.forEach(q => exam.push({ ...q, lectureId: l.id })); });
    return { status: "ready", hints, sheet, exam };
  },
  /* GET /plans -> {plans:[{id, name, priceText, features[]}], current: planId|null}   empty list = nothing shown */
  async getPlans(): Promise<Plans> { if (!CONFIG.USE_MOCK) return http("GET", "/plans"); return { plans: [], current: null }; },
  /* POST /checkout {planId} -> {url}   the browser is sent to url */
  async startCheckout(planId: string): Promise<UrlReply> { if (!CONFIG.USE_MOCK) return http("POST", "/checkout", { planId }); return { url: null }; },


  /* PATCH /lectures/:id {title?, course?} -- only the fields given are sent; a new course moves the lecture to another of the student's courses */
  async updateLecture(id: string, p: { title?: string; course?: string }): Promise<null> { if (!CONFIG.USE_MOCK) return http("PATCH", "/lectures/" + id, p); await wait(300);
    const l = DATA.lectures.find(x => x.id === id); if (!l) return null;
    if (p.title !== undefined) l.title = p.title;
    if (p.course !== undefined) { const c = DATA.courses.find(x => x.id === p.course); if (c) { l.course = p.course; DATA.upcoming.forEach(u => { if (u.lecture === id) u.course = c.code; }); } }
    return null; },
  /* DELETE /lectures/:id */
  async deleteLecture(id: string): Promise<null> { if (!CONFIG.USE_MOCK) return http("DELETE", "/lectures/" + id); DATA.lectures = DATA.lectures.filter(x => x.id !== id); return null; },
  /* PATCH /courses/:id {code, name} (added after the migration) */
  async updateCourse(id: string, code: string, name: string): Promise<null> { if (!CONFIG.USE_MOCK) return http("PATCH", "/courses/" + id, { code, name }); await wait(300);
    const c = DATA.courses.find(x => x.id === id); if (c) { const ids = new Set(DATA.lectures.filter(l => l.course === id).map(l => l.id)); DATA.upcoming.forEach(u => { if (u.lecture ? ids.has(u.lecture) : u.course === c.code) u.course = code; }); c.code = code; c.name = name; } return null; },
  /* DELETE /courses/:id -- the course and every lecture in it (added after the migration) */
  async deleteCourse(id: string): Promise<null> { if (!CONFIG.USE_MOCK) return http("DELETE", "/courses/" + id); await wait(300);
    const gone = new Set(DATA.lectures.filter(l => l.course === id).map(l => l.id)), code = DATA.courses.find(c => c.id === id)?.code; DATA.courses = DATA.courses.filter(c => c.id !== id); DATA.lectures = DATA.lectures.filter(l => !gone.has(l.id));
    DATA.upcoming = DATA.upcoming.filter(u => u.lecture ? !gone.has(u.lecture) : u.course !== code); gone.forEach(x => delete DATA.details[x]); delete DATA.packs[id]; return null; },
  /* GET /search?q= -> {results:[{lecture, text, t}]}  points in the notes of every lecture, at most 20 (added after the migration).
     Sample build: every word of the query has to be in the point, in any order. */
  async searchNotes(q: string): Promise<SearchReply> { if (!CONFIG.USE_MOCK) return http("GET", "/search?q=" + encodeURIComponent(q)); await wait(250);
    const words = q.toLowerCase().split(/\s+/).filter(Boolean), results: SearchReply["results"] = [];
    DATA.lectures.forEach(l => { const d = DATA.details[l.id]; if (d) d.sections.forEach(s => s.points.forEach(p => { const x = p.text.toLowerCase(); if (words.length && words.every(w => x.includes(w))) results.push({ lecture: l.id, text: p.text, t: p.t }); })); });
    return { results: results.slice(0, 20) }; },
  /* POST /courses/:id/review-pack -> {status} */
  async makeReviewPack(courseId: string): Promise<{ status: string }> { if (!CONFIG.USE_MOCK) return http("POST", "/courses/" + courseId + "/review-pack"); await wait(400); DATA.packs[courseId] = "ready"; return { status: "processing" }; },
  /* PUT /lectures/:id/progress {known:[cardIndex], quizScore} */
  async saveProgress(id: string, p: ProgressUpdate): Promise<null> { if (!CONFIG.USE_MOCK) return http("PUT", "/lectures/" + id + "/progress", p); return null; },
  /* POST /upcoming {course, date, kind, text} -> the date on the exam radar, with its id (added at the retest of 2026-11-23) */
  async addUpcoming(p: { course: string; date: string; kind: string; text: string }): Promise<Upcoming> { if (!CONFIG.USE_MOCK) return http("POST", "/upcoming", p); await wait(250);
    const c = DATA.courses.find(x => x.id === p.course); if (!c) throw new Error("That course does not exist.");
    const u = { date: p.date, kind: p.kind, text: p.text, course: c.code, lecture: null, t: null, id: "rd-" + Date.now().toString(36), day: "", mon: "" }; DATA.upcoming.push(u); return { ...u }; },
  /* DELETE /upcoming/:id -- only a date added by hand */
  async deleteUpcoming(id: string): Promise<null> { if (!CONFIG.USE_MOCK) return http("DELETE", "/upcoming/" + encodeURIComponent(id)); await wait(200); DATA.upcoming = DATA.upcoming.filter(u => u.id !== id); return null; },
  /* PUT /profile {school, major, yearOfStudy, gradYear, origin, consentMarketing, consentSurvey} -> {profile}   every field optional; the
     fields given are saved, the rest kept (API-CHANGES.md 14) */
  async updateProfile(p: ProfileUpdate): Promise<ProfileReply> { if (!CONFIG.USE_MOCK) return http("PUT", "/profile", p); await wait(300);
    const was = DATA.profile || { school: "", major: "", yearOfStudy: "", gradYear: null, origin: "", consentMarketing: false, consentSurvey: false, consentMarketingAt: null, consentSurveyAt: null }, at = new Date().toISOString();
    const mk = p.consentMarketing ?? was.consentMarketing, sv = p.consentSurvey ?? was.consentSurvey;
    DATA.profile = { school: p.school ?? was.school, major: p.major ?? was.major, yearOfStudy: p.yearOfStudy ?? was.yearOfStudy, gradYear: p.gradYear === undefined ? was.gradYear : p.gradYear ? Number(p.gradYear) : null,
      origin: p.origin ?? was.origin, consentMarketing: mk, consentSurvey: sv, consentMarketingAt: DATA.profile && mk === was.consentMarketing ? was.consentMarketingAt : at, consentSurveyAt: DATA.profile && sv === was.consentSurvey ? was.consentSurveyAt : at };
    return { profile: { ...DATA.profile } }; },
  /* POST /profile/later   "Skip for now", kept for the student's other devices */
  async profileLater(): Promise<null> { if (!CONFIG.USE_MOCK) return http("POST", "/profile/later"); await wait(200); return null; },
  /* PUT /settings {name, classLanguage, zhDefault, zhScript:"hant"|"hans"} */
  async updateSettings(p: SettingsUpdate): Promise<null> { if (!CONFIG.USE_MOCK) return http("PUT", "/settings", p); Object.assign(DATA.settings, { classLanguage: p.classLanguage, zhDefault: p.zhDefault, zhScript: p.zhScript }); await wait(300); return null; }
};
