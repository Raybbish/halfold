/* The profile and the two consents asked for at sign-up (handoff of 2026-11-23, item 4; API-CHANGES.md 14). Paths are
   under /api and need the token.

   A new account (its email bound from 2026-11-24 on: users.signed_up_at) is asked right after it signs in, and has to
   answer: GET /home carries askProfile "signup" until PUT /profile has every field. An account from before is asked once,
   at the next sign-in or the next time Halfold opens: askProfile "once", answered with PUT /profile or put off for good
   with POST /profile/later. Settings changes the profile and either consent at any time with PUT /profile.

   The two consents are separate from each other and from anything else (no terms of service are accepted here), never
   ticked by default, and every answer and change is kept with its time and the wording shown (consents table). */
import { Hono } from "hono";
import type { AskProfile, Origin, Profile, YearOfStudy } from "../../src/types";
import type { ProfileFields, ProfileRow, Store, UserRow } from "./db";
import { fail, jsonBody } from "./http/errors";
import { str, type AppEnv, type Deps } from "./routes";

/* Which consent text the student saw. The wording is a placeholder until the final text comes (handoff, item 4); when it
   changes, change this too, so each answer stays tied to the text it was given to. */
export const CONSENT_WORDING = "placeholder-2026-11-24";
export const YEARS: YearOfStudy[] = ["year1", "year2", "year3", "year4", "year5", "masters", "phd"];
export const ORIGINS: Origin[] = ["mainland", "hk-local", "taiwan", "other"];
const MAX_TEXT = 100;

export function profileView(p: ProfileRow | undefined): Profile {
  return {
    school: p?.school ?? "", major: p?.major ?? "",
    yearOfStudy: YEARS.includes(p?.year_of_study as YearOfStudy) ? p!.year_of_study as YearOfStudy : null,
    gradYear: p?.grad_year ?? null,
    origin: ORIGINS.includes(p?.origin as Origin) ? p!.origin as Origin : null,
    consentMarketing: p?.consent_marketing === 1, consentSurvey: p?.consent_survey === 1,
    consentMarketingAt: p?.consent_marketing_at ?? null, consentSurveyAt: p?.consent_survey_at ?? null
  };
}

/* The one-time question, while it is still to be answered. */
export function askProfile(user: Pick<UserRow, "signed_up_at">, p: ProfileRow | undefined): AskProfile | null {
  if (p?.asked_at) return null;
  return user.signed_up_at ? "signup" : "once";
}

/* The fields of PUT /profile that were sent, checked. */
function readUpdate(b: Record<string, unknown>, now = new Date()) {
  const fields: ProfileFields = {}, consents: { marketing?: boolean; survey?: boolean } = {};
  const text = (key: "school" | "major", empty: string, long: string) => {
    if (b[key] === undefined) return;
    const v = str(b[key]);
    if (!v) fail(400, empty);
    if (v.length > MAX_TEXT) fail(400, long);
    fields[key] = v;
  };
  text("school", "Enter your school.", `The school can be at most ${MAX_TEXT} characters.`);
  text("major", "Enter your major.", `The major can be at most ${MAX_TEXT} characters.`);
  if (b.yearOfStudy !== undefined) {
    if (!YEARS.includes(b.yearOfStudy as YearOfStudy)) fail(400, "Choose your year of study.");
    fields.year_of_study = b.yearOfStudy as string;
  }
  if (b.gradYear !== undefined) {
    const y = typeof b.gradYear === "number" ? b.gradYear : /^\s*\d{4}\s*$/.test(String(b.gradYear)) ? Number(b.gradYear) : NaN, year = now.getUTCFullYear();
    if (!Number.isInteger(y) || y < year - 30 || y > year + 10) fail(400, "Enter the year you graduate, with four digits, such as 2028.");
    fields.grad_year = y;
  }
  if (b.origin !== undefined) {
    if (!ORIGINS.includes(b.origin as Origin)) fail(400, "Choose where you are from.");
    fields.origin = b.origin as string;
  }
  for (const [key, kind] of [["consentMarketing", "marketing"], ["consentSurvey", "survey"]] as const) {
    if (b[key] === undefined) continue;
    if (typeof b[key] !== "boolean") fail(400, "Tick or untick each box.");
    consents[kind] = b[key] as boolean;
  }
  return { fields, consents };
}

const EVERY_FIELD = ["school", "major", "yearOfStudy", "gradYear", "origin", "consentMarketing", "consentSurvey"];

export function profileRoutes(deps: Pick<Deps, "store">) {
  const store: Store = deps.store;
  const r = new Hono<AppEnv>();

  /* The fields given are saved and the rest kept, so Settings can save the profile and the consents apart. The answer to
     the one-time question has every field (the form asks for all of them). Replies with the profile as saved. */
  r.put("/profile", async c => {
    const user = c.get("user"), b = await jsonBody(c);
    const asking = askProfile(user, store.profile(user.id));
    if (asking && EVERY_FIELD.some(k => b[k] === undefined || b[k] === "")) fail(400, "Fill in every field.");
    const { fields, consents } = readUpdate(b);
    const saved = store.saveProfile(user.id, fields, consents, { wording: CONSENT_WORDING, source: asking === "signup" ? "signup" : asking ? "prompt" : "settings", answered: !!asking });
    return c.json<Profile>(profileView(saved));
  });

  /* "Not now", for an account from before only: a new account has to answer. */
  r.post("/profile/later", c => {
    const user = c.get("user");
    if (askProfile(user, store.profile(user.id)) === "signup") fail(409, "Fill in these details to finish signing up.");
    store.profileLater(user.id);
    return c.body(null, 204);
  });

  return r;
}
