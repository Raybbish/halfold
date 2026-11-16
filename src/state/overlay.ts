/* ---------- dialogs and notices ----------
   modal() fills #overlay. ui/Overlay.tsx draws it and keeps the behaviour of sidenote.html:
   the first input is focused, a click on the backdrop closes it, a locked dialog cannot be closed that way,
   Escape closes only an unlocked one (registered in main.tsx), and route() closes it on every navigation.
   Locking used to be read from a missing onclick attribute; now it is overlay.modal.locked. */
import { createChannel } from "../lib/bus";
import { trs } from "../i18n";

/* What the dialog shows. Logic files cannot hold JSX, so the two dialogs they open are described as data;
   the screens pass their own content as "view" (a React element, opaque to this file). */
export type ModalBody =
  | { kind: "busy"; title: string; text: string }
  | { kind: "waiting"; id: string; dur: number }
  | { kind: "upload"; loaded: number; total: number; cancel: () => void }
  | { kind: "view"; view: unknown };

export const overlay = { modal: null as null | { body: ModalBody; locked: boolean }, seq: 0 };
export const overlayChannel = createChannel();

export function modal(body: ModalBody, locked?: boolean) { overlay.modal = { body, locked: !!locked }; overlay.seq++; overlayChannel.bump(); }
export function closeModal() { if (!overlay.modal) return; overlay.modal = null; overlayChannel.bump(); }
export function busy(title: string, text: string) { modal({ kind: "busy", title, text }, true); }
/* The upload dialog: a progress bar and a Cancel button. uploadProgress() moves the bar without opening a new dialog. */
export function uploadDialog(total: number, cancel: () => void) { modal({ kind: "upload", loaded: 0, total, cancel }, true); }
export function uploadProgress(loaded: number, total: number) { const m = overlay.modal; if (!m || m.body.kind !== "upload") return; m.body.loaded = loaded; m.body.total = total; overlayChannel.bump(); }
export async function act(fn: () => Promise<unknown> | unknown) { try { await fn(); } catch (e) { closeModal(); toast((e as Error).message || "Something went wrong. Try again."); } }

/* A short notice at the bottom (top on phones). Outside #app, as before: a .toast element with role=status,
   removed after 2.6 seconds. The scripts read the last .toast.
   error: red. href: the whole notice is a link, with "Open" after the text (gone once it is clicked).
   Either one keeps it for 6 seconds. */
export function toast(msg: string, opt: { error?: boolean; href?: string } = {}) {
  const el = document.createElement(opt.href ? "a" : "div"); el.className = "toast" + (opt.error ? " bad" : ""); el.setAttribute("role", "status");
  if (opt.href) { (el as HTMLAnchorElement).href = opt.href; el.addEventListener("click", () => el.remove()); }
  el.textContent = trs(msg) + (opt.href ? "  " + trs("Open") : ""); document.body.appendChild(el); setTimeout(() => el.remove(), opt.error || opt.href ? 6000 : 2600); }
