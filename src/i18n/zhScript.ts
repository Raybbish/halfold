/* 中文解釋 can be read in Traditional or Simplified characters. The backend sends both (point.zhHant, point.zhHans) and the
   reader chooses. Signed in, the choice lives in the account settings; otherwise it is remembered on this device.
   Until someone chooses, a browser set to Simplified Chinese starts with Simplified and every other browser with Traditional. */
import type { Point, ZhScript } from "../types";
import { store } from "../lib/store";
import { bump } from "../lib/bus";
import { S } from "../state/app";
import { api } from "../api/api";

export const zhScript = (): ZhScript => ((S.token && S.settings.zhScript) || store.get("zhScript") || (/^zh-(cn|sg|my)\b|^zh-hans/i.test(navigator.language || "") ? "hans" : "hant")) as ZhScript;
export const zhText = (p: Point) => (zhScript() === "hans" ? p.zhHans || p.zhHant : p.zhHant || p.zhHans) || p.zh || "";
export function setZhScript(v: ZhScript) { store.set("zhScript", v);
  if (S.token) { S.settings.zhScript = v; if (S.homeLoaded) api.updateSettings({ name: S.user!.name, classLanguage: S.settings.classLanguage, zhDefault: S.settings.zhDefault, zhScript: v }).catch(() => {}); }
  bump(); }
