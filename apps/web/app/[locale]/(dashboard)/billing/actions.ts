"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { PLAN_KEYS } from "@scc/shared/billing";
import { getOrgContext } from "@/lib/auth";
import { publicEnv } from "@/lib/env";
import { isLocale, type Locale } from "@/lib/i18n/config";
import { createClient } from "@/lib/supabase/server";
import { createCheckoutSession, createPortalSession, priceIdFor, stripeConfigured } from "@/lib/billing/stripe";

function loc(fd: FormData): Locale {
  const l = fd.get("locale");
  return isLocale(l) ? l : "he";
}

const checkoutSchema = z.object({
  plan: z.enum(PLAN_KEYS).refine((p) => p === "pro" || p === "business"),
  interval: z.enum(["month", "year"]),
});

export async function startCheckoutAction(fd: FormData) {
  const locale = loc(fd);
  const ctx = await getOrgContext(locale);
  const back = `/${locale}/billing`;
  if (!ctx.can("billing.manage")) redirect(`${back}?error=forbidden`);
  if (ctx.org.is_demo) redirect(`${back}?error=demo`);
  if (!stripeConfigured()) redirect(`${back}?error=not_configured`);
  const parsed = checkoutSchema.safeParse({ plan: fd.get("plan"), interval: fd.get("interval") });
  if (!parsed.success) redirect(`${back}?error=invalid`);
  const priceId = priceIdFor(parsed.data.plan, parsed.data.interval);
  if (!priceId) redirect(`${back}?error=not_configured`);

  const supabase = await createClient();
  const { allowed } = await supabase
    .rpc("check_rate_limit", { p_key: "checkout", p_limit: 10, p_window_seconds: 3600 })
    .then((r) => ({ allowed: r.data === true }));
  if (!allowed) redirect(`${back}?error=rate_limited`);

  const { data: sub } = await supabase
    .from("subscriptions")
    .select("provider_customer_id")
    .eq("organization_id", ctx.org.id)
    .maybeSingle();

  let url: string;
  try {
    url = await createCheckoutSession({
      orgId: ctx.org.id,
      plan: parsed.data.plan,
      interval: parsed.data.interval,
      priceId,
      customerId: sub?.provider_customer_id ?? null,
      email: ctx.email,
      successUrl: `${publicEnv.appUrl}${back}?checkout=success`,
      cancelUrl: `${publicEnv.appUrl}${back}?checkout=canceled`,
      locale,
    });
  } catch {
    redirect(`${back}?error=provider`);
  }
  redirect(url);
}

export async function openPortalAction(fd: FormData) {
  const locale = loc(fd);
  const ctx = await getOrgContext(locale);
  const back = `/${locale}/billing`;
  if (!ctx.can("billing.manage") || !stripeConfigured()) redirect(`${back}?error=forbidden`);
  const supabase = await createClient();
  const { data: sub } = await supabase
    .from("subscriptions")
    .select("provider, provider_customer_id")
    .eq("organization_id", ctx.org.id)
    .maybeSingle();
  if (!sub?.provider_customer_id || sub.provider !== "stripe") redirect(`${back}?error=no_customer`);
  let url: string;
  try {
    url = await createPortalSession(sub.provider_customer_id, `${publicEnv.appUrl}${back}`);
  } catch {
    redirect(`${back}?error=provider`);
  }
  redirect(url);
}
