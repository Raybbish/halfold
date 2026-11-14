/* Database rows -> the shapes the front end reads (src/types.ts). */
import type { Course, Home, Lecture } from "../../src/types";
import type { Config } from "./config";
import type { CourseRow, LectureRow, Store, UserRow } from "./db";
import { displayDate, localDate } from "./time";

export function courseView(c: CourseRow): Course {
  return { id: c.id, code: c.code, name: c.name, ...(c.color ? { color: c.color } : {}) };
}

export function lectureView(l: LectureRow, timeZone: string, now = new Date()): Lecture {
  const duration = l.duration ?? l.client_duration;
  return {
    id: l.id, course: l.course_id, title: l.title, date: displayDate(l.created_at, timeZone, now),
    ...(duration != null ? { duration: Math.round(duration) } : {}), status: l.status, shareUrl: l.share_url ?? null
  };
}

/* Seconds of live recording (record, tab) in the lectures the student started today, for the daily limit. Uploads do not
   count. A recording in progress counts the audio received so far; a finished one its real length. */
export function liveSecondsToday(store: Store, userId: string, timeZone: string, now = new Date()) {
  const today = localDate(now, timeZone), since = new Date(now.getTime() - 36 * 3600 * 1000).toISOString();
  return store.liveLecturesSince(userId, since).filter(l => localDate(new Date(l.created_at), timeZone) === today)
    .reduce((n, l) => n + (l.duration ?? (l.live_audio > 0 ? l.live_audio : l.client_duration ?? 0)), 0);
}
export function liveMinutesToday(store: Store, userId: string, timeZone: string, now = new Date()) {
  return Math.round(liveSecondsToday(store, userId, timeZone, now) / 60);
}

export function homeView(store: Store, config: Config, user: UserRow, now = new Date()): Home {
  const today = localDate(now, config.timezone);
  return {
    user: { name: user.name },
    courses: store.courses(user.id).map(courseView),
    lectures: store.lectures(user.id).map(l => lectureView(l, config.timezone, now)),
    upcoming: store.upcoming(user.id, today).map(u => ({ date: u.date, kind: u.kind, text: u.text, course: u.course_code, lecture: u.lecture_id, t: u.t })),
    settings: { classLanguage: user.class_language, zhDefault: !!user.zh_default, ...(user.zh_script === "hant" || user.zh_script === "hans" ? { zhScript: user.zh_script } : {}) },
    usage: { minutesToday: liveMinutesToday(store, user.id, config.timezone, now), minutesLimit: config.dailyLiveMinutes,
      ...(config.audioKeepDays > 0 ? { audioDays: config.audioKeepDays } : {}) },
    today
  };
}
