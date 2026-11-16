/* What the buttons on the lecture page do. The same functions as in sidenote.html, with render() written bump()
   and the dialogs written as JSX. */
import { CONFIG } from "../../config";
import { api } from "../../api/api";
import { bump } from "../../lib/bus";
import { R, S, course, cur, dayMon, state, type Tab } from "../../state/app";
import { act, busy, closeModal, toast, uploadDialog, uploadProgress } from "../../state/overlay";
import { route } from "../../state/router";
import { t } from "../../i18n";
import { pl, plPlay, plSeek, segAt } from "../../features/player/player";
import { doExport } from "../../features/export";
import { pollNotes } from "../../features/recording/finish";
import { holdWatch } from "../../features/notes/watch";
import { forgetOrphan } from "../../features/recording/orphan";
import { openModal } from "../../ui/Overlay";
import { css } from "../../ui/css";
import { val } from "../../ui/form";

const C = () => cur!, D = () => cur!.d!;

/* Every timestamp opens the transcript at that line (when there is one) and starts the recording from there (when there is one). */
export function jump(t: number) { const list = D().transcript; state.pos = t; state.tq = ""; plSeek(t);
  if (list.length) { const seg = segAt(t) || list[0]; state.hit = seg.t; state.tab = "transcript"; bump(); const el = document.getElementById("seg-" + seg.t); if (el) el.scrollIntoView({ block: "center", behavior: "smooth" }); } else bump();
  plPlay(); }
export function setTab(k: Tab) {
  state.tab = k; if (k === "transcript" && pl.a) { const s = segAt(state.pos); if (s) state.hit = s.t; }
  bump();
  const top = document.getElementById("tabtop"), y = top ? top.getBoundingClientRect().top : 0; if (y < 0) window.scrollBy(0, y);   // the tabs stick on phones: start the new tab from its top
}
export function refreshLecture() { delete S.detail[R.b]; route(); }
export function progress() { if (!C().shared) api.saveProgress(C().l.id, { known: [...state.known], quizScore: state.done ? state.score : null }).catch(() => {}); }
export function card(d: number) { const n = D().flashcards.length; state.fc = (state.fc + d + n) % n; state.flip = false; bump(); }
export function know() { state.known.add(state.fc); progress(); card(1); }

/* ---------- quiz ---------- */
export function quizOrder() { return state.order || D().quiz.map((_, i) => i); }
export function pick(i: number) { if (state.picked !== null || state.done) return; const o = quizOrder(), q = D().quiz[o[state.qi]]; if (!q || i >= q.opts.length) return; state.picked = i; if (i === q.a) state.score++; else state.wrong.push(o[state.qi]); bump(); }
export function nextQ() { if (state.picked === null) return; if (state.qi + 1 < quizOrder().length) { state.qi++; state.picked = null; } else { state.done = true; progress(); } bump(); }
export function restartQuiz() { Object.assign(state, { qi: 0, picked: null, score: 0, done: false, order: null, wrong: [] }); bump(); }
export function retryMissed() { Object.assign(state, { order: state.wrong.slice(), qi: 0, picked: null, score: 0, done: false, wrong: [] }); bump(); }

/* Arrow keys and Space for flashcards, 1 to 9 and Enter for the quiz. Registered once in main.tsx. */
export function onLectureKey(e: KeyboardEvent) {
  const tag = (e.target as Element).tagName;
  if (!cur || !cur.d || (R.a !== "lecture" && R.a !== "s") || document.getElementById("overlay")!.firstChild || /INPUT|TEXTAREA|SELECT/.test(tag) || e.metaKey || e.ctrlKey || e.altKey) return;
  if (state.tab === "cards") { if (e.key === "ArrowRight") card(1); else if (e.key === "ArrowLeft") card(-1); else if (e.key === " " && tag !== "BUTTON") { e.preventDefault(); state.flip = !state.flip; bump(); } }
  else if (state.tab === "quiz" && !state.done) { if (/^[1-9]$/.test(e.key)) pick(+e.key - 1); else if (e.key === "Enter" && tag !== "BUTTON") nextQ(); }
}

/* ---------- More menu: exports, add slides, edit title and course, delete ---------- */
export function moreMenu() { const au = C().d && C().d!.audio; openModal(() => <><h3 data-notr="">{C().l.title}</h3>{au && au.keptUntil && !au.expired ? <p className="small muted" style={css("margin-top:6px")}>{t("Recording kept until " + dayMon(au.keptUntil) + ".")}</p> : null}
  <div style={css("display:grid;gap:8px;margin-top:14px")}><button className="btn plain" onClick={() => doExport("pdf")}>{t("Print or save notes as PDF")}</button><button className="btn plain" onClick={() => doExport("md")}>{t("Download notes as Markdown")}</button><button className="btn plain" onClick={() => doExport("anki")}>{t("Download flashcards for Anki")}</button><button className="btn plain" onClick={() => doExport("txt")}>{t("Download transcript as text")}</button>{C().d && C().d!.audio && C().d!.audio!.url ? <a className="btn plain" href={C().d!.audio!.url!} download="">{t("Download recording")}</a> : null}
    {C().d && !C().d!.slides.length ? <button className="btn plain" onClick={() => { closeModal(); pickSlides(); }}>{t("Add slides")}</button> : null}<button className="btn plain" onClick={detailsModal}>{t("Edit title and course")}</button><button className="btn plain" style={css("color:var(--red)")} onClick={deleteModal}>{t("Delete lecture")}</button></div></>); }
/* One dialog for the title and the course. Only what changed is sent. A new course drops the review packs of both courses
   from the store, so they load again with the lecture in its new place, and the exam dates of the lecture follow it. With
   one course there is no list to choose from. */
export function detailsModal() { const l = C().l;
  openModal(() => <><h3>{t("Edit title and course")}</h3><form onSubmit={e => { e.preventDefault(); doDetails(e.currentTarget); }}><label className="field"><span>{t("Title")}</span><input name="t" defaultValue={l.title} required maxLength={120} data-notr="" /></label>
    {S.courses.length > 1 ? <label className="field"><span>{t("Course")}</span><select name="c" defaultValue={l.course} data-notr="">{S.courses.map(c => <option key={c.id} value={c.id}>{c.code + (c.name ? ", " + c.name : "")}</option>)}</select></label> : null}
    <div style={css("display:flex;gap:10px;justify-content:flex-end")}><button type="button" className="btn plain" onClick={closeModal}>{t("Cancel")}</button><button className="btn primary">{t("Save changes")}</button></div></form></>); }
function doDetails(f: HTMLFormElement) { const l = C().l, title = val(f, "t").trim(), sel = f.elements.namedItem("c"), courseId = sel ? val(f, "c") : l.course;
  if (!title) return;
  const p: { title?: string; course?: string } = {}; if (title !== l.title) p.title = title; if (courseId !== l.course) p.course = courseId;
  if (!p.title && !p.course) { closeModal(); return; }
  act(async () => { const from = l.course, to = course(courseId); await api.updateLecture(l.id, p);
    if (p.title) l.title = title;
    if (p.course) { l.course = courseId; if (to) S.upcoming.forEach(u => { if (u.lecture === l.id) u.course = to.code; }); delete S.pack[from]; delete S.pack[courseId]; }
    closeModal(); toast(p.course && to ? "Moved to " + to.code : "Changes saved"); bump(); }); }
/* ---------- adding slides after the lecture (added after the migration) ----------
   For a lecture whose notes were made without slides. The PDF is sent with the same upload as on New lecture (progress
   bar, Cancel); the backend then files the existing points under the slides, keeping the student's own notes and edits,
   and reports "processing" until that is done. The lecture is read again at the end: if it still has no slides, adding
   them failed and the notes are as they were. This keeps its locked dialogs and its own polling; meanwhile the background
   check of notes (features/notes/watch.ts) is held off this lecture, so it is never polled twice. */
export function pickSlides() {
  const old = document.getElementById("slidesPick"); if (old) old.remove();   // left over when the last picker was closed without a file
  const i = document.createElement("input"); i.type = "file"; i.accept = "application/pdf,.pdf"; i.id = "slidesPick"; i.hidden = true;
  i.onchange = () => { const f = i.files && i.files[0]; i.remove(); if (f) addSlides(f); };
  document.body.appendChild(i); i.click();
}
function addSlides(f: File) {
  if (!/pdf$/i.test(f.type || f.name)) { toast("Slides need to be a PDF."); return; }
  if (f.size > CONFIG.MAX_UPLOAD_MB * 1048576) { toast("That file is larger than " + CONFIG.MAX_UPLOAD_MB + " MB."); return; }
  const id = C().l.id, stop = new AbortController();
  act(async () => { holdWatch(id, true); try {
    uploadDialog(f.size, () => stop.abort());
    try { await api.uploadSlides(id, f, { signal: stop.signal, onProgress: (sent, of) => uploadProgress(f.size * sent / of, f.size) }); }
    catch (e) { if ((e as Error).name !== "AbortError") throw e; closeModal(); toast("Upload cancelled."); return; }
    busy("Hal is putting the notes under the slides", "This usually takes a minute or two. Your own notes and edits stay.");
    const status = await pollNotes(id);
    if (status === "processing") { delete S.detail[id]; closeModal(); toast("Still working. The notes will be under the slides when ready."); return; }
    const r = await api.getLecture(id); S.detail[id] = r.detail; const i = S.lectures.findIndex(x => x.id === id); if (i >= 0) S.lectures[i] = r.lecture;
    closeModal(); toast(r.detail && r.detail.slides.length ? "Slides added" : "The slides could not be added. The notes are as they were."); bump();
  } finally { holdWatch(id, false); } });
}

export function deleteModal() { openModal(() => <><h3>{t("Delete this lecture?")}</h3><p className="muted">{t("The recording, notes, flashcards, quiz and any shared link will be removed. This cannot be undone.")}</p>
  <div style={css("display:flex;gap:10px;justify-content:flex-end;margin-top:16px")}><button className="btn plain" onClick={closeModal}>{t("Keep lecture")}</button><button className="btn dark" onClick={doDelete}>{t("Delete lecture")}</button></div></>); }
/* An interrupted recording on this device (the never-finished card offers Delete for it too) is forgotten with its lecture,
   as Discard it would. */
function doDelete() { act(async () => { const id = C().l.id, c = C().c; await api.deleteLecture(id); S.lectures = S.lectures.filter(x => x.id !== id); delete S.detail[id];
  if (S.orphan && S.orphan.id === id) await forgetOrphan();
  closeModal(); toast("Lecture deleted"); location.hash = c ? "#/course/" + encodeURIComponent(c.id) : "#/home"; }); }

/* ---------- sharing ---------- */
export function share() { act(async () => { const l = C().l; if (!l.shareUrl) { const r = await api.createShareLink(l.id); l.shareUrl = r.url; }
  openModal(() => <><h3>{t("Share with your class")}</h3><p className="muted">{t("Anyone with the link can read the notes, transcript, flashcards and quiz" + (CONFIG.SHARE_AUDIO ? ", and play the recording" : ". The recording stays private") + ". They cannot see your other lectures.")}</p>
    <div className="copy"><input id="shareUrl" readOnly defaultValue={l.shareUrl || ""} aria-label={t("Share link")} /><button className="btn primary sm" onClick={copyLink}>{t("Copy link")}</button></div>
    <div style={css("display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap")}><span style={css("display:flex;gap:10px;flex-wrap:wrap")}><a className="btn plain" href={l.shareUrl || ""}>{t("Preview shared page")}</a>{typeof navigator.share === "function" ? <button className="btn plain" onClick={nativeShare}>{t("Send to an app")}</button> : null}</span><button className="btn plain" style={css("color:var(--red)")} onClick={stopSharing}>{t("Stop sharing")}</button></div></>); }); }
function nativeShare() { const l = C().l; try { Promise.resolve(navigator.share({ title: l.title, text: (C().c ? C().c!.code + ": " : "") + l.title, url: l.shareUrl || "" })).catch(() => {}); } catch (e) {} }
function copyLink() { const i = document.getElementById("shareUrl") as HTMLInputElement; i.select(); const fb = () => { try { document.execCommand("copy"); } catch (_) {} }; try { navigator.clipboard.writeText(i.value).catch(fb); } catch (e) { fb(); } toast("Link copied"); }
/* The shared page this visit loaded is kept under the id in the link (#/s/:id). A backend gives the link an id of its
   own, so that is the one forgotten here; in sample mode it is the lecture's id. */
function stopSharing() { act(async () => { const l = C().l, sid = (l.shareUrl || "").split("#/s/")[1]; await api.revokeShareLink(l.id); l.shareUrl = null; delete S.shared[sid ? decodeURIComponent(sid) : l.id]; closeModal(); toast("Sharing stopped. The old link no longer works."); }); }
export function saveShared() { act(async () => { const l = await api.saveShared(R.b); S.homeLoaded = false; toast("Saved to your lectures"); location.hash = "#/lecture/" + encodeURIComponent(l.id); }); }

/* ---------- editing notes ---------- */
let editing: { si: number; pi?: number } | null = null;
function pointModal(title: string, text: string, fn: (text: string) => void) { openModal(() => <><h3>{t(title)}</h3><form onSubmit={e => { e.preventDefault(); fn(val(e.currentTarget, "t")); }}><label className="field"><span>{t("Note")}</span><textarea name="t" rows={4} required maxLength={600} data-notr="" defaultValue={text}></textarea></label>
  <div style={css("display:flex;gap:10px;justify-content:flex-end")}><button type="button" className="btn plain" onClick={closeModal}>{t("Cancel")}</button><button className="btn primary">{t("Save note")}</button></div></form></>); }
export function editPoint(si: number, pi: number) { editing = { si, pi }; pointModal("Edit note", D().sections[si].points[pi].text, saveEdit); }
function saveEdit(text: string) { text = text.trim(); if (!text) return; const { si, pi } = editing as { si: number; pi: number }; act(async () => { await api.updatePoint(C().l.id, si, pi, text); D().sections[si].points[pi].text = text; closeModal(); toast("Note saved"); bump(); }); }
export function addPoint(si: number) { editing = { si }; pointModal("Add a note", "", saveAdd); }
function saveAdd(text: string) { text = text.trim(); if (!text) return; const { si } = editing!; act(async () => { const p = await api.addPoint(C().l.id, si, text); D().sections[si].points.push(p || { t: null, text, mine: true, off: false, slide: null }); closeModal(); toast("Note added"); bump(); }); }
export function delPoint(si: number, pi: number) { editing = { si, pi }; openModal(() => <><h3>{t("Delete this note?")}</h3><p className="muted" data-notr="">{D().sections[si].points[pi].text}</p><div style={css("display:flex;gap:10px;justify-content:flex-end;margin-top:16px")}><button className="btn plain" onClick={closeModal}>{t("Keep note")}</button><button className="btn dark" onClick={doDelPoint}>{t("Delete note")}</button></div></>); }
function doDelPoint() { const { si, pi } = editing as { si: number; pi: number }; act(async () => { await api.deletePoint(C().l.id, si, pi); D().sections[si].points.splice(pi, 1); closeModal(); toast("Note deleted"); bump(); }); }
export function feedbackModal() { openModal(() => <><h3>{t("What is wrong in these notes?")}</h3><form onSubmit={e => { e.preventDefault(); sendFeedback(val(e.currentTarget, "t")); }}><label className="field"><span>{t("Tell us what the lecturer actually said, or what is missing")}</span><textarea name="t" rows={4} required maxLength={1000} data-notr=""></textarea></label>
  <div style={css("display:flex;gap:10px;justify-content:flex-end")}><button type="button" className="btn plain" onClick={closeModal}>{t("Cancel")}</button><button className="btn primary">{t("Send")}</button></div></form></>); }
function sendFeedback(text: string) { act(async () => { await api.sendFeedback(C().l.id, text.trim()); closeModal(); toast("Thank you. This helps Hal write better notes."); }); }
