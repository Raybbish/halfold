/* The check scripts in tests/ drive the page from outside and read some of its inner objects
   (S, route, trs, today, pl, live, rec, outbox, idb, DATA, notesMarkdown ...). sidenote.html had them
   as globals; here they are collected on window.__sidenote. Objects are shared by reference, so a
   script that changes S.homeLoaded changes the app's own S. */
import { CONFIG } from "./config";
import { api } from "./api/api";
import { DATA, mockDb } from "./api/mock";
import { S, session } from "./state/app";
import { store } from "./lib/store";
import { idb } from "./lib/idb";

declare global {
  interface Window { __sidenote?: Record<string, unknown> }
}

export function installTestBridge() {
  window.__sidenote = { CONFIG, api, DATA, mockDb, S, session, store, idb };
}
