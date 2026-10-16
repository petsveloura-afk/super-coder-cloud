import "server-only";

/**
 * Lemon Squeezy — merchant of record: the customer pays by card, Apple Pay,
 * Google Pay or PayPal; Lemon Squeezy issues the receipt / tax invoice and
 * handles VAT, and pays out to the platform owner's PayPal or bank.
 *
 * Env: LEMONSQUEEZY_API_KEY, LEMONSQUEEZY_STORE_ID, LEMONSQUEEZY_WEBHOOK_SECRET,
 *      LEMONSQUEEZY_VARIANT_PRO_MONTH / _PRO_YEAR / _BUSINESS_MONTH / _BUSINESS_YEAR,
 *      LEMONSQUEEZY_API_BASE (tests only).
 */

export function lemonVariant(plan: string, interval: "month" | "year"): string | null {
  const v = process.env[`LEMONSQUEEZY_VARIANT_${plan.toUpperCase()}_${interval === "year" ? "YEAR" : "MONTH"}`];
  return v && /^\d{1,20}$/.test(v) ? v : null;
}

export function lemonConfigured(): boolean {
  return Boolean(process.env.LEMONSQUEEZY_API_KEY && /^\d+$/.test(process.env.LEMONSQUEEZY_STORE_ID ?? "") && process.env.LEMONSQUEEZY_WEBHOOK_SECRET);
}

export function planForLemonVariant(variantId: string | number | null | undefined): { plan: string; interval: "month" | "year" } | null {
  const id = String(variantId ?? "");
  for (const plan of ["pro", "business"]) {
    for (const interval of ["month", "year"] as const) if (lemonVariant(plan, interval) === id) return { plan, interval };
  }
  return null;
}

const base = () => (process.env.LEMONSQUEEZY_API_BASE || "https://api.lemonsqueezy.com").replace(/\/$/, "");

export async function createLemonCheckout(input: { orgId: string; plan: string; interval: "month" | "year"; email?: string | null; name?: string | null; redirectUrl: string }): Promise<string> {
  const variant = lemonVariant(input.plan, input.interval);
  if (!variant) throw new Error("no_variant");
  const res = await fetch(`${base()}/v1/checkouts`, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.LEMONSQUEEZY_API_KEY}`, Accept: "application/vnd.api+json", "Content-Type": "application/vnd.api+json" },
    body: JSON.stringify({
      data: {
        type: "checkouts",
        attributes: {
          checkout_data: { ...(input.email ? { email: input.email } : {}), ...(input.name ? { name: input.name } : {}), custom: { org_id: input.orgId, plan: input.plan, interval: input.interval } },
          product_options: { redirect_url: input.redirectUrl, enabled_variants: [Number(variant)] },
        },
        relationships: {
          store: { data: { type: "stores", id: String(process.env.LEMONSQUEEZY_STORE_ID) } },
          variant: { data: { type: "variants", id: variant } },
        },
      },
    }),
    signal: AbortSignal.timeout(20_000),
    cache: "no-store",
  });
  const j = (await res.json().catch(() => ({}))) as { data?: { attributes?: { url?: string } }; errors?: { detail?: string }[] };
  const url = j.data?.attributes?.url;
  if (!res.ok || !url) throw new Error(`lemon_${res.status}:${j.errors?.[0]?.detail ?? ""}`);
  return url;
}
