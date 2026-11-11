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
import { live } from "./features/recording/recorder";
import { installTestBridge } from "./testBridge";
import { App } from "./App";

/* bump() redraws before it returns, like render() did. */
setFlusher(fn => flushSync(fn));

/* Page-wide listeners, registered once here (not in effects, which run twice in development). */
window.addEventListener("beforeunload", e => { if (live.active) { e.preventDefault(); e.returnValue = ""; } });
window.addEventListener("hashchange", route);
document.addEventListener("keydown", e => { if (e.key === "Escape" && !(overlay.modal && overlay.modal.locked)) closeModal(); });

/* Start-up, in the order sidenote.html used: sample data, session, <html lang>, IndexedDB, unfinished recordings, first route. */
if (CONFIG.USE_MOCK) mockDb.prep();
session.load();
document.documentElement.lang = LANG === "zh" ? "zh-Hant" : "en";
installTestBridge();
createRoot(document.getElementById("app")!).render(<StrictMode><App /></StrictMode>);
(async () => { await idb.open(); route(); })();
