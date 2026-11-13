/* The text of each slide page, for the notes prompt (which point belongs to which slide, and what is not on them). */
import fsp from "node:fs/promises";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

const MAX_PAGES = 300, MAX_CHARS_PER_PAGE = 2000;

export async function readSlides(file: string): Promise<{ n: number; text: string }[]> {
  const data = new Uint8Array(await fsp.readFile(file));
  const task = getDocument({ data, disableFontFace: true, useSystemFonts: false, verbosity: 0 });
  const doc = await task.promise;
  try {
    const pages: { n: number; text: string }[] = [];
    for (let i = 1; i <= Math.min(doc.numPages, MAX_PAGES); i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      let text = "";
      for (const it of content.items) if ("str" in it) text += it.str + (it.hasEOL ? "\n" : " ");
      pages.push({ n: i, text: text.replace(/[ \t]+/g, " ").replace(/ ?\n ?/g, "\n").replace(/\n{2,}/g, "\n").trim().slice(0, MAX_CHARS_PER_PAGE) });
      page.cleanup();
    }
    return pages;
  } finally { await task.destroy(); }
}
