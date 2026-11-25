/* ---------- exam radar dates added by hand (POST /upcoming, DELETE /upcoming/:id) ----------
   The radar used to hold only what lecturers said in class (retest of 2026-11-23: a date the lecturer only posted on the
   course page could not be added). "Add a date" on Home opens this window: the course, what the date is for (the same
   words as the lecturer's dates, so they are translated and coloured alike), the day and a short note. A date added by
   hand says "Added by you" and can be removed; the lecturer's dates link to the moment they were said. */
import type { Upcoming } from "../types";
import { api } from "../api/api";
import { bump } from "../lib/bus";
import { S, today } from "../state/app";
import { act, closeModal, toast } from "../state/overlay";
import { t } from "../i18n";
import { openModal } from "../ui/Overlay";
import { css } from "../ui/css";
import { val } from "../ui/form";

export const RADAR_KINDS = ["Midterm", "Final", "Quiz", "Deadline", "Exam hint"] as const;

export function addDateModal() {
  if (!S.courses.length) { toast("Add a course first."); return; }
  openModal(() => <><h3>{t("Add a date to the exam radar")}</h3><form onSubmit={e => { e.preventDefault(); addDate(e.currentTarget); }}>
    <label className="field"><span>{t("Course")}</span><select name="course" defaultValue={S.courses[0].id}>{S.courses.map(c => <option key={c.id} value={c.id} data-notr="">{c.code}</option>)}</select></label>
    <label className="field"><span>{t("What it is")}</span><select name="kind" defaultValue="Midterm">{RADAR_KINDS.map(k => <option key={k} value={k}>{t(k)}</option>)}</select></label>
    <label className="field"><span>{t("Date")}</span><input name="date" type="date" min={today()} required /></label>
    <label className="field"><span>{t("Note (optional)")}</span><input name="text" maxLength={200} placeholder={t("For example: chapters 1 to 4, closed book")} /></label>
    <div style={css("display:flex;gap:10px;justify-content:flex-end")}><button type="button" className="btn plain" onClick={closeModal}>{t("Cancel")}</button><button className="btn primary">{t("Add to the radar")}</button></div></form></>);
}

function addDate(f: HTMLFormElement) {
  const p = { course: val(f, "course"), kind: val(f, "kind"), date: val(f, "date"), text: val(f, "text").trim() };
  if (!p.date) { toast("Choose the date.", { error: true }); return; }
  act(async () => { const u = await api.addUpcoming(p); S.upcoming = [...S.upcoming, u]; closeModal(); toast("Added to the exam radar"); bump(); });
}

export function removeDate(u: Upcoming) {
  if (!u.id) return;
  act(async () => { await api.deleteUpcoming(u.id!); S.upcoming = S.upcoming.filter(x => x.id !== u.id); toast("Removed from the exam radar"); bump(); });
}
