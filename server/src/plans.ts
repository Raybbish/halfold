/* Plans and what each one allows: server/plans.json (or the file PLANS_FILE names), read once at start.
   The first plan is the free one: no price. Every other plan has one or more passes: paid once for a number of days,
   never renewed (the handoff of 2026-11-23: one-time payments only). Each pass is one card on the settings page; every
   pass of a plan gives that plan's limits. Prices are in whole units of `currency` (98 = HK$98). A limit of null means
   no limit. See DESIGN.md (第四阶段, and 一次付清和退款). */
import fs from "node:fs";
import { z } from "zod";

const id = z.string().regex(/^[A-Za-z0-9_-]+$/);   // INTEGRATION.md section 1: plan ids are letters, digits, _ and -
const limit = z.number().int().nonnegative().nullable();
const PassSchema = z.strictObject({ id, name: z.string().min(1).max(40), price: z.number().positive(), days: z.number().int().positive() });

const TierSchema = z.strictObject({
  id, name: z.string().min(1).max(40),
  dailyLiveMinutes: z.number().int().nonnegative(),   // live recording (record, tab) a day; uploads are not counted
  lecturesPerMonth: limit,                            // lectures that get notes, recorded or uploaded; saved copies of shared notes are free
  packsPerMonth: limit,                               // review packs made
  audioDays: z.number().int().positive().nullable(),  // how long recordings are kept; null = for good
  passes: z.array(PassSchema).optional()              // what a student can buy of this plan, each paid once
});

export const PlanBookSchema = z.strictObject({ currency: z.string().regex(/^[A-Za-z]{3}$/), plans: z.array(TierSchema).min(1) })
  .superRefine((b, ctx) => {
    if (b.plans[0].passes?.length) ctx.addIssue({ code: "custom", message: "the first plan is the free one: give it no passes" });
    b.plans.slice(1).forEach((p, i) => { if (!p.passes?.length) ctx.addIssue({ code: "custom", path: ["plans", i + 1], message: "a plan after the first needs at least one pass" }); });
    const ids = b.plans.flatMap(p => [p.id, ...(p.passes || []).map(x => x.id)]);
    if (new Set(ids).size !== ids.length) ctx.addIssue({ code: "custom", message: "plan and pass ids must all be different" });
  });

export type Tier = z.infer<typeof TierSchema>;
export type Pass = z.infer<typeof PassSchema>;
export type PlanBook = z.infer<typeof PlanBookSchema>;
/* A card on the settings page: the free plan, or a pass of a paid plan. */
export type Card = { id: string; tier: Tier; kind: "free" } | { id: string; tier: Tier; kind: "pass"; pass: Pass };

/* The keys of plans.json before one-time payments (2026-11-24): a monthly price was a subscription that renewed. */
function retiredKeys(raw: unknown) {
  const plans = (raw as { plans?: unknown })?.plans;
  if (!Array.isArray(plans)) return;
  for (const p of plans) {
    if (p && typeof p === "object" && "monthly" in p) throw new Error(`plan "${(p as { id?: string }).id}": "monthly" is gone: payments are one-time now. Give the plan a pass instead, e.g. "passes": [{ "id": "plus-month", "name": "Plus for a month", "price": 98, "days": 30 }]`);
    if (p && typeof p === "object" && "pass" in p) throw new Error(`plan "${(p as { id?: string }).id}": "pass" is now a list, "passes": [{ "id", "name", "price", "days" }]`);
  }
}

export function readPlans(text: string, where = "plans.json"): PlanBook {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch (e) { throw new Error(`${where} is not valid JSON: ${(e as Error).message}`); }
  try { retiredKeys(raw); } catch (e) { throw new Error(`${where}: ${(e as Error).message}`); }
  const r = PlanBookSchema.safeParse(raw);
  if (!r.success) throw new Error(`${where}: ${r.error.issues.map(i => (i.path.length ? i.path.join(".") + ": " : "") + i.message).join("; ")}`);
  return r.data;
}
export const loadPlans = (file: string) => readPlans(fs.readFileSync(file, "utf8"), file);

export const freeTier = (b: PlanBook) => b.plans[0];
export const tierById = (b: PlanBook, tierId: string) => b.plans.find(p => p.id === tierId);
export function cards(b: PlanBook): Card[] {
  return b.plans.flatMap((tier, i): Card[] => i === 0 ? [{ id: tier.id, tier, kind: "free" }]
    : (tier.passes || []).map(pass => ({ id: pass.id, tier, kind: "pass" as const, pass })));
}
export const cardById = (b: PlanBook, cardId: string) => cards(b).find(c => c.id === cardId);
/* The next plan up, to name in a "limit reached" message; undefined for the top plan. */
export const nextTier = (b: PlanBook, t: Tier) => b.plans[b.plans.findIndex(p => p.id === t.id) + 1];

const SYMBOL: Record<string, string> = { HKD: "HK$", USD: "US$", CNY: "¥", SGD: "S$", TWD: "NT$", GBP: "£", EUR: "€" };
export function money(currency: string, amount: number) {
  const c = currency.toUpperCase(), n = Number.isInteger(amount) ? String(amount) : amount.toFixed(2);
  return SYMBOL[c] ? SYMBOL[c] + n : `${n} ${c}`;
}
/* Stripe takes amounts in the smallest unit: cents for HKD. (Currencies without one, such as JPY, are not handled.) */
export const minorUnits = (amount: number) => Math.round(amount * 100);
