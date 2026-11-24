/* Sign-ups a day and the share of students who ticked each consent (handoff of 2026-11-23, item 8), for
   scripts/signups.ts. A sign-up is an email bound to an account (db.ts bindEmail), counted on the day it happened in
   APP_TIMEZONE. Accounts that signed up before 2026-11-24 have no recorded day: they are counted apart.

   The share of a consent is of the students who answered it (the form after the first sign-in, or Settings), ticked now;
   a student who withdrew counts as not ticked, and is counted under withdrawn as well. */
import type { Store } from "./db";
import { localDate } from "./time";

export interface ConsentShare { answered: number; ticked: number; share: number | null; withdrawn: number }
export interface SignUpReport {
  days: { date: string; signUps: number }[];
  accounts: number;          // every account that has signed in with an email
  undated: number;           // of those, signed up before sign-up days were recorded
  profiles: { saved: number; skipped: number; neither: number };   // saved once / chose Skip for now and saved nothing / neither yet
  marketing: ConsentShare;
  survey: ConsentShare;
}

export function signUpReport(store: Store, timeZone: string, o: { days?: number; now?: Date } = {}): SignUpReport {
  const now = o.now ?? new Date(), n = Math.max(1, o.days ?? 30);
  const accounts = store.accountsWithProfiles(), log = store.consentLog();
  const counts = new Map<string, number>();
  for (const a of accounts) if (a.signed_up_at) { const d = localDate(new Date(a.signed_up_at), timeZone); counts.set(d, (counts.get(d) ?? 0) + 1); }
  const days: SignUpReport["days"] = [];
  for (let i = n - 1; i >= 0; i--) { const d = localDate(new Date(now.getTime() - i * 86400_000), timeZone); days.push({ date: d, signUps: counts.get(d) ?? 0 }); }

  const share = (kind: "marketing" | "survey"): ConsentShare => {
    const col = kind === "marketing" ? "consent_marketing" : "consent_survey";
    const answered = accounts.filter(a => a[col] !== null), ticked = answered.filter(a => a[col] === 1).length;
    const gave = new Set(log.filter(r => r.kind === kind && r.given === 1).map(r => r.user_id));
    const withdrawn = answered.filter(a => a[col] === 0 && gave.has(a.id)).length;
    return { answered: answered.length, ticked, share: answered.length ? ticked / answered.length : null, withdrawn };
  };
  return {
    days, accounts: accounts.length, undated: accounts.filter(a => !a.signed_up_at).length,
    profiles: {
      saved: accounts.filter(a => a.saved_at !== null).length,
      skipped: accounts.filter(a => a.saved_at === null && a.skipped_at !== null).length,
      neither: accounts.filter(a => a.saved_at === null && a.skipped_at === null).length
    },
    marketing: share("marketing"), survey: share("survey")
  };
}
