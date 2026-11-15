/* PUT /settings (phase 4): the settings form and the 繁/简 switch; GET /home sends them back (INTEGRATION.md 3.1). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { ErrorReplySchema, HomeSchema } from "../src/shapes";
import { setup } from "./helpers";

const isError = (r: { body: unknown }) => ErrorReplySchema.parse(r.body);

test("PUT /settings saves the name, the class language and the 中文解釋 settings; leaving zhScript out keeps it", async t => {
  const s = setup(); t.after(() => s.close());
  const token = await s.signIn(), other = await s.signIn("CODE-B");
  const put = (json: unknown) => s.call("PUT", "/settings", { token, json });
  const home = async (tk = token) => HomeSchema.parse((await s.call("GET", "/home", { token: tk })).body);
  assert.deepEqual((await home()).settings, { classLanguage: "en", zhDefault: false });   // never chosen: no zhScript

  const r = await put({ name: " Jasper Lee ", classLanguage: "en-yue", zhDefault: true, zhScript: "hans" });
  assert.equal(r.status, 204); assert.equal(r.text, "");
  const h = await home();
  assert.equal(h.user.name, "Jasper Lee");
  assert.deepEqual(h.settings, { classLanguage: "en-yue", zhDefault: true, zhScript: "hans" });
  assert.equal((await put({ name: "Jasper", classLanguage: "auto", zhDefault: false })).status, 204);
  assert.deepEqual((await home()).settings, { classLanguage: "auto", zhDefault: false, zhScript: "hans" });
  /* Only the student's own account. */
  assert.deepEqual((await home(other)).settings, { classLanguage: "en", zhDefault: false });
  assert.equal((await home(other)).user.name, "Ben");

  for (const [json, msg] of [
    [{ name: "  ", classLanguage: "en", zhDefault: false }, "Enter your name."],
    [{ name: "x".repeat(61), classLanguage: "en", zhDefault: false }, "Your name can be at most 60 characters."],
    [{ name: "A", classLanguage: "fr", zhDefault: false }, "Choose the language usually spoken in class."],
    [{ name: "A", classLanguage: "en", zhDefault: "yes" }, "The setting for 中文解釋 was not given."],
    [{ name: "A", classLanguage: "en", zhDefault: true, zhScript: "trad" }, "Choose 繁體 or 简体 for 中文解釋."]
  ] as const) { const bad = await put(json); assert.equal(bad.status, 400); assert.equal(isError(bad).message, msg); }
  assert.equal((await home()).user.name, "Jasper");
  assert.equal((await s.call("PUT", "/settings", { json: { name: "A", classLanguage: "en", zhDefault: false } })).status, 401);
});
