/* Phase 3: GET /search?q= (API-CHANGES.md section 4): every point of the student's notes, as edited, own points too;
   case does not matter; every word, in any order; at most 20, newest lecture first. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { SearchReplySchema } from "../src/shapes";
import { readyLecture, setup } from "./helpers";

test("GET /search: all words in any order, any case; newest lecture first; edits, own points and deletions count", async t => {
  const s = setup(); t.after(() => s.close());
  const token = await s.signIn(), other = await s.signIn("CODE-B");
  const older = await readyLecture(s, token, { title: "Week 9" }), newer = await readyLecture(s, token, { title: "Week 10" });
  await readyLecture(s, other);   // someone else's notes say the same
  const search = async (q: string, tk = token) => { const r = await s.call("GET", "/search?q=" + encodeURIComponent(q), { token: tk }); assert.equal(r.status, 200); return SearchReplySchema.parse(r.body).results; };

  const cost = "Opportunity cost is the next best thing you give up.";
  assert.deepEqual(await search("OPPORTUNITY cost"), [{ lecture: newer, text: cost, t: 252 }, { lecture: older, text: cost, t: 252 }]);
  assert.deepEqual(await search("give opportunity"), await search("opportunity give"));
  assert.deepEqual(await search("november midterm"), [{ lecture: newer, text: "The midterm is on 26 November.", t: 18 }, { lecture: older, text: "The midterm is on 26 November.", t: 18 }]);
  assert.deepEqual(await search("midterm sunk"), []);
  assert.deepEqual(await search("   "), []);
  assert.deepEqual((await s.call("GET", "/search", { token })).body, { results: [] });

  /* Edited text is found by its new words only; the student's own point has no time; deleted points and lectures are gone. */
  await s.call("PATCH", `/lectures/${older}/points`, { token, json: { section: 1, index: 0, text: "Opportunity cost = the value of the forgone alternative." } });
  assert.deepEqual(await search("forgone"), [{ lecture: older, text: "Opportunity cost = the value of the forgone alternative.", t: 252 }]);
  assert.deepEqual((await search("next best")).map(r => r.lecture), [newer]);
  await s.call("POST", `/lectures/${older}/points`, { token, json: { section: 0, text: "Ask the tutor about Elasticity." } });
  assert.deepEqual(await search("elasticity"), [{ lecture: older, text: "Ask the tutor about Elasticity.", t: null }]);
  await s.call("DELETE", `/lectures/${older}/points`, { token, json: { section: 0, index: 1 } });
  assert.deepEqual(await search("elasticity"), []);
  await s.call("DELETE", `/lectures/${newer}`, { token });
  assert.deepEqual((await search("midterm")).map(r => r.lecture), [older]);

  /* At most 20. */
  for (let i = 0; i < 25; i++) await s.call("POST", `/lectures/${older}/points`, { token, json: { section: 1, text: `Zebra crossing example ${i}.` } });
  const many = await search("zebra");
  assert.equal(many.length, 20); assert.equal(many[0].text, "Zebra crossing example 0.");
  /* Signing in is needed. */
  assert.equal((await s.call("GET", "/search?q=cost")).status, 401);
});
