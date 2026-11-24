/* ---------- store: everything the screens read ----------
   Module-level objects, as in sidenote.html. Code changes them and then calls bump() (lib/bus.ts) to redraw. */
import type { AskReply, Course, Detail, Lecture, NoteHit, Plans, Point, ReviewCard, ReviewPack, SchoolGuess, Settings, SharedReply, Source, Upcoming, Usage, User, Week } from "../types";
import type { StoredChunk } from "../lib/idb";
import { CONFIG } from "../config";
import { PALETTE, mins, ymd } from "../lib/helpers";
import { LANG } from "../i18n";

export interface Orphan { id: string; code: string; sec: number; chunks: StoredChunk[] }
export interface Store {
  token: string | null; user: User | null; courses: Course[]; lectures: Lecture[]; upcoming: Upcoming[]; week: Week | null;
  settings: Settings; usage: Usage | null; today: string | null; detail: Record<string, Detail | null>; shared: Record<string, SharedReply>;
  pack: Record<string, ReviewPack>; plans: Plans | null; orphan: Orphan | null; homeLoaded: boolean; error: string | null; next: string | null;
  reviewCount: number | null;   // flashcards not marked as known, from GET /home; null when the server does not say
  /* The school the email address points to, from GET /home, to fill in the profile form (pages/Profile.tsx). The profile itself is user.profile. */
  schoolGuess: SchoolGuess | null;
  _up?: Upcoming[];
}

export const S: Store = { token: null, user: null, courses: [], lectures: [], upcoming: [], week: null, settings: { classLanguage: "en", zhDefault: false }, usage: null, today: null, detail: {}, shared: {}, pack: {}, plans: null, orphan: null, homeLoaded: false, error: null, next: null, reviewCount: null, schoolGuess: null };
export const course = (id: string | null | undefined) => S.courses.find(c => c.id === id);
export const lecture = (id: string) => S.lectures.find(l => l.id === id);
export const colorOf = (c: Course | undefined) => (c && c.color) || PALETTE[Math.max(0, S.courses.indexOf(c!)) % PALETTE.length];
/* "ECON 1001, week 9, Tue 10 Nov, 90 min". Passed to t() whole: the Chinese interface turns "week 9" and "90 min" into Chinese. */
export const meta = (l: Lecture, c: Course | undefined) => [c && c.code, l.week && "week " + l.week, l.date, l.duration && mins(l.duration)].filter(Boolean).join(", ");
export const today = () => S.today || ymd(new Date());   // the date where the student is, not the UTC date
export const daysLeft = (d: string) => Math.round((+new Date(d) - +new Date(today())) / 864e5);
export const dayMon = (d: string) => new Date(d).toLocaleDateString(LANG === "zh-Hant" ? "zh-HK" : LANG === "zh-Hans" ? "zh-CN" : "en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
export const exHref = () => CONFIG.EXAMPLE_SHARE_ID ? "#/s/" + encodeURIComponent(CONFIG.EXAMPLE_SHARE_ID) : "";

/* The signed-in state lives in localStorage under sidenote.session as {token, user}. */
export const session = {
  load() { try { const s = JSON.parse(localStorage.getItem("sidenote.session") || "null"); if (s) { S.token = s.token; S.user = s.user; } } catch (e) {} },
  save() { try { localStorage.setItem("sidenote.session", JSON.stringify({ token: S.token, user: S.user })); } catch (e) {} },
  clear() { S.token = null; S.user = null; S.homeLoaded = false; S.detail = {}; S.pack = {}; S.plans = null; S.reviewCount = null; S.settings = { classLanguage: "en", zhDefault: false }; S.schoolGuess = null; try { localStorage.removeItem("sidenote.session"); localStorage.removeItem("sidenote.welcomed"); } catch (e) {} }
};

/* ---------- screen state ---------- */
export type Tab = "notes" | "slides" | "transcript" | "cards" | "quiz" | "ask";
/* The Ask tab: the question sent last, and its answer or why there is none. */
export interface AskState { q: string; busy?: boolean; res?: AskReply; err?: string }
export const state = { tab: "notes" as Tab, onlyOff: false, zh: false, pos: 0, hit: null as number | null, fc: 0, flip: false, known: new Set<number>(), qi: 0, picked: null as number | null, score: 0, done: false, q: "", tq: "", edit: false, order: null as number[] | null, wrong: [] as number[],
  found: null as Point | null, goFound: false, ask: null as AskState | null,
  closed: new Set<number>() };   // topics folded on the notes tab: this page visit only   // found: the point a search result opened, shown marked; goFound: scroll to it once

/* The Review page (#/review): the cards to go through, the one on screen, how many were marked as known on this pass.
   fresh: load the cards again on the next visit even when the route has not changed ("Go through the rest again"). */
export const rv = { cards: [] as ReviewCard[], i: 0, flip: false, known: 0, total: 0, fresh: false };

/* The current route, #/a/b. route() updates it in place. */
export const R = { a: "", b: "" };

/* The lecture on screen (lecture page or shared page). Set while the page is drawn, read by the actions and the player. */
export interface Cur { l: Lecture; c: Course | undefined; d: Detail | null | undefined; shared: boolean }
export let cur: Cur | null = null;
export function setCur(c: Cur) { cur = c; }

/* A timestamp link elsewhere (exam radar, review pack) opens the lecture with the recording at that second. */
export let pendingPos = 0;
export function setPendingPos(t: number) { pendingPos = t; }
/* A search result on the home page opens the lecture at that point of the notes (added after the migration). */
export let pendingPoint: NoteHit | null = null;
export function setPendingPoint(h: NoteHit | null) { pendingPoint = h; }
/* The point a search result means: the same text, or else the same timestamp. */
export const findPoint = (d: Detail, h: NoteHit): Point | null => { const all = d.sections.flatMap(s => s.points);
  return all.find(p => p.text === h.text) || (h.t != null ? all.find(p => p.t === h.t) : undefined) || null; };

/* What #app shows while route() is loading. "blank" until the first route; null = the page itself. */
export const view = { loader: "blank" as "blank" | "shell" | "center" | null };

/* Sign-in form. A redraw used to clear the inputs, so what was typed is kept here (React keeps it now as well). */
export const auth = { err: "", busy: false, code: "", name: "",
  /* SIGN_IN "email": the address and the code typed, which step is shown, whether the server asked for an invite code
     (invite: it answered 403) and what it said when the address is new to Halfold (need, shown as a note, not as an error).
     Kept as they are typed: every redraw draws the form anew. */
  email: "", otp: "", step: "email" as "email" | "code", invite: false, need: "" };

/* New lecture form. */
export const nf = { mode: "record" as Source, courseId: null as string | null, title: "", lang: null as string | null, file: null as File | null, slides: null as File | null, link: "", err: "", busy: false };
export const LANGS = [["en", "English"], ["en-yue", "English with Cantonese"], ["en-zh", "English with Mandarin"], ["auto", "Detect automatically"]] as const;
