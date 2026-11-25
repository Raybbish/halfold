/* Phase 4: the student's settings, plans and payment (reference/INTEGRATION.md sections 2 and 3.4, API-CHANGES.md
   section 8), and Stripe's webhook. The logic of plans is in billing.ts, signing in in login.ts. Paths are under /api. */
import { Hono, type Context } from "hono";
import type { Plans, UrlReply } from "../../src/types";
import { CLASS_LANGUAGES } from "./config";
import { fail, jsonBody } from "./http/errors";
import { str, type AppEnv, type Deps } from "./routes";

/* Where the front end is, for links back to it (a shared lecture, the settings page after paying): WEB_URL; else the
   page that asked (the browser's Origin header); else PUBLIC_URL; else this server. A front end served under a path
   (https://x.com/app/) needs WEB_URL. */
export function webBase(c: Context, deps: Pick<Deps, "config">) {
  const origin = c.req.header("origin") || "";
  return deps.config.webUrl || (/^https?:\/\/[^/\s]+$/i.test(origin) ? origin : "") || deps.config.publicUrl || new URL(c.req.url).origin;
}

export function accountRoutes(deps: Deps) {
  const { store, billing } = deps;
  const r = new Hono<AppEnv>();

  /* {name, classLanguage, zhDefault, zhScript}: the settings form, and the 繁/简 switch (which sends the rest unchanged).
     zhScript left out keeps the one chosen before. */
  r.put("/settings", async c => {
    const b = await jsonBody(c), name = str(b.name);
    if (!name) fail(400, "Enter your name.");
    if (name.length > 60) fail(400, "Your name can be at most 60 characters.");
    if (!CLASS_LANGUAGES.includes(str(b.classLanguage) as never)) fail(400, "Choose the language usually spoken in class.");
    if (typeof b.zhDefault !== "boolean") fail(400, "The setting for 中文解釋 was not given.");
    if (b.zhScript !== undefined && b.zhScript !== "hant" && b.zhScript !== "hans") fail(400, "Choose 繁體 or 简体 for 中文解釋.");
    store.setSettings(c.get("user").id, { name, classLanguage: str(b.classLanguage), zhDefault: b.zhDefault as boolean, zhScript: b.zhScript as string | undefined });
    return c.body(null, 204);
  });

  r.get("/plans", async c => {
    const user = c.get("user");
    await billing.refresh(user.id);
    return c.json<Plans>(billing.plans(user.id));
  });

  /* {planId} -> {url}: Stripe Checkout, to pay once for a pass. url null: payments are not set up on this server; the
     front end says checkout is not connected yet. */
  r.post("/checkout", async c => {
    const user = c.get("user"), planId = str((await jsonBody(c)).planId);
    if (!planId) fail(400, "Choose a plan.");
    await billing.refresh(user.id);
    return c.json<UrlReply>({ url: await billing.checkout(store.user(user.id)!, planId, webBase(c, deps)) });
  });

  return r;
}

/* Stripe calls this (public, checked by its signature): STRIPE_WEBHOOK_SECRET is the signing secret of the endpoint
   https://<server>/api/stripe/webhook in the Stripe Dashboard, or the one `stripe listen` prints. Events used:
   checkout.session.completed, .async_payment_succeeded, .async_payment_failed, .expired; charge.refunded;
   charge.dispute.closed (billing.ts handle). An error that is ours is a 500, and Stripe sends the event again later. */
export function webhookRoutes(deps: Deps) {
  const r = new Hono<AppEnv>();
  r.post("/stripe/webhook", async c => {
    const pay = deps.billing.payments;
    if (!pay) fail(404, "Payments are not set up on this server.");
    const payload = await c.req.text();
    let event;
    try { event = pay!.event(payload, c.req.header("stripe-signature")); }
    catch (e) { console.warn(`[stripe] webhook refused: ${(e as Error).message}`); return c.json({ message: "The signature is not valid." }, 400); }
    await deps.billing.handle(event);
    return c.json({ received: true });
  });
  return r;
}
