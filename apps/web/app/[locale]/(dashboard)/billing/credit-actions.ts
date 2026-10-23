"use server";

import { randomBytes } from "node:crypto";
import { getOrgContext } from "@/lib/auth";
import type { ActionState } from "@/lib/action-state";

/**
 * Wave 18 — buy an AI credit pack (PayPal / card, or crypto). The purchase row is created
 * first; credits are added only after the provider confirms the payment server to server.
 */
const loc = (l: unknown) => (l === "ar" || l === "en" ? l : "he") as "he" | "ar" | "en";

export async function buyCreditPackAction(input: { locale: string; pack: string; method: "paypal" | "crypto" }): Promise<ActionState<{ url: string }>> {
  const locale = loc(input.locale);
  const ctx = await getOrgContext(locale);
  if (!ctx.can("billing.manage")) return { error: "errors.forbidden" };
  if (ctx.org.is_demo) return { error: "billing.demoBlocked" };
  const { packByKey, packOrderRef } = await import("@/lib/billing/packs-core");
  const pack = packByKey(String(input.pack ?? ""));
  if (!pack) return { error: "credits.unknownPack" };
  const { publicEnv } = await import("@/lib/env");
  const app = publicEnv.appUrl.replace(/\/$/, "");
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const admin = createAdminClient();
  const { data: allowed } = await admin.rpc("public_rate_limit", { p_bucket: `credit-buy:${ctx.org.id}`, p_limit: 10, p_window_seconds: 3600 });
  if (allowed === false) return { error: "errors.rateLimited" };

  if (input.method === "crypto") {
    const { createCryptoPackInvoice, cryptoConfigured } = await import("@/lib/billing/nowpayments");
    if (!cryptoConfigured()) return { error: "billing.notConfigured" };
    const { data: row, error } = await admin.from("credit_purchases").insert({ organization_id: ctx.org.id, pack: pack.key, credits: pack.credits, amount: pack.usd, currency: "USD", provider: "nowpayments", created_by: ctx.userId }).select("id").single();
    if (error || !row) return { error: "errors.generic" };
    const ref = packOrderRef(row.id as string, randomBytes(6).toString("hex"));
    try {
      const url = await createCryptoPackInvoice({
        orderRef: ref,
        amountUsd: pack.usd,
        description: `Super Coder Cloud — ${pack.credits} AI credits`,
        ipnUrl: `${app}/api/webhooks/nowpayments`,
        successUrl: `${app}/${locale}/billing?pack=processing`,
        cancelUrl: `${app}/${locale}/billing?pack=canceled`,
      });
      await admin.from("credit_purchases").update({ provider_order_id: ref }).eq("id", row.id);
      return { ok: true, data: { url } };
    } catch (e) {
      console.error("credit pack crypto failed", (e as Error).message);
      await admin.from("credit_purchases").update({ status: "canceled" }).eq("id", row.id);
      return { error: "billing.providerError" };
    }
  }

  const { paypalConfigured, paypalCreateOrder } = await import("@/lib/billing/paypal");
  if (!paypalConfigured()) return { error: "billing.notConfigured" };
  const { data: row, error } = await admin.from("credit_purchases").insert({ organization_id: ctx.org.id, pack: pack.key, credits: pack.credits, amount: pack.usd, currency: "USD", provider: "paypal", created_by: ctx.userId }).select("id").single();
  if (error || !row) return { error: "errors.generic" };
  try {
    const order = await paypalCreateOrder({
      customId: packOrderRef(row.id as string, "pp01"),
      description: `${pack.credits} AI credits`,
      amount: pack.usd,
      currency: "USD",
      requestId: `scc-pack-${row.id}`,
      returnUrl: `${app}/api/billing/paypal/pack-return?locale=${locale}`,
      cancelUrl: `${app}/${locale}/billing?pack=canceled`,
      locale,
    });
    await admin.from("credit_purchases").update({ provider_order_id: order.id }).eq("id", row.id);
    if (!order.approveUrl) return { error: "billing.providerError" };
    return { ok: true, data: { url: order.approveUrl } };
  } catch (e) {
    console.error("credit pack paypal failed", (e as Error).message);
    await admin.from("credit_purchases").update({ status: "canceled" }).eq("id", row.id);
    return { error: "billing.providerError" };
  }
}
