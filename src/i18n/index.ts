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

export let LANG: "en" | "zh" = store.get("lang") === "zh" ? "zh" : "en";

export function trs(s: string): string { if (LANG === "en" || !s) return s; const k = s.replace(/\s+/g, " ").trim(); if (!k) return s; let o: string | null | undefined = ZH[k];
  if (o == null) for (const [re, fn] of ZHR) { const m = k.match(re); if (m) { o = fn(m); break; } }
  return o == null ? s : s.match(/^\s*/)![0] + o + s.match(/\s*$/)![0]; }

/* The interface text of one text node or attribute, in the current language. */
export const t = (s: string) => trs(s);

export function setLang(l: string) { LANG = l === "zh" ? "zh" : "en"; store.set("lang", LANG); document.documentElement.lang = LANG === "zh" ? "zh-Hant" : "en"; bumpAll(); }
