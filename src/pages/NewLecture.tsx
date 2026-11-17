/* ---------- new lecture ----------
   Record with the microphone, record a browser tab (online class), upload a file, or paste a video link.
   What has been typed or chosen is kept in nf, as before, so it is still there after a redraw or an error. */
import type { ReactNode } from "react";
import type { Source } from "../types";
import { CONFIG } from "../config";
import { api } from "../api/api";
import { mb } from "../lib/helpers";
import { store } from "../lib/store";
import { bump } from "../lib/bus";
import { LANGS, R, S, course, nf } from "../state/app";
import { act, busy, closeModal, toast, uploadDialog, uploadProgress } from "../state/overlay";
import { t } from "../i18n";
import { live, beginRecording } from "../features/recording/recorder";
import { finalize } from "../features/recording/finish";
import { CAN_TAB } from "../features/recording/tabAudio";
import { Sid } from "../ui/icons";
import { Shell, addCourseModal } from "../ui/Shell";
import { openModal } from "../ui/Overlay";
import { css } from "../ui/css";

type FileKey = "file" | "slides";
function FileBox({ k, id, accept, empty }: { k: FileKey; id: string; accept: string; empty: ReactNode }) { const f = nf[k];
  return <><input type="file" id={id} accept={accept} hidden onChange={e => pickFile(k, e.currentTarget)} />{f ? <div className="filechip"><span><b>{f.name}</b>{" "}<span className="muted num">{mb(f.size)}</span></span><button type="button" className="ts" onClick={() => { nf[k] = null; bump(); }}>{t("Remove")}</button></div> : <div className="drop" onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); dropFile(k, e.nativeEvent); }}>{empty}</div>}</>; }
function pickFile(key: FileKey, input: HTMLInputElement) { setFile(key, input.files![0]); }
function dropFile(key: FileKey, e: DragEvent) { setFile(key, e.dataTransfer!.files[0]); }
function setFile(key: FileKey, f: File | undefined) { if (!f) return; if (f.size > CONFIG.MAX_UPLOAD_MB * 1048576) { toast("That file is larger than " + CONFIG.MAX_UPLOAD_MB + " MB."); return; }
  if (key === "slides" && !/pdf$/i.test(f.type || f.name)) { toast("Slides need to be a PDF."); return; } nf[key] = f; nf.err = ""; bump(); }

const mode = (m: Source) => () => { nf.mode = m; nf.err = ""; bump(); };

/* The course of the new lecture. The list holds only the student's courses; Add a course is a button of its own, and the
   course added there is chosen (doAddCourse sets nf.courseId). sidenote.html had Add a course as the last item of the list:
   with no course yet it was the only item and already chosen, so choosing it did nothing. With no course yet there is no
   list, only a line saying so and the button. */
function CourseField() {
  const add = <button type="button" className="ts" onClick={addCourseModal}>{t("Add a course")}</button>;
  if (!S.courses.length) return <div className="field"><span>{t("Course")}</span><div className="nocourse">{t("You have no courses yet. Every lecture belongs to a course, so add one first.")}{" "}{add}</div></div>;
  return <div className="field"><span className="field-h"><label htmlFor="fCourse">{t("Course")}</label>{add}</span>
    <select id="fCourse" defaultValue={nf.courseId || undefined} onChange={e => { nf.courseId = e.currentTarget.value; }}>{S.courses.map(c => <option key={c.id} value={c.id}>{c.code + (c.name ? ", " + c.name : "")}</option>)}</select></div>;
}

export function NewLecture() {
  const m = nf.mode; if (!nf.courseId || !course(nf.courseId)) nf.courseId = S.courses[0] ? S.courses[0].id : null; if (!nf.lang) nf.lang = S.settings.classLanguage || "en";
  const u = S.usage;
  return <Shell active="new">
    <div className="crumb"><a href="#/home">{t("Home")}</a>{t(" / New lecture")}</div>
    <div className="page-h"><h1>{t("New lecture")}</h1>{u ? <span className="small muted num">{t(u.minutesToday + " of " + u.minutesLimit + " recording minutes used today")}</span> : null}</div>
    {live.active ? <div className="alert"><span className="tag amber">{t("Recording")}</span><span>{t("A recording is already running. End it before starting another.")}</span><a className="ts" href="#/live">{t("Return")}</a></div> : null}
    <div className="choice" role="radiogroup" aria-label={t("How to add the lecture")}>
      <button role="radio" aria-checked={m === "record"} className={m === "record" ? "on" : ""} onClick={mode("record")}><b><span className="w">{t("Record now")}</span><span className="n">{t("Record")}</span></b><span className="small muted d">{t("Use this device's microphone during class.")}</span></button>
      <button role="radio" aria-checked={m === "upload"} className={m === "upload" ? "on" : ""} onClick={mode("upload")}><b><span className="w">{t("Upload a recording")}</span><span className="n">{t("Upload")}</span></b><span className="small muted d">{t("Audio or video file you already have.")}</span></button>
      <button role="radio" aria-checked={m === "link"} className={m === "link" ? "on" : ""} onClick={mode("link")}><b><span className="w">{t("Paste a lecture video link")}</span><span className="n">{t("Video link")}</span></b><span className="small muted d">{t("For classes with an online replay.")}</span></button>
      {CAN_TAB ? <button role="radio" aria-checked={m === "tab"} className={m === "tab" ? "on" : ""} onClick={mode("tab")}><b><span className="w">{t("Record an online class")}</span><span className="n">{t("Online class")}</span></b><span className="small muted d">{t("Capture the sound of a browser tab, such as Zoom in the browser. Desktop Chrome or Edge.")}</span></button> : null}
    </div>
    <form className="card" style={css("padding:22px;max-width:640px")} onSubmit={e => { e.preventDefault(); submitNew(); }}>
      <CourseField />
      <label className="field"><span>{t("Title (optional)")}</span><input placeholder={t("Week 10, supply and demand")} maxLength={120} defaultValue={nf.title} onChange={e => { nf.title = e.currentTarget.value; }} /></label>
      {m === "upload" ? <div className="field"><span>{t("Recording")}</span><FileBox k="file" id="fRec" accept="audio/*,video/*" empty={<>{t("Drop an audio or video file here, or ")}<button type="button" className="ts" style={css("font-size:inherit")} onClick={() => document.getElementById("fRec")!.click()}>{t("choose a file")}</button><div className="small">{t("MP3, M4A, WAV, MP4. Up to " + CONFIG.MAX_UPLOAD_MB + " MB.")}</div></>} /></div> : null}
      {m === "link" ? <label className="field"><span>{t("Video link")}</span><input type="url" placeholder={t("https://")} defaultValue={nf.link} onChange={e => { nf.link = e.currentTarget.value; }} /></label> : null}
      <div className="field"><span>{t("Slides (optional)")}</span><FileBox k="slides" id="fSl" accept="application/pdf,.pdf" empty={<>{t("Add the slide deck as a PDF and the notes will stick to each slide. ")}<button type="button" className="ts" style={css("font-size:inherit")} onClick={() => document.getElementById("fSl")!.click()}>{t("Choose a PDF")}</button></>} /></div>
      <label className="field"><span>{t("Language spoken in class")}</span><select defaultValue={nf.lang} onChange={e => { nf.lang = e.currentTarget.value; }}>{LANGS.map(([v, n]) => <option key={v} value={v}>{t(n)}</option>)}</select></label>
      {nf.err ? <p className="err" role="alert">{t(nf.err)}</p> : null}
      <button className="btn blue" disabled={nf.busy || ((m === "record" || m === "tab") && live.active)}>{t(m === "record" || m === "tab" ? "Start recording" : "Make notes")}</button>
      {m === "record" ? <p className="small muted" style={css("margin-top:14px")}>{t("Your browser will ask to use the microphone. On a laptop, recording continues while you use other tabs. On an iPhone, keep this page open and the screen on.")}</p> : null}
      {m === "tab" ? <p className="small muted" style={css("margin-top:14px")}>{t("Your browser will ask what to share. Choose the tab that is playing the class and turn on the option to share tab audio. Only the sound is recorded.")}</p> : null}
    </form>
  </Shell>;
}

function submitNew() {
  if (nf.busy) return;   // already sending: a second click or Enter must not create a second lecture
  if (!nf.courseId) { nf.err = "Add a course first."; return bump(); }
  if (nf.mode === "upload" && !nf.file) { nf.err = "Choose the recording to upload."; return bump(); }
  if (nf.mode === "link" && !/^https?:\/\/\S+\.\S+/.test(nf.link.trim())) { nf.err = "Paste the full link, starting with https://"; return bump(); }
  const recMode = nf.mode === "record" || nf.mode === "tab";
  if (recMode && S.usage && S.usage.minutesToday >= S.usage.minutesLimit) { nf.err = "You have used today's recording minutes. Upload a recording instead, or come back tomorrow."; return bump(); }
  if (recMode && !store.get("recTip")) return recTipModal();
  nf.err = ""; nf.busy = true; bump();   // grey out the button while the lecture is being created
  const done = () => { Object.assign(nf, { title: "", file: null, slides: null, link: "", busy: false }); };
  act(async () => {
    try {
      const lec = await api.createLecture({ courseId: nf.courseId!, title: nf.title.trim(), language: nf.lang!, source: nf.mode });
      if (recMode) { const code = course(nf.courseId)!.code; if (nf.slides) api.uploadSlides(lec.id, nf.slides).catch(() => toast("Slides did not upload. The notes will be made without them.")); await beginRecording(lec, code, nf.mode); done(); location.hash = "#/live"; return; }
      if (nf.mode === "upload") { if (!(await sendFiles(lec.id, nf.file!, nf.slides))) return; }
      else {
        busy("Uploading", "Keep this page open until the upload finishes.");
        /* A link the backend refuses (not public, mistyped): the lecture just made for it is deleted, so no empty lecture
           is left counting toward the month's lectures; the form keeps the link to correct. */
        try { await api.attachLink(lec.id, nf.link.trim()); }
        catch (e) { api.deleteLecture(lec.id).catch(() => {}); throw e; }
        if (nf.slides) await api.uploadSlides(lec.id, nf.slides);
      }
      done(); await finalize(lec.id, 0);
    } finally { nf.busy = false; if (R.a === "new") bump(); }   // enable the button again if the page is still showing (after an error)
  });
}

/* Upload the recording and the slides with one progress bar for both. Cancel stops the upload and deletes the lecture
   that was just created for it, so no empty lecture is left; the form keeps the files for another try.
   Resolves false when the student cancelled. */
async function sendFiles(id: string, file: File, slides: File | null) {
  const total = file.size + (slides ? slides.size : 0), stop = new AbortController();
  uploadDialog(total, () => stop.abort());
  try {
    /* The browser counts the bytes of the whole request (the file plus a little form framing): scale that to the file's share of the bar. */
    await api.uploadRecording(id, file, { signal: stop.signal, onProgress: (sent, of) => uploadProgress(file.size * sent / of, total) });
    if (slides) await api.uploadSlides(id, slides, { signal: stop.signal, onProgress: (sent, of) => uploadProgress(file.size + slides.size * sent / of, total) });
    return true;
  } catch (e) {
    if ((e as Error).name !== "AbortError") throw e;
    api.deleteLecture(id).catch(() => {}); closeModal(); toast("Upload cancelled."); return false;
  }
}

/* Shown once, before the first recording on this device. */
function recTipModal() { openModal(() => <><div style={css("display:flex;gap:12px;align-items:center")}><Sid size={44} mood="smile" /><h3 style={css("margin:0")}>{t("Before you record")}</h3></div>
  <ul style={css("padding-left:20px;margin:14px 0")}><li>{t("Check that recording is allowed in this class. Ask the lecturer if you are not sure.")}</li><li>{t("Sit where you can hear the lecturer clearly.")}</li><li>{t("On a phone, keep this page open and the screen on.")}</li></ul>
  <div style={css("display:flex;gap:10px;justify-content:flex-end")}><button className="btn plain" onClick={closeModal}>{t("Not now")}</button><button className="btn primary" onClick={() => { store.set("recTip", "1"); closeModal(); submitNew(); }}>{t("Start recording")}</button></div></>); }
