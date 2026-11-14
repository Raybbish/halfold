/* Plans by hand (phase 4).
     npm run plan -- list                          every student: email, invite code, plan, until when
     npm run plan -- show <email|invite code>      one student's plan, and this month's use
     npm run plan -- give <email|invite code> <days> [plan]
                                                   days of a paid plan (default: the first paid one in plans.json),
                                                   added after the days the student already has; for testers, or a
                                                   payment taken another way (FPS, PayMe). Does not touch Stripe. */
import fs from "node:fs";
import path from "node:path";
import { loadConfig } from "../src/config";
import { Store } from "../src/db";
import { Billing } from "../src/billing";
import { monthOf } from "../src/time";

const config = loadConfig();
fs.mkdirSync(config.dataDir, { recursive: true });
const store = new Store(path.join(config.dataDir, "sidenote.db"));
const billing = new Billing({ config, store, payments: null });
const [cmd, who, ...rest] = process.argv.slice(2);
const find = (w: string) => store.userByEmail(w.trim().toLowerCase()) ?? store.userByCode(w);
const line = (u: NonNullable<ReturnType<typeof find>>) => {
  const e = billing.entitlement(u.id);
  return `${(u.email || "(no email yet)").padEnd(32)} ${u.invite_code.padEnd(12)} ${e.current.padEnd(16)} ${e.until ? (e.renews ? "renews " : "until ") + e.until.slice(0, 10) : ""}`;
};

if (cmd === "list") for (const u of store.listUsers()) console.log(line(u));
else if ((cmd === "show" || cmd === "give") && who) {
  const u = find(who);
  if (!u) { console.log(`No student with the email or invite code "${who}".`); process.exitCode = 1; }
  else if (cmd === "show") {
    const since = monthOf(new Date(), config.timezone).start.toISOString(), tier = billing.entitlement(u.id).tier;
    console.log(line(u));
    console.log(`this month: ${store.lecturesUsed(u.id, since)} of ${tier.lecturesPerMonth ?? "unlimited"} lectures, ${store.packsUsed(u.id, since)} of ${tier.packsPerMonth ?? "unlimited"} review packs`);
  } else {
    const days = Number(rest[0]), plan = rest[1] || config.plans.plans[1]?.id;
    if (!Number.isInteger(days) || days <= 0 || !plan || !config.plans.plans.slice(1).some(p => p.id === plan)) {
      console.log(`npm run plan -- give <email|invite code> <days> [${config.plans.plans.slice(1).map(p => p.id).join("|")}]`); process.exitCode = 1;
    } else { store.extendPass(u.id, plan, days); console.log(line(u)); }
  }
} else { console.log("npm run plan -- list | show <email|invite code> | give <email|invite code> <days> [plan]"); process.exitCode = 1; }
store.close();
