/* =====================================================================
   INTERFACE LANGUAGE
   Screens are written in English. sidenote.html swapped the text on the page
   for 繁體中文 after each render; here every interface string goes through
   t() while it is rendered. t() is the old trs(): the same ZH and ZHR tables,
   the same whitespace handling. Build whole sentences before calling t(), so
   the ZHR patterns still match ("Hi " + name, not t("Hi") + name).
   Content from the backend is never passed to t(); elements that hold it keep
   their data-notr attribute, as before.
   ===================================================================== */
import { store } from "../lib/store";
import { bumpAll } from "../lib/bus";
import { SERVER, ZH, ZHR } from "./zh";
import { t2s } from "./t2s";
export { t2s };

export type UiLang = "en" | "zh-Hant" | "zh-Hans";
const UI: UiLang[] = ["en", "zh-Hant", "zh-Hans"];
/* A saved choice wins ("zh" from earlier versions is Traditional). With none saved, someone who already uses the app (a session or any other sidenote.* key) stays in English and that is saved; a genuinely first visit follows the browser language. */
function firstLang(): UiLang { const s = store.get("lang"); if (s === "zh") return "zh-Hant"; if (UI.includes(s as UiLang)) return s as UiLang;
  let old = false; try { for (let i = 0; i < localStorage.length; i++) if ((localStorage.key(i) || "").startsWith("sidenote.")) { old = true; break; } } catch (e) {}
  if (old) { store.set("lang", "en"); return "en"; }
  const n = (navigator.language || "en").toLowerCase(), r: UiLang = /^zh/.test(n) ? (/tw|hk|mo|hant/.test(n) ? "zh-Hant" : "zh-Hans") : "en"; store.set("lang", r); return r; }
export let LANG: UiLang = firstLang();
export const isZh = () => LANG !== "en";

export function trs(s: string): string { if (LANG === "en" || !s) return s; const k = s.replace(/\s+/g, " ").trim(); if (!k) return s; let o: string | null | undefined = ZH[k];
  if (o == null) o = rule(k); else if (LANG === "zh-Hans") o = t2s(o);
  return o == null ? s : s.match(/^\s*/)![0] + o + s.match(/\s*$/)![0]; }
/* A rule sentence (ZHR). In Simplified only the sentence's own words are converted, never what it carries from the backend
   ("Hi " + a name, a course code, a meta line): every non-ASCII character of the matched text is swapped for a private-use
   stand-in before the rule runs (the rules only look into the ASCII parts: numbers and English words) and put back after t2s(). */
function rule(k: string): string | null {
  for (const [re, fn] of ZHR) { const m = k.match(re); if (!m) continue;
    if (LANG !== "zh-Hans") { const o = fn(m); if (o != null) return o; continue; }
    const kept: string[] = [], hide = (ch: string) => { let i = kept.indexOf(ch); if (i < 0) i = kept.push(ch) - 1; return String.fromCharCode(0xE000 + i); };
    const o = fn(Object.assign(Array.from(m, g => g == null ? g : Array.from(g, ch => ch < "\u0080" ? ch : hide(ch)).join("")), { index: m.index, input: m.input }) as RegExpMatchArray);
    if (o != null) return Array.from(t2s(o), ch => { const i = ch.charCodeAt(0) - 0xE000; return i >= 0 && i < kept.length ? kept[i] : ch; }).join(""); }
  return null; }

/* A sentence from the backend (a failed lecture's reason): in the interface language when it is one of our server's own
   (SERVER in zh.ts), anything else exactly as it was sent. */
export const serverText = (s: string) => Object.prototype.hasOwnProperty.call(SERVER, s) ? trs(s) : s;

/* The interface text of one text node or attribute, in the current language. */
export const t = (s: string) => trs(s);

export function setLang(l: string) { LANG = l === "zh" ? "zh-Hant" : UI.includes(l as UiLang) ? (l as UiLang) : "en"; store.set("lang", LANG); document.documentElement.lang = LANG; bumpAll(); }
