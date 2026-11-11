/* ---------- small things kept on this device ----------
   localStorage under the "sidenote." prefix, with an in-memory fallback when storage is blocked.
   Keys in use: session, lang, live, recTip, zhScript. The session itself is read and written in state/app.ts. */
const mem: Record<string, string> = {};
export const store = {
  get(k: string): string | undefined { try { const v = localStorage.getItem("sidenote." + k); return v === null ? mem[k] : v; } catch (e) { return mem[k]; } },
  set(k: string, v: string) { mem[k] = v; try { localStorage.setItem("sidenote." + k, v); } catch (e) {} },
  del(k: string) { delete mem[k]; try { localStorage.removeItem("sidenote." + k); } catch (e) {} }
};
