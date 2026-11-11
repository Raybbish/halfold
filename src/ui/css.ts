import type { CSSProperties } from "react";

/* Inline styles keep the exact CSS text sidenote.html used ("display:flex;gap:12px"), turned into a React
   style object. None of them use !important or vendor prefixes, which React's style prop could not express. */
export function css(text: string): CSSProperties {
  const o: Record<string, string> = {};
  for (const decl of text.split(";")) {
    const i = decl.indexOf(":"); if (i < 0) continue;
    const k = decl.slice(0, i).trim(), v = decl.slice(i + 1).trim(); if (!k) continue;
    o[k.startsWith("--") ? k : k.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())] = v;
  }
  return o as CSSProperties;
}
