import "server-only";
import { priceEnvName, type BillingInterval, type PlanKey } from "@scc/shared/billing";
import { stripeForm } from "@scc/shared/stripe";

/**
 * Minimal Stripe adapter over the REST API (no SDK → no version lock-in).
 * Enabled only when PAYMENT_PROVIDER_SECRET_KEY and PAYMENT_WEBHOOK_SECRET are set.
 * Card data never touches our servers: Stripe Checkout hosts the payment page.
 */
const API = (process.env.PAYMENT_PROVIDER_API_BASE || "https://api.stripe.com/v1").replace(/\/$/, "");

export interface StripeSubscription {
  id: string;
  status: string;
  customer: string;
  cancel_at_period_end: boolean;
  current_period_end?: number;
  metadata?: Record<string, string>;
  items: { data: { price: { id: string }; current_period_end?: number }[] };
}

export function stripeConfigured(): boolean {
  return Boolean(process.env.PAYMENT_PROVIDER_SECRET_KEY && process.env.PAYMENT_WEBHOOK_SECRET);
}

export function priceIdFor(plan: PlanKey, interval: BillingInterval): string | undefined {
  return process.env[priceEnvName(plan, interval)] || undefined;
}

async function call<T>(path: string, method: "GET" | "POST", body?: Record<string, unknown>): Promise<T> {
  const key = process.env.PAYMENT_PROVIDER_SECRET_KEY;
  if (!key) throw new Error("payments_not_configured");
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body ? stripeForm(body) : undefined,
    signal: AbortSignal.timeout(20_000),
    cache: "no-store",
  });
  const json = (await res.json().catch(() => ({}))) as T & { error?: { message?: string } };
  if (!res.ok) throw new Error(`stripe_error:${res.status}:${json.error?.message ?? "unknown"}`);
  return json;
}

export async function createCheckoutSession(input: {
  orgId: string;
  plan: PlanKey;
  interval: BillingInterval;
  priceId: string;
  customerId?: string | null;
  email?: string | null;
  successUrl: string;
  cancelUrl: string;
  locale: string;
}): Promise<string> {
  const session = await call<{ url: string }>("/checkout/sessions", "POST", {
    mode: "subscription",
    line_items: [{ price: input.priceId, quantity: 1 }],
    client_reference_id: input.orgId,
    customer: input.customerId ?? undefined,
    customer_email: input.customerId ? undefined : input.email ?? undefined,
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
    allow_promotion_codes: "true",
    locale: input.locale === "he" ? "auto" : input.locale,
    metadata: { org_id: input.orgId, plan: input.plan },
    subscription_data: { metadata: { org_id: input.orgId, plan: input.plan } },
  });
  return session.url;
}

export async function createPortalSession(customerId: string, returnUrl: string): Promise<string> {
  const s = await call<{ url: string }>("/billing_portal/sessions", "POST", { customer: customerId, return_url: returnUrl });
  return s.url;
}

export async function getSubscription(id: string): Promise<StripeSubscription> {
  return call<StripeSubscription>(`/subscriptions/${encodeURIComponent(id)}`, "GET");
}

/** current_period_end moved from the subscription to its items in newer API versions. */
export function periodEnd(sub: StripeSubscription): string | null {
  const ts = sub.current_period_end ?? sub.items?.data?.[0]?.current_period_end;
  return ts ? new Date(ts * 1000).toISOString() : null;
}
