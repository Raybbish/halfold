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
import { ZH, ZHR } from "./zh";
import { t2s } from "./t2s";
export { t2s };

export type UiLang = "en" | "zh-Hant" | "zh-Hans";
const UI: UiLang[] = ["en", "zh-Hant", "zh-Hans"];
/* A saved choice wins ("zh" from earlier versions is Traditional). With none saved, someone who already uses the app (a session or any other sidenote.* key) stays in English and that is saved; a genuinely first visit follows the browser language. */
function firstLang(): UiLang { const s = store.get("lang"); if (s === "zh") return "zh-Hant"; if (UI.includes(s as UiLang)) return s as UiLang;
  let old = false; try { for (let i = 0; i < localStorage.length; i++) if ((localStorage.key(i) || "").startsWith("sidenote.")) { old = true; break; } } catch (e) {}
  if (old) { store.set("lang", "en"); return "en"; }
  const n = (navigator.language || "en").toLowerCase(); return /^zh/.test(n) ? (/tw|hk|mo|hant/.test(n) ? "zh-Hant" : "zh-Hans") : "en"; }
export let LANG: UiLang = firstLang();
export const isZh = () => LANG !== "en";

export function trs(s: string): string { if (LANG === "en" || !s) return s; const k = s.replace(/\s+/g, " ").trim(); if (!k) return s; let o: string | null | undefined = ZH[k];
  if (o == null) for (const [re, fn] of ZHR) { const m = k.match(re); if (m) { o = fn(m); if (o != null) break; } }
  if (o != null && LANG === "zh-Hans") o = t2s(o);
  return o == null ? s : s.match(/^\s*/)![0] + o + s.match(/\s*$/)![0]; }

/* The interface text of one text node or attribute, in the current language. */
export const t = (s: string) => trs(s);

export function setLang(l: string) { LANG = l === "zh" ? "zh-Hant" : UI.includes(l as UiLang) ? (l as UiLang) : "en"; store.set("lang", LANG); document.documentElement.lang = LANG; bumpAll(); }
