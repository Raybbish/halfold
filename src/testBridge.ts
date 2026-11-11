/* The check scripts in tests/ drive the page from outside and read some of its inner objects
   (S, route, trs, today, pl, live, rec, outbox, idb, DATA, notesMarkdown ...). sidenote.html had them
   as globals; here they are collected on window.__sidenote. Objects are shared by reference, so a
   script that changes S.homeLoaded changes the app's own S. Values that get reassigned (R, cur, LANG)
   are getters. */
import { CONFIG } from "./config";
import { api } from "./api/api";
import { DATA, mockDb } from "./api/mock";
import { S, session, state, today, dayMon, R, cur } from "./state/app";
import { route } from "./state/router";
import { store } from "./lib/store";
import { idb } from "./lib/idb";
import { LANG, trs, t, setLang } from "./i18n";
import { busy, modal, closeModal, toast } from "./state/overlay";
import { ZH } from "./i18n/zh";
import { pl } from "./features/player/player";
import { live, rec } from "./features/recording/recorder";
import { outbox } from "./features/recording/outbox";
import { notesMarkdown } from "./features/export";

declare global {
  interface Window { __sidenote?: Record<string, unknown> }
}

export function installTestBridge() {
  const b: Record<string, unknown> = { CONFIG, api, DATA, mockDb, S, session, state, today, dayMon, route, store, idb, trs, t, setLang, ZH, pl, live, rec, outbox, notesMarkdown, busy, modal, closeModal, toast };
  Object.defineProperties(b, {
    R: { get: () => R, enumerable: true },
    cur: { get: () => cur, enumerable: true },
    LANG: { get: () => LANG, enumerable: true }
  });
  window.__sidenote = b;
}
