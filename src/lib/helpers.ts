/* ---------- small helpers ----------
   $ and esc() from sidenote.html are gone: pages are React components and React escapes text itself. */
export const wait = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
export const fmt = (t: number) => { const m = Math.floor(t / 60), s = Math.floor(t % 60); return m + ":" + String(s).padStart(2, "0"); };
export const mins = (t: number) => Math.round(t / 60) + " min";
export const plural = (n: number, w: string) => n + " " + w + (n === 1 ? "" : "s");
export const mb = (b: number) => (b / 1048576).toFixed(1) + " MB";
export const PALETTE = ["#FF6B57", "#7A5AF8", "#19B88A", "#2B59FF", "#E0B400"];
export const ymd = (d: Date) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
export const slug = (s: string) => String(s).toLowerCase().replace(/[^a-z0-9一-鿿]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "lecture";
export const oneLine = (s: string) => String(s).replace(/\s+/g, " ").trim();
