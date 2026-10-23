/**
 * Plans, limits and payment-provider helpers shared by server code and tests.
 * Plan prices/limits live in the `plans` table (migration 0010); this module
 * only knows the keys and how to interpret limits.
 */

export const PLAN_KEYS = ["free", "pro", "business", "enterprise"] as const;
export type PlanKey = (typeof PLAN_KEYS)[number];
export type BillingInterval = "month" | "year";

export const LIMIT_KEYS = ["contacts", "members", "ai_credits_monthly", "ai_agents"] as const;
export type LimitKey = (typeof LIMIT_KEYS)[number];
export type PlanLimits = Partial<Record<LimitKey, number | null>>;

/** Features that exist in the product today. Others are shown as "coming soon". */
export const LIVE_FEATURES = new Set([
  "crm", "team", "demo", "csv_export", "ai_basic", "ai_agents", "audit_log", "priority_support",
  // wave 14: these work today (no longer "coming soon" on the pricing cards)
  "ai_site_landing", "ai_site_full", "ai_images", "white_label", "api_access", "site_pro_templates", "site_ai_editor", "site_custom_domain",
  // waves 15-18
  "contracts", "lead_routing", "invoicing_sync", "ai_insights", "voice_ai", "calendar_sync", "flow_builder", "ab_testing", "conversion_api", "advanced_analytics",
]);

export const SUBSCRIPTION_STATUSES = ["trialing", "active", "past_due", "canceled", "incomplete", "unpaid"] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export function isPlanKey(v: unknown): v is PlanKey {
  return typeof v === "string" && (PLAN_KEYS as readonly string[]).includes(v);
}

export function isUnlimited(limit: number | null | undefined): boolean {
  return limit === null || limit === undefined;
}

/** 0..1 ratio for meters; unlimited → 0. */
export function usageRatio(used: number, limit: number | null | undefined): number {
  if (isUnlimited(limit) || !limit) return 0;
  return Math.min(1, Math.max(0, used / limit));
}

/** Map a provider subscription status to ours (unknown → incomplete). */
export function normaliseStatus(status: string | null | undefined): SubscriptionStatus {
  return (SUBSCRIPTION_STATUSES as readonly string[]).includes(status ?? "") ? (status as SubscriptionStatus) : "incomplete";
}

/**
 * Parse a Postgres/PostgREST error into a stable i18n key. Plan-limit errors
 * are raised by DB triggers as "plan_limit:<key>".
 */
export function limitErrorKey(message: string | null | undefined): string | null {
  if (!message) return null;
  if (message.includes("plan_limit:ai_credits")) return "ai.limitReached";
  if (message.includes("plan_limit:")) return "billing.limitReached";
  if (message.includes("demo_mode")) return "ai.demoBlocked";
  if (message.includes("rate_limited")) return "ai.rateLimited";
  return null;
}

/** Env var holding the provider price id for a plan/interval, e.g. STRIPE_PRICE_PRO_MONTH. */
export function priceEnvName(plan: PlanKey, interval: BillingInterval): string {
  return `STRIPE_PRICE_${plan.toUpperCase()}_${interval.toUpperCase()}`;
}

/** Reverse lookup: which plan/interval does a provider price id belong to? */
export function planForPrice(
  priceId: string,
  env: Record<string, string | undefined>,
): { plan: PlanKey; interval: BillingInterval } | null {
  for (const plan of PLAN_KEYS) {
    for (const interval of ["month", "year"] as const) {
      if (env[priceEnvName(plan, interval)] === priceId) return { plan, interval };
    }
  }
  return null;
}
