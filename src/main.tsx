import "./styles.css";
import { CONFIG } from "./config";
import { mockDb } from "./api/mock";
import { session } from "./state/app";
import { installTestBridge } from "./testBridge";

/* Start-up, in the order sidenote.html used. */
if (CONFIG.USE_MOCK) mockDb.prep();
session.load();
installTestBridge();
