/* ---------- store: everything the screens read ---------- */
import type { Course, Detail, Lecture, Plans, ReviewPack, Settings, SharedReply, Upcoming, Usage, User, Week } from "../types";
import type { StoredChunk } from "../lib/idb";

export interface Orphan { id: string; code: string; sec: number; chunks: StoredChunk[] }
export interface Store {
  token: string | null; user: User | null; courses: Course[]; lectures: Lecture[]; upcoming: Upcoming[]; week: Week | null;
  settings: Settings; usage: Usage | null; today: string | null; detail: Record<string, Detail | null>; shared: Record<string, SharedReply>;
  pack: Record<string, ReviewPack>; plans: Plans | null; orphan: Orphan | null; homeLoaded: boolean; error: string | null; next: string | null;
  _up?: Upcoming[];
}

export const S: Store = { token: null, user: null, courses: [], lectures: [], upcoming: [], week: null, settings: { classLanguage: "en", zhDefault: false }, usage: null, today: null, detail: {}, shared: {}, pack: {}, plans: null, orphan: null, homeLoaded: false, error: null, next: null };

/* The signed-in state lives in localStorage under sidenote.session as {token, user}. */
export const session = {
  load() { try { const s = JSON.parse(localStorage.getItem("sidenote.session") || "null"); if (s) { S.token = s.token; S.user = s.user; } } catch (e) {} },
  save() { try { localStorage.setItem("sidenote.session", JSON.stringify({ token: S.token, user: S.user })); } catch (e) {} },
  clear() { S.token = null; S.user = null; S.homeLoaded = false; S.detail = {}; S.pack = {}; S.plans = null; S.settings = { classLanguage: "en", zhDefault: false }; try { localStorage.removeItem("sidenote.session"); } catch (e) {} }
};
