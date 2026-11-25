/* SAMPLE DATA: used only by the mock branches of `api`. Times are seconds from the start of the recording.
   The data itself is in sample.ts (lines 460-537 of sidenote.html, copied as they are), which the server reads too. */
import type { Course, Detail, Lecture, Profile, Settings, Slide, Upcoming, Week } from "../types";
import { abortError, type UploadOptions } from "./http";
import { SAMPLE } from "./sample";

interface MockLecture extends Lecture { full?: boolean; unshared?: boolean }
interface MockUpcoming extends Omit<Upcoming, "date"> { day: string; mon: string; date?: string }   // a date added by hand: id, no lecture
interface MockDetail extends Detail { slides: (Slide & { section?: number })[] }
export interface MockData {
  user: { name: string; minutesToday: number; minutesLimit: number };
  courses: Course[];
  lectures: MockLecture[];
  upcoming: MockUpcoming[];
  detail: MockDetail;
  /* filled in by mockDb.prep() */
  details: Record<string, Detail>;
  week: Week;
  settings: Settings;
  profile: Profile | null;   // the sample student's profile, already saved, so the sample build does not stop at the profile step
  feed: number;
  packs: Record<string, string>;
}

export const DATA = SAMPLE as unknown as MockData;

/* Sample build only: an upload of `size` bytes that takes `ms`, reports progress in ten steps and can be cancelled. */
export async function fakeUpload(size: number, ms: number, opts: UploadOptions) {
  for (let i = 1; i <= 10; i++) {
    if (opts.signal && opts.signal.aborted) throw abortError();
    await new Promise(r => setTimeout(r, ms / 10));
    if (opts.signal && opts.signal.aborted) throw abortError();
    if (opts.onProgress) opts.onProgress(Math.round(size * i / 10), size);
  }
}

export const mockDb = {
  ready: false,
  prep() {
    if (this.ready) return; this.ready = true;
    const d = DATA.detail; d.slides = []; d.audio = { url: null };   // no audio file in the sample build: see silentClock()
    /* Sample build only: give every sample explanation both forms. The table covers just the characters the sample text uses; a real backend sends zhHant and zhHans itself. */
    const T = "机機会會弃棄个個选選项項价價来來隐隱读讀学學费費没沒赚賺资資样樣响響决決无無论論么麼应應虑慮门門钱錢经經较較边邊际際单單额額时時产產现現术術两兩种種组組横橫轴軸递遞内內济濟长長绝絕对對优優势勢题題国國师師强強调調见見错錯误誤贸貿条條间間换換双雙获獲试試类類周週讲講给給与與课課“「”」";
    const toHant = (s: string) => s.replace(/[^\x00-\x7f]/g, ch => { const i = T.indexOf(ch); return i >= 0 && i % 2 === 0 ? T[i + 1] : ch; });
    d.sections.forEach(s => s.points.forEach(p => { if (p.zh) { p.zhHans = p.zh; p.zhHant = toHant(p.zh); delete p.zh; } }));
    d.sections.forEach((s, si) => { const m = s.slides!.match(/(\d+)\D+(\d+)/)!, a = +m[1], b = +m[2];
      for (let n = a; n <= b; n++) d.slides.push({ n, title: s.title, section: si, image: null });
      s.points.forEach((p, k) => { p.slide = a + Math.floor(k * (b - a + 1) / s.points.length); }); });
    DATA.upcoming.forEach(u => { u.date = "2026-11-" + u.day; });
    DATA.details = { "econ-w9": d };
    DATA.week = { lectures: 4, known: 23, quiz: 86, days: [1, 1, 1, 0, 0] };
    DATA.settings = { classLanguage: "en", zhDefault: true };
    DATA.profile = { school: "HKUST", major: "Economics", yearOfStudy: "y2", gradYear: new Date().getFullYear() + 2, origin: "", consentMarketing: false, consentSurvey: false, consentMarketingAt: null, consentSurveyAt: null };
    DATA.feed = 0; DATA.packs = {};
  }
};

/* Slides in sample mode (added after the migration). Notes made for a lecture whose slides were never sent come without
   slides, as a real backend would make them; sending slides later files the existing points under them. Kept apart from
   DATA so the sample data itself stays as it was in sidenote.html. */
export const mockSlides = new Set<string>();   // lectures whose slides were sent in this session
export function withoutSlides(d: Detail): Detail {
  return { ...d, slides: [], sections: d.sections.map(s => { const c = { ...s, points: s.points.map(p => ({ ...p, slide: null, off: false })) }; delete c.slides; return c; }) };
}
/* Keeps the points as they are (text, edits, points the student added) and gives each one the slide it belongs to,
   found by its timestamp in the full sample notes. */
export function fileUnderSlides(d: Detail): Detail {
  const full = DATA.detail;
  return { ...d, slides: full.slides, sections: d.sections.map((s, i) => { const f = full.sections[i];
    return { ...s, ...(f && f.slides ? { slides: f.slides } : {}), points: s.points.map(p => { const fp = f && p.t != null ? f.points.find(x => x.t === p.t) : undefined; return fp ? { ...p, slide: fp.slide, off: fp.off } : p; }) }; }) };
}
