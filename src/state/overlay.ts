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
  | { kind: "view"; view: unknown };

export const overlay = { modal: null as null | { body: ModalBody; locked: boolean }, seq: 0 };
export const overlayChannel = createChannel();

export function modal(body: ModalBody, locked?: boolean) { overlay.modal = { body, locked: !!locked }; overlay.seq++; overlayChannel.bump(); }
export function closeModal() { if (!overlay.modal) return; overlay.modal = null; overlayChannel.bump(); }
export function busy(title: string, text: string) { modal({ kind: "busy", title, text }, true); }
export async function act(fn: () => Promise<unknown> | unknown) { try { await fn(); } catch (e) { closeModal(); toast((e as Error).message || "Something went wrong. Try again."); } }

/* A short notice at the bottom (top on phones). Outside #app, as before: a .toast element with role=status,
   removed after 2.6 seconds. The scripts read the last .toast. */
export function toast(msg: string) { const el = document.createElement("div"); el.className = "toast"; el.setAttribute("role", "status"); el.textContent = trs(msg); document.body.appendChild(el); setTimeout(() => el.remove(), 2600); }
