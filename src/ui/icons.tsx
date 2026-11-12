/* Icons, the mascot Sid and the logo. Same SVG as sidenote.html. */
import type { ReactNode } from "react";
import { t } from "../i18n";

const Ic = ({ children }: { children: ReactNode }) => <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>;
export const ICON = {
  home: <Ic><path d="M4 11.5 12 4l8 7.5V19a1 1 0 0 1-1 1h-4.5v-5.5h-5V20H5a1 1 0 0 1-1-1z" /></Ic>,
  courses: <Ic><path d="M5 5.5A1.5 1.5 0 0 1 6.5 4H19v13H6.5A1.5 1.5 0 0 0 5 18.5z" /><path d="M5 18.5A1.5 1.5 0 0 0 6.5 20H19" /></Ic>,
  plus: <Ic><path d="M12 5v14M5 12h14" /></Ic>,
  settings: <Ic><path d="M4 8h9M17 8h3M4 16h3M11 16h9" /><circle cx="15" cy="8" r="2" /><circle cx="9" cy="16" r="2" /></Ic>
};

export type Mood = "plain" | "smile" | "wow" | "sad";
/* Sid, the sticky note with eyes. */
export function Sid({ size = 28, mood = "plain", color = "#FFD93B" }: { size?: number; mood?: Mood; color?: string }) {
  const mouth = mood === "smile" ? <path d="M12.5 18.5q3.5 3 7 0" fill="none" stroke="#16233B" strokeWidth="1.8" strokeLinecap="round" /> : mood === "wow" ? <ellipse cx="16" cy="20" rx="2" ry="2.4" fill="#16233B" /> : mood === "sad" ? <path d="M12.5 20.5q3.5 -3 7 0" fill="none" stroke="#16233B" strokeWidth="1.8" strokeLinecap="round" /> : null;
  return <svg className="sid" width={size} height={size} viewBox="0 0 32 32" aria-hidden="true"><path d="M3 3h26v17l-9 9H3z" fill={color} stroke="#16233B" strokeWidth="2" strokeLinejoin="round" /><path d="M29 20h-9v9" fill="#fff" fillOpacity=".55" stroke="#16233B" strokeWidth="2" strokeLinejoin="round" /><circle className="eye" cx="11.5" cy="13" r="2.1" fill="#16233B" /><circle className="eye" cx="20.5" cy="13" r="2.1" fill="#16233B" />{mouth}</svg>;
}
export const Logo = ({ href }: { href: string }) => <a className="logo" href={href}><Sid size={28} />{t("sidenote")}</a>;
