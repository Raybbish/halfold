/* ---------- downloads made in the browser ----------
   Markdown notes, Anki flashcards, the transcript as text, print to PDF, and exam dates as calendar files. */
import { fmt, oneLine, slug } from "../lib/helpers";
import { bump } from "../lib/bus";
import { S, cur, state } from "../state/app";
import { closeModal, toast } from "../state/overlay";
import { zhText } from "../i18n/zhScript";

export function download(name: string, text: string, type: string) { const a = document.createElement("a"), url = URL.createObjectURL(new Blob([text], { type: type + ";charset=utf-8" })); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 4000); toast("Downloaded " + name); }
export function notesMarkdown() { const { l, c } = cur!, d = cur!.d!; let o = "# " + l.title + "\n\n" + [c && c.code, l.date].filter(Boolean).join(", ") + "\n";
  if (d.summary && d.summary.length) o += "\n## In short\n\n" + d.summary.map(x => "- " + x).join("\n") + "\n";
  if (d.alerts.length) o += "\n## Dates and exam hints\n\n" + d.alerts.map(a => "- **" + a.kind + "** (" + fmt(a.t) + "): " + a.text).join("\n") + "\n";
  d.sections.forEach(s => { o += "\n## " + s.title + (s.slides ? " (" + s.slides + ")" : "") + "\n\n" + s.points.map(p => "- " + (p.t != null ? "[" + fmt(p.t) + "] " : "") + (p.off ? "**Halfold:** " : "") + p.text + (zhText(p) ? "\n  - " + zhText(p) : "")).join("\n") + "\n"; });
  return o; }
export function doExport(f: "pdf" | "md" | "anki" | "txt") { const { l, c } = cur!, d = cur!.d!, base = slug((c ? c.code + " " : "") + l.title); closeModal();
  if (f === "pdf") { Object.assign(state, { tab: "notes", onlyOff: false, edit: false, closed: new Set() }); bump(); setTimeout(() => window.print(), 200); return; }   // every topic open: a folded one would print without its notes
  if (f === "anki") return download(base + "-flashcards.txt", d.flashcards.map(x => oneLine(x.q) + "\t" + oneLine(x.a)).join("\n"), "text/plain");
  if (f === "txt") return download(base + "-transcript.txt", d.transcript.map(s => "[" + fmt(s.t) + "] " + s.text).join("\n\n"), "text/plain");
  download(base + "-notes.md", notesMarkdown(), "text/markdown"); }
export function addToCalendar(i: number) { const u = S._up![i], d = u.date.replace(/-/g, ""), next = new Date(new Date(u.date).getTime() + 864e5).toISOString().slice(0, 10).replace(/-/g, ""), e = (s: string) => String(s).replace(/([,;\\])/g, "\\$1").replace(/\n/g, "\\n");
  download(slug(u.course + " " + u.kind) + ".ics", ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Halfold//EN", "BEGIN:VEVENT", "UID:" + u.lecture + "-" + u.t + "@halfnote", "DTSTAMP:" + new Date().toISOString().replace(/[-:]|\.\d+/g, ""), "DTSTART;VALUE=DATE:" + d, "DTEND;VALUE=DATE:" + next, "SUMMARY:" + e(u.course + " " + u.kind), "DESCRIPTION:" + e(u.text), "END:VEVENT", "END:VCALENDAR"].join("\r\n"), "text/calendar"); }
