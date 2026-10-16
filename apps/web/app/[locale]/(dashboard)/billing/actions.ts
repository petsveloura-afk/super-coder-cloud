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

/* ------------------------------------------ wave 8: PayPal / Lemon Squeezy / crypto ---- */

const methodSchema = z.object({
  plan: z.enum(["pro", "business"]),
  interval: z.enum(["month", "year"]),
  method: z.enum(["paypal", "lemonsqueezy", "crypto"]),
});

/** One entry point for the new payment methods; every method redirects to the provider's secure page. */
export async function startPaymentAction(fd: FormData) {
  const locale = loc(fd);
  const ctx = await getOrgContext(locale);
  const back = `/${locale}/billing`;
  if (!ctx.can("billing.manage")) redirect(`${back}?error=forbidden`);
  if (ctx.org.is_demo) redirect(`${back}?error=demo`);
  const parsed = methodSchema.safeParse({ plan: fd.get("plan"), interval: fd.get("interval"), method: fd.get("method") });
  if (!parsed.success) redirect(`${back}?error=invalid`);
  const supabase = await createClient();
  const { data: ok } = await supabase.rpc("check_rate_limit", { p_key: "checkout", p_limit: 10, p_window_seconds: 3600 });
  if (ok !== true) redirect(`${back}?error=rate_limited`);
  const app = publicEnv.appUrl.replace(/\/$/, "");
  const { plan, interval, method } = parsed.data;
  let url: string | null = null;
  try {
    if (method === "paypal") {
      const { createPayPalSubscription, paypalConfigured } = await import("@/lib/billing/paypal");
      if (!paypalConfigured()) redirect(`${back}?error=not_configured`);
      url = await createPayPalSubscription({
        orgId: ctx.org.id,
        plan,
        interval,
        email: ctx.email,
        locale,
        returnUrl: `${app}/api/billing/paypal/return?locale=${locale}`,
        cancelUrl: `${app}${back}?checkout=canceled`,
      });
    } else if (method === "lemonsqueezy") {
      const { createLemonCheckout, lemonConfigured } = await import("@/lib/billing/lemonsqueezy");
      if (!lemonConfigured()) redirect(`${back}?error=not_configured`);
      url = await createLemonCheckout({ orgId: ctx.org.id, plan, interval, email: ctx.email, redirectUrl: `${app}${back}?checkout=success` });
    } else {
      const { createCryptoInvoice, cryptoConfigured } = await import("@/lib/billing/nowpayments");
      if (!cryptoConfigured()) redirect(`${back}?error=not_configured`);
      url = await createCryptoInvoice({
        orgId: ctx.org.id,
        plan,
        interval,
        ipnUrl: `${app}/api/webhooks/nowpayments`,
        successUrl: `${app}${back}?checkout=pending`,
        cancelUrl: `${app}${back}?checkout=canceled`,
      });
    }
  } catch (e) {
    if ((e as { digest?: string }).digest?.startsWith("NEXT_REDIRECT")) throw e;
    console.error("checkout failed", method, (e as Error).message);
    redirect(`${back}?error=provider`);
  }
  if (!url) redirect(`${back}?error=provider`);
  redirect(url);
}

/** Cancel a PayPal subscription (Stripe / Lemon Squeezy have their own customer portals). */
export async function cancelPayPalAction(fd: FormData) {
  const locale = loc(fd);
  const ctx = await getOrgContext(locale);
  const back = `/${locale}/billing`;
  if (!ctx.can("billing.manage")) redirect(`${back}?error=forbidden`);
  const supabase = await createClient();
  const { data: sub } = await supabase.from("subscriptions").select("provider, provider_subscription_id").eq("organization_id", ctx.org.id).maybeSingle();
  if (sub?.provider !== "paypal" || !sub.provider_subscription_id) redirect(`${back}?error=no_customer`);
  try {
    const { cancelPayPalSubscription, syncPayPalSubscription } = await import("@/lib/billing/paypal");
    await cancelPayPalSubscription(sub.provider_subscription_id as string);
    await syncPayPalSubscription(sub.provider_subscription_id as string);
  } catch {
    redirect(`${back}?error=provider`);
  }
  redirect(`${back}?checkout=canceled`);
}
