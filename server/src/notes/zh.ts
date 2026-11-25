/* The model writes each Chinese explanation in one script; OpenCC writes the other, so students can switch
   between 繁 and 简 on the lecture page (INTEGRATION.md 3.2: give both zhHant and zhHans). */
import * as OpenCC from "opencc-js";

let toHans: ((s: string) => string) | null = null, toHant: ((s: string) => string) | null = null;

/* Speech-to-text writes Cantonese in Simplified characters; students in Hong Kong read Traditional. OpenCC gets 系 right
   in most phrases (就係, 關係, 經濟系) but not in a few spoken Cantonese ones, fixed here. */
const CANTONESE_HAI = /(即|唔|都|但|真|只|而|先|又|仲|就)系|系(咪|唔系|咗|嘅|度|喇|呀|啊|嘛|囉|咩|就)/g;
let cnToHk: ((s: string) => string) | null = null;
export function cantoneseTraditional(text: string) {
  cnToHk ??= OpenCC.Converter({ from: "cn", to: "hk" });
  return cnToHk(text).replace(CANTONESE_HAI, m => m.replace(/系/g, "係"));
}

export function bothScripts(text: string, written: "hant" | "hans") {
  if (written === "hant") { toHans ??= OpenCC.Converter({ from: "hk", to: "cn" }); return { zhHant: text, zhHans: toHans(text) }; }
  toHant ??= OpenCC.Converter({ from: "cn", to: "hk" });
  return { zhHant: toHant(text), zhHans: text };
}

/* Traditional when OpenCC would change it into Simplified. */
function isTraditional(text: string) { toHans ??= OpenCC.Converter({ from: "hk", to: "cn" }); return toHans(text) !== text; }

/* A point's explanation in both scripts. The model writes both, each in its own usage (notes/prompt.ts): converting one
   into the other keeps the wrong words (联储局 for 美联储). When it gave only one, or the single "zh" of older replies,
   OpenCC writes the other. Nothing given: none. */
export function zhForms(p: { zhHans?: string | null; zhHant?: string | null; zh?: string | null }): { zhHant?: string; zhHans?: string } {
  const hans = p.zhHans?.trim(), hant = p.zhHant?.trim(), one = p.zh?.trim();
  if (hans && hant) return { zhHant: hant, zhHans: hans };
  if (hans) return bothScripts(hans, "hans");
  if (hant) return bothScripts(hant, "hant");
  if (one) return bothScripts(one, isTraditional(one) ? "hant" : "hans");
  return {};
}
