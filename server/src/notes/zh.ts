/* The model writes each Chinese explanation in one script; OpenCC writes the other, so students can switch
   between 繁 and 简 on the lecture page (INTEGRATION.md 3.2: give both zhHant and zhHans). */
import * as OpenCC from "opencc-js";

let toHans: ((s: string) => string) | null = null, toHant: ((s: string) => string) | null = null;

export function bothScripts(text: string, written: "hant" | "hans") {
  if (written === "hant") { toHans ??= OpenCC.Converter({ from: "hk", to: "cn" }); return { zhHant: text, zhHans: toHans(text) }; }
  toHant ??= OpenCC.Converter({ from: "cn", to: "hk" });
  return { zhHant: toHant(text), zhHans: text };
}
