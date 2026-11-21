/* A limit of the student's plan (POST /lectures and POST /courses/:id/review-pack answer 429, or 402): a window that says
   so and offers the next step, not a red notice that is gone in a few seconds. The server's sentence says which limit
   and when it resets; the window adds this month's count when /home gave it (usage.lecturesThisMonth / lecturesLimit). */
import type { HttpError } from "../api/http";
import type { Usage } from "../types";
import { S } from "../state/app";
import { closeModal } from "../state/overlay";
import { t } from "../i18n";
import { openModal } from "./Overlay";
import { Hal } from "./icons";
import { css } from "./css";

export const isLimit = (e: unknown) => { const s = (e as HttpError | null)?.status; return s === 429 || s === 402; };

/* "3 of 4 lectures used this month", or null when the plan has no monthly limit (or /home did not say). */
export const lecturesLine = (u: Usage | null | undefined) => u && u.lecturesThisMonth != null && u.lecturesLimit ? u.lecturesThisMonth + " of " + u.lecturesLimit + " lectures used this month" : null;

export function limitModal(message: string) {
  const line = lecturesLine(S.usage);
  openModal(() => <><div style={css("display:flex;gap:12px;align-items:center;margin-bottom:10px")}><Hal size={40} mood="sad" /><h3 style={css("margin:0")}>{t("You have reached the limit of your plan")}</h3></div>
    <p className="muted" style={css("margin-bottom:10px")}>{t(message)}</p>
    {line ? <p className="small muted num" style={css("margin-bottom:10px")}>{t(line)}</p> : null}
    <p className="small muted" style={css("margin-bottom:16px")}>{t("Everything you already have stays, and you can still read, share and review it.")}</p>
    <div style={css("display:flex;justify-content:flex-end;gap:10px;flex-wrap:wrap")}><button className="btn plain" onClick={closeModal}>{t("Not now")}</button><a className="btn primary" data-act="seeplans" href="#/settings" onClick={closeModal}>{t("See the plans")}</a></div></>);
}
