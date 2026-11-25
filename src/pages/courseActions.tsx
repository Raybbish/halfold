/* Editing and deleting a course, from the course page (added after the migration). Deleting a course deletes the
   lectures in it too; the dialog says how many first. */
import { api } from "../api/api";
import { bump } from "../lib/bus";
import { S, course, lecture, nf } from "../state/app";
import { act, closeModal, toast } from "../state/overlay";
import { t } from "../i18n";
import { live } from "../features/recording/recorder";
import { openModal } from "../ui/Overlay";
import { css } from "../ui/css";
import { val } from "../ui/form";

export function editCourseModal(id: string) { const c = course(id); if (!c) return;
  openModal(() => <><h3>{t("Edit course")}</h3><form onSubmit={e => { e.preventDefault(); saveCourse(id, e.currentTarget); }}>
    <label className="field"><span>{t("Course code")}</span><input name="code" defaultValue={c.code} required maxLength={20} /></label>
    <label className="field"><span>{t("Course name")}</span><input name="name" defaultValue={c.name || ""} maxLength={80} /></label>
    <div style={css("display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap")}><button type="button" className="btn plain" style={css("color:var(--red)")} onClick={() => deleteCourseModal(id)}>{t("Delete course")}</button>
      <div style={css("display:flex;gap:10px;margin-left:auto")}><button type="button" className="btn plain" onClick={closeModal}>{t("Cancel")}</button><button className="btn primary">{t("Save course")}</button></div></div></form></>); }

function saveCourse(id: string, f: HTMLFormElement) { const code = val(f, "code").trim(), name = val(f, "name").trim(); if (!code) return;
  act(async () => { await api.updateCourse(id, code, name); const c = course(id);
    /* Dates added by hand carry only the course code: the ones with the old code follow it now, and the home data is read
       again (two courses may share a code). */
    if (c) { const ids = new Set(S.lectures.filter(l => l.course === id).map(l => l.id)); S.upcoming.forEach(u => { if (u.lecture ? ids.has(u.lecture) : u.course === c.code) u.course = code; }); c.code = code; c.name = name; S.homeLoaded = false; }
    closeModal(); toast("Course saved"); bump(); }); }

function deleteCourseModal(id: string) { const c = course(id); if (!c) return;
  const rec = live.active && live.id ? lecture(live.id) : undefined;
  if (rec && rec.course === id) { closeModal(); toast("End the recording before deleting this course."); return; }
  const n = S.lectures.filter(l => l.course === id).length;
  openModal(() => <><h3>{t("Delete " + c.code + "?")}</h3><p className="muted">{t(n === 0 ? "This course has no lectures." : n === 1 ? "The lecture in this course will be deleted too, with its recording, notes, flashcards, quiz and shared link. This cannot be undone." : "The " + n + " lectures in this course will be deleted too, with their recordings, notes, flashcards, quizzes and shared links. This cannot be undone.")}</p>
    <div style={css("display:flex;gap:10px;justify-content:flex-end;margin-top:16px")}><button className="btn plain" onClick={closeModal}>{t("Keep course")}</button><button className="btn dark" onClick={() => doDeleteCourse(id)}>{t("Delete course")}</button></div></>); }

function doDeleteCourse(id: string) { act(async () => { await api.deleteCourse(id);
  const gone = new Set(S.lectures.filter(l => l.course === id).map(l => l.id));
  const code = course(id)?.code; S.homeLoaded = false;   // dates added by hand go with the course; the home data is read again
  S.courses = S.courses.filter(c => c.id !== id); S.lectures = S.lectures.filter(l => !gone.has(l.id)); S.upcoming = S.upcoming.filter(u => u.lecture ? !gone.has(u.lecture) : u.course !== code);
  gone.forEach(x => delete S.detail[x]); delete S.pack[id]; if (nf.courseId === id) nf.courseId = null;
  closeModal(); toast("Course deleted"); location.hash = "#/home"; }); }
