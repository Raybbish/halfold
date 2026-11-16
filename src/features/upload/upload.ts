/* ---------- uploading a recording, in the background ----------
   New lecture -> Upload creates the lecture, goes to its page and sends the file from here, so the student can use the
   rest of Halfnote meanwhile: the lecture page shows the upload (pages/Lecture.tsx), every other page a small link at the
   top (ui/Shell.tsx). One upload at a time. The recording, then the slides, share one progress bar (the same sums the old
   upload dialog used). When both are in, the notes are started without moving the student (finalize(id, 0, true)).
   A failed upload keeps the file in memory, so "Send it again" sends the same file to the same lecture; Cancel upload
   (or Delete this lecture after a failure) stops it and deletes the lecture. The file lives only in this page: a reload
   loses it and the lecture is left unfinished. Leaving the page (main.tsx) or signing out (pages/Settings.tsx) while the
   file is going asks first or is refused. */
import { api } from "../../api/api";
import type { HttpError } from "../../api/http";
import { bump } from "../../lib/bus";
import { R, S } from "../../state/app";
import { toast } from "../../state/overlay";
import { finalize } from "../recording/finish";

export const up = { id: null as string | null, name: "", file: null as File | null, slides: null as File | null, loaded: 0, total: 0, state: "" as "" | "sending" | "failed", err: "" };
/* Stops the requests of the upload that is running. A new one for each try, so a stopped try notices it is no longer current. */
let stop: AbortController | null = null;

/* A file is being sent (not failed). */
export const uploading = () => !!up.id && up.state !== "failed";
export const upPct = () => up.total ? Math.min(100, Math.round(up.loaded / up.total * 100)) : 0;

/* Why it failed. Our own sentences are interface text; anything else is the server's message, shown as it is. */
const LOST = "The connection was lost before the upload finished.", FAILED = "The upload failed.", SIGNIN = "Please sign in again.";
export const ownReason = (err: string) => err === LOST || err === FAILED || err === SIGNIN;
function reason(e: unknown) { const x = e as HttpError;
  if (x && x.name === "TypeError") return LOST;   // the network failed (what upload() in api/http.ts reports)
  if (x && x.status === 401) return SIGNIN;
  return (x && typeof x.status === "number" && x.message) || FAILED; }

const href = (id: string) => "#/lecture/" + encodeURIComponent(id);
const here = (id: string) => R.a === "lecture" && R.b === id;
function reset() { stop = null; Object.assign(up, { id: null, name: "", file: null, slides: null, loaded: 0, total: 0, state: "", err: "" }); }

/* The bar and the percentages move without a redraw, like the recording clock: the lecture page's card and the link at the top. */
function paint() { const pct = upPct();
  document.querySelectorAll(".upPct").forEach(e => { e.textContent = pct + "%"; });
  const b = document.getElementById("upBar"); if (b) { b.style.width = pct + "%"; b.parentElement!.setAttribute("aria-valuenow", String(pct)); } }

/* New lecture -> Upload, after the lecture is created. */
export function startUpload(id: string, file: File, slides: File | null) { Object.assign(up, { id, name: file.name, file, slides }); runUpload(); }

/* Sends up.file (then up.slides) to up.id. Also "Send it again" after a failure. */
export async function runUpload() {
  const id = up.id, file = up.file, slides = up.slides; if (!id || !file) return;
  const me = new AbortController(); stop = me;
  Object.assign(up, { state: "sending", err: "", loaded: 0, total: file.size + (slides ? slides.size : 0) }); bump();
  const mine = () => stop === me && up.id === id;
  /* The browser counts the bytes of the whole request (the file plus a little form framing): scale that to the file's share of the bar. */
  const at = (before: number, size: number) => (sent: number, of: number) => { if (!mine()) return; up.loaded = before + size * sent / of; paint(); };
  try {
    await api.uploadRecording(id, file, { signal: me.signal, onProgress: at(0, file.size) });
    if (!mine()) return;
    if (slides) { try { await api.uploadSlides(id, slides, { signal: me.signal, onProgress: at(file.size, slides.size) }); }
      catch (e) { if (!mine()) return; toast("Slides did not upload. You can add them later."); } }
    if (!mine()) return;
    /* No redraw between reset() and finalize: the lecture is still "recording" until finalize marks it as being written.
       finalize redraws only this lecture's page; anywhere else the link at the top and the list tag must go now. */
    reset(); await finalize(id, 0, true);
    if (!here(id)) bump();
  } catch (e) {
    if (!mine()) return;   // cancelled
    stop = null; up.state = "failed"; up.err = reason(e); bump();
    if (!here(id)) toast("The upload did not finish.", { error: true, href: href(id) });
  }
}

/* Cancel upload, or Delete this lecture after a failure: stops the upload and deletes the lecture, so nothing is left. */
export function cancelUpload() {
  const id = up.id; if (!id) return; const s = stop; reset(); if (s) s.abort();
  /* The lists drop it at once. The home data is read again only after the server has deleted it: read sooner, it could
     still list the lecture. */
  api.deleteLecture(id).catch(() => {}).then(() => { S.homeLoaded = false; }); S.lectures = S.lectures.filter(l => l.id !== id); delete S.detail[id];
  toast("Upload cancelled. Nothing was kept.");
  if (here(id)) location.hash = "#/home"; else bump();
}

/* Signing out: a failed upload is forgotten (its file and the link at the top). Its lecture stays, unfinished. */
export function forgetUpload() { if (!uploading()) reset(); }
