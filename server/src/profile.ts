/* The profile and the two consents asked for after the first sign-in (handoff of 2026-11-23, item 4), in the shape of the
   designers' draft of 2026-11-24 (halfold(1).html: profileFields, readProfile, needsWelcome; API-CHANGES.md 14). Paths are
   under /api and need the token.

   GET /home carries user.profile: null until the student saves it once, which is what makes the front end ask (#/welcome,
   on the way to the home page). Every field is optional, and anyone can choose "Skip for now": the draft remembers that in
   the browser, and POST /profile/later keeps it here too (user.profileSkipped), so another device does not ask again.
   Settings changes the profile and either consent at any time with PUT /profile.

   The two consents are separate from each other and from anything else (no terms of service are accepted here), never
   ticked by default, and every answer and change is kept with its time and the wording shown (consents table). */
import { Hono } from "hono";
import type { Origin, Profile, ProfileReply, User, YearOfStudy } from "../../src/types";
import type { ProfileFields, ProfileRow, Store } from "./db";
import { fail, jsonBody } from "./http/errors";
import { str, type AppEnv, type Deps } from "./routes";

/* Which consent text the student saw: the draft's wording of 2026-11-24 (src/pages/Profile.tsx). The final text comes later
   (handoff, item 4); when it changes, change this too, so each answer stays tied to the text it was given to. */
export const CONSENT_WORDING = "draft-2026-11-24";
export const YEARS: YearOfStudy[] = ["y1", "y2", "y3", "y4", "tpg", "rpg", "other"];
export const ORIGINS: Origin[] = ["hk", "cn", "tw", "mo", "other"];
const MAX_TEXT = 80;   // the draft's maxlength

export function profileView(p: ProfileRow): Profile {
  return {
    school: p.school ?? "", major: p.major ?? "",
    yearOfStudy: YEARS.includes(p.year_of_study as YearOfStudy) ? p.year_of_study as YearOfStudy : "",
    gradYear: p.grad_year ?? null,
    origin: ORIGINS.includes(p.origin as Origin) ? p.origin as Origin : "",
    consentMarketing: p.consent_marketing === 1, consentSurvey: p.consent_survey === 1,
    consentMarketingAt: p.consent_marketing_at ?? null, consentSurveyAt: p.consent_survey_at ?? null
  };
}

/* user.profile and user.profileSkipped of GET /home. */
export function userProfile(p: ProfileRow | undefined): Pick<User, "profile" | "profileSkipped"> {
  if (p?.saved_at) return { profile: profileView(p) };
  return { profile: null, ...(p?.skipped_at ? { profileSkipped: true } : {}) };
}

/* The fields of PUT /profile that were sent, checked. "" (or null) clears a field. */
function readUpdate(b: Record<string, unknown>, now = new Date()) {
  const fields: ProfileFields = {}, consents: { marketing?: boolean; survey?: boolean } = {};
  const text = (key: "school" | "major", long: string) => {
    if (b[key] === undefined) return;
    if (b[key] !== null && typeof b[key] !== "string") fail(400, long);
    const v = str(b[key]);
    if (v.length > MAX_TEXT) fail(400, long);
    fields[key] = v;
  };
  text("school", `The university can be at most ${MAX_TEXT} characters.`);
  text("major", `What you study can be at most ${MAX_TEXT} characters.`);
  if (b.yearOfStudy !== undefined) {
    const v = b.yearOfStudy ?? "";
    if (v !== "" && !YEARS.includes(v as YearOfStudy)) fail(400, "Choose your year from the list.");
    fields.year_of_study = v === "" ? null : v as string;
  }
  if (b.gradYear !== undefined) {
    const raw = b.gradYear ?? "", year = now.getUTCFullYear();
    if (raw === "") fields.grad_year = null;
    else {
      const y = typeof raw === "number" ? raw : typeof raw === "string" && /^\s*\d{4}\s*$/.test(raw) ? Number(raw) : NaN;
      if (!Number.isInteger(y) || y < year - 10 || y > year + 10) fail(400, "Choose the year you graduate from the list.");
      fields.grad_year = y;
    }
  }
  if (b.origin !== undefined) {
    const v = b.origin ?? "";
    if (v !== "" && !ORIGINS.includes(v as Origin)) fail(400, "Choose where you studied before university from the list.");
    fields.origin = v as string;   // "" is kept: the student chose "Prefer not to say"
  }
  for (const [key, kind] of [["consentMarketing", "marketing"], ["consentSurvey", "survey"]] as const) {
    if (b[key] === undefined) continue;
    if (typeof b[key] !== "boolean") fail(400, "Tick or untick each box.");
    consents[kind] = b[key] as boolean;
  }
  return { fields, consents };
}

export function profileRoutes(deps: Pick<Deps, "store">) {
  const store: Store = deps.store;
  const r = new Hono<AppEnv>();

  /* {school?, major?, yearOfStudy?, gradYear?, origin?, consentMarketing?, consentSurvey?} -> {profile}. The fields given
     are saved and the rest kept; the form sends all seven. The first save, even an empty one, ends the question. */
  r.put("/profile", async c => {
    const user = c.get("user"), { fields, consents } = readUpdate(await jsonBody(c));
    const saved = store.saveProfile(user.id, fields, consents, { wording: CONSENT_WORDING });
    return c.json<ProfileReply>({ profile: profileView(saved) });
  });

  /* "Skip for now". */
  r.post("/profile/later", c => {
    store.skipProfile(c.get("user").id);
    return c.body(null, 204);
  });

  return r;
}
