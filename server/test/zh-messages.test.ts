/* The sentences this server writes about video links are shown in Chinese by the front end (SERVER in src/i18n/zh.ts,
   test of 2026-11-18): each one must be there, word for word, or a Chinese reader sees English. The front end's table is
   read as text: importing it would start the browser code it belongs to. */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { STUDENT_MESSAGE } from "../src/links/ytdlp";
import { linkProblem } from "../src/links/guard";

const zh = fs.readFileSync(path.join(import.meta.dirname, "../../src/i18n/zh.ts"), "utf8");
const block = /export const SERVER: Record<string, string> = \{([\s\S]*?)\n\};/.exec(zh)?.[1] ?? "";
const keys = new Set([...block.matchAll(/^\s*"((?:[^"\\]|\\.)*)":\s*"(?:[^"\\]|\\.)+"/gm)].map(m => JSON.parse(`"${m[1]}"`)));

test("every sentence the server writes about a video link has a Chinese version in the front end", () => {
  assert.ok(keys.size > 0, "SERVER was found in src/i18n/zh.ts");
  const refusals = ["", "https://example.com/" + "x".repeat(2000), "not a link", "https://example.com:8080/a.mp4", "http://localhost/a.mp4", "http://10.0.0.1/a.mp4"]
    .map(linkProblem).filter((x): x is string => !!x);
  assert.equal(new Set(refusals).size, 5, "the five sentences linkProblem can write");
  const missing = [...Object.values(STUDENT_MESSAGE), ...refusals].filter(m => !keys.has(m));
  assert.deepEqual(missing, [], "add these to SERVER in src/i18n/zh.ts");
});
