/* Phase 3: sharing a lecture (POST and DELETE /lectures/:id/share), the public shared page (GET /shared/:id) and saving
   a copy of shared notes (POST /shared/:id/save). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { ErrorReplySchema, HomeSchema, LectureReplySchema, LectureSchema, SharedReplySchema, UrlReplySchema } from "../src/shapes";
import { readyLecture, setup, uploadedLecture } from "./helpers";

const isError = (r: { body: unknown }) => ErrorReplySchema.parse(r.body);
const shareId = (url: string) => url.split("#/s/")[1];

test("sharing: a link to #/s/:id that no one can guess, on the page's address; the same link until stopped", async t => {
  const s = setup(); t.after(() => s.close());
  const token = await s.signIn("CODE-A", "Ann Lee");
  const id = await readyLecture(s, token);
  const r = await s.call("POST", `/lectures/${id}/share`, { token, headers: { Origin: "https://notes.example.com" } });
  const { url } = UrlReplySchema.parse(r.body);
  assert.match(url!, /^https:\/\/notes\.example\.com\/#\/s\/[A-Za-z0-9]{16}$/);
  /* lecture.shareUrl, in GET /home and GET /lectures/:id; sharing again gives the same link. */
  assert.equal(HomeSchema.parse((await s.call("GET", "/home", { token })).body).lectures[0].shareUrl, url);
  assert.equal(LectureReplySchema.parse((await s.call("GET", `/lectures/${id}`, { token })).body).lecture.shareUrl, url);
  assert.equal((await s.call("POST", `/lectures/${id}/share`, { token, headers: { Origin: "https://elsewhere.example" } })).body.url, url);

  /* The shared page, without a token: the notes, no recording, not the owner's progress; the lecture goes by the share id. */
  await s.call("PUT", `/lectures/${id}/progress`, { token, json: { known: [0], quizScore: 1 } });
  const page = await s.call("GET", `/shared/${shareId(url!)}`);
  assert.equal(page.status, 200);
  const shared = SharedReplySchema.parse(page.body);
  assert.equal(shared.sharedBy, "Ann Lee");
  assert.equal(shared.lecture.id, shareId(url!)); assert.equal(shared.lecture.title, "Week 9"); assert.equal(shared.lecture.shareUrl, null);
  assert.deepEqual(shared.course && [shared.course.code, shared.course.name], ["ECON 1001", "Microeconomics"]);
  assert.equal(shared.detail.audio, undefined); assert.equal(shared.detail.progress, undefined);
  assert.deepEqual(shared.detail.sections, s.store.detail(id)!.sections);

  /* Stopping: the old link no longer works; sharing again makes a new one. */
  assert.equal((await s.call("DELETE", `/lectures/${id}/share`, { token })).status, 204);
  const gone = await s.call("GET", `/shared/${shareId(url!)}`);
  assert.equal(gone.status, 404); assert.equal(isError(gone).message, "This link is no longer shared.");
  assert.equal(LectureReplySchema.parse((await s.call("GET", `/lectures/${id}`, { token })).body).lecture.shareUrl, null);
  const again = (await s.call("POST", `/lectures/${id}/share`, { token })).body.url as string;
  assert.notEqual(shareId(again), shareId(url!));
  /* No Origin (not a browser): this server's address. */
  assert.match(again, /^http:\/\/localhost\/#\/s\//);

  /* Deleting the lecture ends the link too. */
  await s.call("DELETE", `/lectures/${id}`, { token });
  assert.equal((await s.call("GET", `/shared/${shareId(again)}`)).status, 404);
});

test("sharing: WEB_URL decides the address; only the owner's lectures with notes can be shared", async t => {
  const s = setup({ env: { WEB_URL: "https://uni.example.com/sidenote/" } }); t.after(() => s.close());
  const token = await s.signIn(), other = await s.signIn("CODE-B");
  const id = await readyLecture(s, token);
  assert.match((await s.call("POST", `/lectures/${id}/share`, { token, headers: { Origin: "http://localhost:5173" } })).body.url, /^https:\/\/uni\.example\.com\/sidenote\/#\/s\/\w{16}$/);
  assert.equal((await s.call("POST", `/lectures/${id}/share`, { token: other })).status, 404);
  assert.equal((await s.call("DELETE", `/lectures/${id}/share`, { token: other })).status, 404);
  const waiting = await uploadedLecture(s, token);
  const r = await s.call("POST", `/lectures/${waiting}/share`, { token });
  assert.equal(r.status, 409); isError(r);
  /* The shared page of an unknown id; and a sharer who never gave a name: "A classmate". */
  assert.equal((await s.call("GET", "/shared/nope")).status, 404);
  s.store.addInviteCode("CODE-C");
  const nameless = await s.signIn("CODE-C"), theirs = await readyLecture(s, nameless);
  const url = (await s.call("POST", `/lectures/${theirs}/share`, { token: nameless })).body.url as string;
  assert.equal(SharedReplySchema.parse((await s.call("GET", `/shared/${shareId(url)}`)).body).sharedBy, "A classmate");
});

test("POST /shared/:id/save: a copy in the reader's course with the same code, without the recording; saved once", async t => {
  const s = setup(); t.after(() => s.close());
  const ann = await s.signIn("CODE-A", "Ann"), ben = await s.signIn("CODE-B", "Ben");
  const id = await readyLecture(s, ann);
  await s.call("POST", `/lectures/${id}/points`, { token: ann, json: { section: 0, text: "Ann's own note." } });
  const url = (await s.call("POST", `/lectures/${id}/share`, { token: ann })).body.url as string, sid = shareId(url);

  /* Signing in is needed (the front end then comes back to the page). */
  assert.equal((await s.call("POST", `/shared/${sid}/save`)).status, 401);
  /* Ben already has the course, written a little differently: the copy goes there. */
  const benCourse = (await s.call("POST", "/courses", { token: ben, json: { code: "econ1001", name: "Econ" } })).body;
  const saved = await s.call("POST", `/shared/${sid}/save`, { token: ben });
  assert.equal(saved.status, 200);
  const copy = LectureSchema.parse(saved.body);
  assert.notEqual(copy.id, id); assert.equal(copy.course, benCourse.id); assert.equal(copy.title, "Week 9");
  assert.equal(copy.status, "ready"); assert.equal(copy.shareUrl, null); assert.equal(copy.duration, 600);

  const mine = LectureReplySchema.parse((await s.call("GET", `/lectures/${copy.id}`, { token: ben })).body);
  assert.equal(mine.detail!.audio, undefined);
  /* The same notes; Ann's own point is in it, but it is not Ben's own ("mine"). */
  const original = s.store.detail(id)!.sections;
  assert.deepEqual(original[0].points[1], { t: null, text: "Ann's own note.", mine: true, off: false, slide: null });
  assert.deepEqual(mine.detail!.sections, original.map(x => ({ ...x, points: x.points.map(({ mine: _m, ...p }) => p) })));
  assert.deepEqual(mine.detail!.sections[0].points[1], { t: null, text: "Ann's own note.", off: false, slide: null });
  /* The dated alerts come along to Ben's exam radar; the copy is an upload, not live minutes. */
  const home = HomeSchema.parse((await s.call("GET", "/home", { token: ben })).body);
  assert.deepEqual(home.upcoming.map(u => [u.lecture, u.course, u.date]), [[copy.id, "econ1001", "2099-11-26"]]);
  assert.equal(home.usage!.minutesToday, 0);
  assert.equal(home.courses.length, 1);

  /* Saving again gives the same copy. The copy is Ben's own: editing it does not touch Ann's, and it stays when Ann deletes hers. */
  assert.equal((await s.call("POST", `/shared/${sid}/save`, { token: ben })).body.id, copy.id);
  await s.call("PATCH", `/lectures/${copy.id}/points`, { token: ben, json: { section: 0, index: 0, text: "Ben's version." } });
  assert.equal(s.store.detail(id)!.sections[0].points[0].text, "The midterm is on 26 November.");
  await s.call("DELETE", `/lectures/${id}`, { token: ann });
  assert.equal((await s.call("GET", `/lectures/${copy.id}`, { token: ben })).status, 200);
  assert.equal((await s.call("POST", `/shared/${sid}/save`, { token: ben })).status, 404);
});

test("POST /shared/:id/save: a new course when the reader has none like it; the owner gets the lecture itself", async t => {
  const s = setup(); t.after(() => s.close());
  const ann = await s.signIn("CODE-A", "Ann"), ben = await s.signIn("CODE-B", "Ben");
  const id = await readyLecture(s, ann);
  const sid = shareId((await s.call("POST", `/lectures/${id}/share`, { token: ann })).body.url);
  const copy = LectureSchema.parse((await s.call("POST", `/shared/${sid}/save`, { token: ben })).body);
  const home = HomeSchema.parse((await s.call("GET", "/home", { token: ben })).body);
  assert.deepEqual(home.courses.map(c => [c.id, c.code, c.name]), [[copy.course, "ECON 1001", "Microeconomics"]]);
  assert.notEqual(copy.course, s.store.lecture(id)!.course_id);
  /* Ann saving her own shared lecture: no copy. */
  assert.equal((await s.call("POST", `/shared/${sid}/save`, { token: ann })).body.id, id);
  assert.equal(HomeSchema.parse((await s.call("GET", "/home", { token: ann })).body).lectures.length, 1);
});
