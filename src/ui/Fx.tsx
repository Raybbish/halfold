/* Formulas as the notes model writes them in plain text: x^{2}, a_{k}, Σ_{k=0}^{N-1} X(k) e^{-i 2π k/N}, and the short
   form x^2. fx() shows them with real superscripts and subscripts. The text is never read as HTML: only these marks
   become <sup> and <sub>, everything else stays text. A plain x_1 is left alone (it is too often part of a name). */
import type { ReactNode } from "react";

const MARK = /\^\{([^{}]{1,60})\}|_\{([^{}]{1,60})\}|([A-Za-z0-9)\]])\^(-?[A-Za-z0-9]{1,3})(?![A-Za-z0-9])/g;

export function fx(s: string | null | undefined): ReactNode {
  if (!s || !/[\^_]/.test(s)) return s ?? "";
  const out: ReactNode[] = [];
  let last = 0, k = 0;
  for (const m of s.matchAll(MARK)) {
    if (m[3] != null) out.push(s.slice(last, m.index) + m[3], <sup key={k++}>{m[4]}</sup>);
    else out.push(s.slice(last, m.index), m[1] != null ? <sup key={k++}>{m[1]}</sup> : <sub key={k++}>{m[2]}</sub>);
    last = m.index! + m[0].length;
  }
  if (!k) return s;
  out.push(s.slice(last));
  return <>{out}</>;
}
