/* Icons, the mascot Hal and the logo. */
import type { ReactNode } from "react";

const Ic = ({ children }: { children: ReactNode }) => <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>;
export const ICON = {
  home: <Ic><path d="M4 11.5 12 4l8 7.5V19a1 1 0 0 1-1 1h-4.5v-5.5h-5V20H5a1 1 0 0 1-1-1z" /></Ic>,
  courses: <Ic><path d="M5 5.5A1.5 1.5 0 0 1 6.5 4H19v13H6.5A1.5 1.5 0 0 0 5 18.5z" /><path d="M5 18.5A1.5 1.5 0 0 0 6.5 20H19" /></Ic>,
  plus: <Ic><path d="M12 5v14M5 12h14" /></Ic>,
  settings: <Ic><path d="M4 8h9M17 8h3M4 16h3M11 16h9" /><circle cx="15" cy="8" r="2" /><circle cx="9" cy="16" r="2" /></Ic>
};

export type Mood = "plain" | "smile" | "wow" | "sad";
/* Hal, the half note with a face. */
export function Hal({ size = 28, mood = "plain", color = "#FFD93B" }: { size?: number; mood?: Mood; color?: string }) {
  const ink = "#16233B", mouth = mood === "smile" ? <path d="M9.4 23.2q3.2 2.2 6.4-.9" fill="none" stroke={ink} strokeWidth="1.7" strokeLinecap="round" /> : mood === "wow" ? <path d="M9.9 22.9q3 3.6 6-1.8z" fill={ink} /> : mood === "sad" ? <path d="M9.6 24.8q3-2.6 6-1" fill="none" stroke={ink} strokeWidth="1.7" strokeLinecap="round" /> : null;
  return <svg className="sid" width={size} height={size} viewBox="0 0 32 32" aria-hidden="true"><path d="M23 18.6V4" stroke={ink} strokeWidth="2.6" strokeLinecap="round" /><ellipse cx="13.4" cy="20.8" rx="10.2" ry="7.7" transform="rotate(-18 13.4 20.8)" fill={color} stroke={ink} strokeWidth="2.2" /><circle className="eye" cx="9.4" cy="19.4" r="1.75" fill={ink} /><circle className="eye" cx="15.9" cy="17.5" r="1.75" fill={ink} />{mouth}</svg>;
}
export const Logo = ({ href }: { href: string }) => <a className="logo" href={href} data-notr=""><Hal size={30} />halfnote</a>;
