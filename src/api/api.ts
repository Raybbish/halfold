/* Every network call goes through `api`. Each function has a mock branch (answers from DATA) and a real branch
   (calls http()). Keep the return shapes and the screens need no other change. Paths are suggestions, see
   reference/INTEGRATION.md section 2. */
import { CONFIG } from "../config";
import { wait } from "../lib/helpers";
import { S } from "../state/app";
import { http, form1 } from "./http";
import { DATA } from "./mock";
import type {
  CatchUpReply, ChunkReply, Course, Home, Lecture, LectureReply, NewLecture, Plans, Point, ProgressUpdate,
  ReviewPack, SessionReply, SettingsUpdate, SharedReply, StatusReply, UrlReply, PackHint, PackTopic, PackQuestion
} from "../types";

export const api = {
  /* POST /session {inviteCode, name} -> {token, user:{name}} */
  async signIn(inviteCode: string, name: string): Promise<SessionReply> {
    if (!CONFIG.USE_MOCK) return http("POST", "/session", { inviteCode, name }, true);
    await wait(400); if (!inviteCode.trim()) throw new Error("Enter your invite code.");
    return { token: "mock-token", user: { name: name.trim() || DATA.user.name } };
  },
  /* GET /home -> {user, courses[], lectures[], upcoming[], week, settings, usage, today?} */
  async getHome(): Promise<Home> {
    if (!CONFIG.USE_MOCK) return http("GET", "/home");
    await wait(250);
    return { user: S.user || DATA.user, courses: DATA.courses.slice(), lectures: DATA.lectures.slice(), upcoming: DATA.upcoming.slice() as Home["upcoming"], week: DATA.week, settings: { ...DATA.settings },
      usage: { minutesToday: DATA.user.minutesToday, minutesLimit: DATA.user.minutesLimit }, today: "2026-11-11" };
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
  /* POST /lectures {courseId, title, language, source:"record"|"tab"|"upload"|"link"} -> lecture */
  async createLecture(p: NewLecture): Promise<Lecture> {
    if (!CONFIG.USE_MOCK) return http("POST", "/lectures", p);
    const l: Lecture = { id: "lec-" + Date.now().toString(36), course: p.courseId, title: p.title || "Untitled lecture", date: "Today", duration: 0, status: "recording" };
    DATA.lectures.unshift(l); DATA.feed = 0; return l;
  },
  /* POST /lectures/:id/chunks (multipart: audio, seq) -> {segments:[{t,text}], alerts:[{t,kind,text}]} */
  async uploadChunk(id: string, blob: Blob, seq: number): Promise<ChunkReply> {
    if (!CONFIG.USE_MOCK) return http("POST", "/lectures/" + id + "/chunks", form1("audio", blob, { seq }));
    return { segments: [], alerts: [] };
  },
  /* POST /lectures/:id/recording (multipart: file) */
  async uploadRecording(id: string, file: File): Promise<null> { if (!CONFIG.USE_MOCK) return http("POST", "/lectures/" + id + "/recording", form1("file", file)); await wait(900); return null; },
  /* POST /lectures/:id/slides (multipart: file, PDF) */
  async uploadSlides(id: string, file: File): Promise<null> { if (!CONFIG.USE_MOCK) return http("POST", "/lectures/" + id + "/slides", form1("file", file)); await wait(300); return null; },
  /* POST /lectures/:id/link {url} */
  async attachLink(id: string, url: string): Promise<null> { if (!CONFIG.USE_MOCK) return http("POST", "/lectures/" + id + "/link", { url }); await wait(600); return null; },
  /* POST /lectures/:id/catch-up -> {points:[string]}   summary of the last five minutes of a live recording */
  async catchUp(id: string, seen: number[]): Promise<CatchUpReply> {
    if (!CONFIG.USE_MOCK) return http("POST", "/lectures/" + id + "/catch-up");
    await wait(700); const pts = DATA.detail.sections.flatMap(s => s.points).filter(p => seen.includes(p.t as number)).slice(-3).map(p => p.text);
    return { points: pts.length ? pts : ["Nothing to summarise yet. The lecturer has only covered announcements."] };
  },
  /* POST /lectures/:id/finish {duration} -> {status} */
  async finishLecture(id: string, duration: number): Promise<StatusReply> {
    if (!CONFIG.USE_MOCK) return http("POST", "/lectures/" + id + "/finish", { duration });
    let l = DATA.lectures.find(x => x.id === id); if (!l) { l = { id, course: DATA.courses[0].id, title: "Recovered recording", date: "Today" }; DATA.lectures.unshift(l); } l.status = "processing"; l.duration = 5400; return { status: "processing" };
  },
  /* GET /lectures/:id/status -> {status:"processing"|"ready"|"failed"} */
  async getStatus(id: string): Promise<StatusReply> {
    if (!CONFIG.USE_MOCK) return http("GET", "/lectures/" + id + "/status");
    await wait(1500); const l = DATA.lectures.find(x => x.id === id); if (l) l.status = "ready"; DATA.details[id] = DATA.detail; return { status: "ready" };
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


  /* PATCH /lectures/:id {title} */
  async renameLecture(id: string, title: string): Promise<null> { if (!CONFIG.USE_MOCK) return http("PATCH", "/lectures/" + id, { title }); const l = DATA.lectures.find(x => x.id === id); if (l) l.title = title; return null; },
  /* DELETE /lectures/:id */
  async deleteLecture(id: string): Promise<null> { if (!CONFIG.USE_MOCK) return http("DELETE", "/lectures/" + id); DATA.lectures = DATA.lectures.filter(x => x.id !== id); return null; },
  /* POST /courses/:id/review-pack -> {status} */
  async makeReviewPack(courseId: string): Promise<{ status: string }> { if (!CONFIG.USE_MOCK) return http("POST", "/courses/" + courseId + "/review-pack"); await wait(400); DATA.packs[courseId] = "ready"; return { status: "processing" }; },
  /* PUT /lectures/:id/progress {known:[cardIndex], quizScore} */
  async saveProgress(id: string, p: ProgressUpdate): Promise<null> { if (!CONFIG.USE_MOCK) return http("PUT", "/lectures/" + id + "/progress", p); return null; },
  /* PUT /settings {name, classLanguage, zhDefault, zhScript:"hant"|"hans"} */
  async updateSettings(p: SettingsUpdate): Promise<null> { if (!CONFIG.USE_MOCK) return http("PUT", "/settings", p); Object.assign(DATA.settings, { classLanguage: p.classLanguage, zhDefault: p.zhDefault, zhScript: p.zhScript }); await wait(300); return null; }
};
