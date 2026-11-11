import "./styles.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { CONFIG } from "./config";
import { setFlusher } from "./lib/bus";
import { idb } from "./lib/idb";
import { mockDb } from "./api/mock";
import { session } from "./state/app";
import { overlay, closeModal } from "./state/overlay";
import { route } from "./state/router";
import { LANG } from "./i18n";
import { live, onVisibilityChange } from "./features/recording/recorder";
import { outbox, flush } from "./features/recording/outbox";
import { findOrphan } from "./features/recording/orphan";
import { installTestBridge } from "./testBridge";
import { App } from "./App";

/* bump() redraws before it returns, like render() did. */
setFlusher(fn => flushSync(fn));

/* Page-wide listeners and timers, registered once here and never from components (effects run twice in development).
   Same order as in sidenote.html. */
const net = () => document.body.classList.toggle("is-offline", navigator.onLine === false);   // the offline notice
document.addEventListener("visibilitychange", onVisibilityChange);
window.addEventListener("online", flush); setInterval(() => { if (outbox.length) flush(); }, 10000);
window.addEventListener("beforeunload", e => { if (live.active) { e.preventDefault(); e.returnValue = ""; } });
window.addEventListener("online", net); window.addEventListener("offline", net);
window.addEventListener("hashchange", route);
document.addEventListener("keydown", e => { if (e.key === "Escape" && !(overlay.modal && overlay.modal.locked)) closeModal(); });

/* Start-up, in the order sidenote.html used: sample data, session, <html lang>, IndexedDB, unfinished recordings,
   and only then the first route. */
if (CONFIG.USE_MOCK) mockDb.prep();
session.load();
document.documentElement.lang = LANG === "zh" ? "zh-Hant" : "en"; net();
installTestBridge();
createRoot(document.getElementById("app")!).render(<StrictMode><App /></StrictMode>);
(async () => { await idb.open(); await findOrphan(); route(); })();
