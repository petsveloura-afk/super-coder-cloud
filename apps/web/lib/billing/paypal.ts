import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { moneyString, paypalStatus } from "./payments-core";
import { applyPlan, planPrice, recordPayment } from "./receipts";

/**
 * PayPal subscriptions — the money goes straight to the platform owner's PayPal.
 * The customer approves on PayPal's page with a PayPal account OR as a guest
 * with a debit / credit card (where PayPal offers guest card checkout).
 * Product + billing plans are created automatically on the first checkout.
 *
 * Env: PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, PAYPAL_MODE (live|sandbox, default live),
 *      PAYPAL_WEBHOOK_ID (webhook verification), PAYPAL_API_BASE (tests only).
 */

export function paypalConfigured(): boolean {
  return Boolean(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET);
}

const base = () =>
  (process.env.PAYPAL_API_BASE || (process.env.PAYPAL_MODE === "sandbox" ? "https://api-m.sandbox.paypal.com" : "https://api-m.paypal.com")).replace(/\/$/, "");

let cached: { token: string; until: number } | null = null;

async function token(): Promise<string> {
  if (cached && cached.until > Date.now() + 30_000) return cached.token;
  const res = await fetch(`${base()}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
    signal: AbortSignal.timeout(15_000),
    cache: "no-store",
  });
  const j = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error_description?: string };
  if (!res.ok || !j.access_token) throw new Error(`paypal_auth_${res.status}:${j.error_description ?? ""}`);
  cached = { token: j.access_token, until: Date.now() + (j.expires_in ?? 300) * 1000 };
  return j.access_token;
}

async function pp<T = Record<string, unknown>>(path: string, init: { method?: "GET" | "POST"; body?: unknown; requestId?: string } = {}): Promise<T> {
  const res = await fetch(`${base()}${path}`, {
    method: init.method ?? "GET",
    headers: {
      Authorization: `Bearer ${await token()}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(init.requestId ? { "PayPal-Request-Id": init.requestId } : {}),
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
    signal: AbortSignal.timeout(20_000),
    cache: "no-store",
  });
  const text = await res.text();
  const j = (text ? JSON.parse(text) : {}) as T & { message?: string; name?: string };
  if (!res.ok) throw new Error(`paypal_${res.status}:${(j as { name?: string }).name ?? ""} ${(j as { message?: string }).message ?? ""}`.trim());
  return j;
}

/** Returns (and creates when needed) the PayPal billing plan for plan × interval at the current price. */
export async function ensurePayPalPlan(plan: string, interval: "month" | "year"): Promise<string> {
  const price = await planPrice(plan, interval);
  if (!price) throw new Error("no_price");
  const admin = createAdminClient();
  const { data: row } = await admin.from("billing_provider_plans").select("external_id, amount, currency").eq("provider", "paypal").eq("plan_key", plan).eq("billing_interval", interval).maybeSingle();
  if (row && Number(row.amount) === price.amount && row.currency === price.currency) return row.external_id as string;
  const product = await pp<{ id: string }>("/v1/catalogs/products", {
    method: "POST",
    requestId: `scc-product-${plan}`,
    body: { name: `Super Coder Cloud — ${plan.charAt(0).toUpperCase()}${plan.slice(1)}`, type: "SERVICE", category: "SOFTWARE" },
  });
  const created = await pp<{ id: string }>("/v1/billing/plans", {
    method: "POST",
    requestId: `scc-plan-${plan}-${interval}-${price.amount}-${price.currency}`,
    body: {
      product_id: product.id,
      name: `${plan} ${interval}`,
      status: "ACTIVE",
      billing_cycles: [
        {
          frequency: { interval_unit: interval === "year" ? "YEAR" : "MONTH", interval_count: 1 },
          tenure_type: "REGULAR",
          sequence: 1,
          total_cycles: 0,
          pricing_scheme: { fixed_price: { value: moneyString(price.amount), currency_code: price.currency } },
        },
      ],
      payment_preferences: { auto_bill_outstanding: true, payment_failure_threshold: 3, setup_fee_failure_action: "CONTINUE" },
    },
  });
  await admin
    .from("billing_provider_plans")
    .upsert({ provider: "paypal", plan_key: plan, billing_interval: interval, external_id: created.id, amount: price.amount, currency: price.currency }, { onConflict: "provider,plan_key,billing_interval" });
  return created.id;
}

export async function createPayPalSubscription(input: { orgId: string; plan: string; interval: "month" | "year"; email?: string | null; returnUrl: string; cancelUrl: string; locale: string }): Promise<string> {
  const planId = await ensurePayPalPlan(input.plan, input.interval);
  const sub = await pp<{ id: string; links?: { rel: string; href: string }[] }>("/v1/billing/subscriptions", {
    method: "POST",
    body: {
      plan_id: planId,
      custom_id: input.orgId,
      ...(input.email ? { subscriber: { email_address: input.email } } : {}),
      application_context: {
        brand_name: process.env.BILLING_BUSINESS_NAME || "Super Coder Cloud",
        locale: input.locale === "en" ? "en-US" : input.locale === "ar" ? "ar-EG" : "he-IL",
        shipping_preference: "NO_SHIPPING",
        user_action: "SUBSCRIBE_NOW",
        payment_method: { payer_selected: "PAYPAL", payee_preferred: "IMMEDIATE_PAYMENT_REQUIRED" },
        return_url: input.returnUrl,
        cancel_url: input.cancelUrl,
      },
    },
  });
  const approve = sub.links?.find((l) => l.rel === "approve")?.href;
  if (!approve) throw new Error("paypal_no_approve_link");
  return approve;
}

interface PayPalSubscription {
  id: string;
  status: string;
  plan_id: string;
  custom_id?: string;
  subscriber?: { email_address?: string; name?: { given_name?: string; surname?: string }; payer_id?: string };
  billing_info?: { next_billing_time?: string; last_payment?: { amount?: { value?: string; currency_code?: string }; time?: string } };
}

/** Pulls the subscription from PayPal and applies it (plan, status, period, payment + receipt). Idempotent. */
export async function syncPayPalSubscription(id: string): Promise<{ ok: boolean; orgId?: string; plan?: string; status?: string }> {
  if (!/^I-[A-Z0-9]{6,40}$/.test(id)) return { ok: false };
  const sub = await pp<PayPalSubscription>(`/v1/billing/subscriptions/${encodeURIComponent(id)}`);
  const orgId = sub.custom_id ?? "";
  if (!/^[0-9a-f-]{36}$/.test(orgId)) return { ok: false };
  const admin = createAdminClient();
  const { data: map } = await admin.from("billing_provider_plans").select("plan_key, billing_interval").eq("provider", "paypal").eq("external_id", sub.plan_id).maybeSingle();
  if (!map) return { ok: false };
  const status = paypalStatus(sub.status);
  if (status === "incomplete") return { ok: true, orgId, plan: map.plan_key as string, status };
  await applyPlan({
    orgId,
    plan: map.plan_key as string,
    status,
    provider: "paypal",
    customer: sub.subscriber?.payer_id ?? null,
    subscription: sub.id,
    interval: map.billing_interval as "month" | "year",
    periodEnd: sub.billing_info?.next_billing_time ?? null,
  });
  const last = sub.billing_info?.last_payment;
  if (last?.amount?.value && last.time) {
    await recordPayment({
      orgId,
      provider: "paypal",
      externalId: `${sub.id}:${last.time}`,
      plan: map.plan_key as string,
      interval: map.billing_interval as "month" | "year",
      amount: Number(last.amount.value),
      currency: last.amount.currency_code ?? "ILS",
      email: sub.subscriber?.email_address ?? null,
      name: [sub.subscriber?.name?.given_name, sub.subscriber?.name?.surname].filter(Boolean).join(" ") || null,
      periodEnd: sub.billing_info?.next_billing_time ?? null,
      meta: { subscription: sub.id },
    });
  }
  return { ok: true, orgId, plan: map.plan_key as string, status };
}

export async function cancelPayPalSubscription(id: string, reason = "Canceled by the customer") {
  await pp(`/v1/billing/subscriptions/${encodeURIComponent(id)}/cancel`, { method: "POST", body: { reason } });
}

/** Verifies a webhook with PayPal's verify-webhook-signature API. */
export async function verifyPayPalWebhook(headers: Headers, event: unknown): Promise<boolean> {
  const webhookId = process.env.PAYPAL_WEBHOOK_ID;
  if (!webhookId) return false;
  try {
    const r = await pp<{ verification_status?: string }>("/v1/notifications/verify-webhook-signature", {
      method: "POST",
      body: {
        auth_algo: headers.get("paypal-auth-algo"),
        cert_url: headers.get("paypal-cert-url"),
        transmission_id: headers.get("paypal-transmission-id"),
        transmission_sig: headers.get("paypal-transmission-sig"),
        transmission_time: headers.get("paypal-transmission-time"),
        webhook_id: webhookId,
        webhook_event: event,
      },
    });
    return r.verification_status === "SUCCESS";
  } catch {
    return false;
  }
}
