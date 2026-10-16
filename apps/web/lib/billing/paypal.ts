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
  (process.env.PAYPAL_API_BASE || ((process.env.PAYPAL_MODE ?? "").trim().toLowerCase() === "sandbox" ? "https://api-m.sandbox.paypal.com" : "https://api-m.paypal.com")).replace(/\/$/, "");

let cached: { token: string; until: number } | null = null;

async function token(): Promise<string> {
  if (cached && cached.until > Date.now() + 30_000) return cached.token;
  const res = await fetch(`${base()}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      // trimmed: a space / line break copied with the key is a common cause of "Client Authentication failed"
      Authorization: `Basic ${Buffer.from(`${(process.env.PAYPAL_CLIENT_ID ?? "").trim()}:${(process.env.PAYPAL_CLIENT_SECRET ?? "").trim()}`).toString("base64")}`,
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

/* ------------------------------------------- wave 11: card payment without a PayPal account */

/**
 * One-time PayPal order that opens straight on the card form (guest checkout):
 * the customer pays by debit / credit card WITHOUT a PayPal account (PayPal
 * decides availability by country / card). Pays one period in advance (month /
 * year), like crypto; a reminder is sent before it ends.
 */
export async function createPayPalCardOrder(input: { orgId: string; plan: string; interval: "month" | "year"; locale: string; returnUrl: string; cancelUrl: string }): Promise<string> {
  const price = await planPrice(input.plan, input.interval);
  if (!price) throw new Error("no_price");
  const { buildOrderRef } = await import("./payments-core");
  const nonce = Math.random().toString(36).slice(2, 12).replace(/[^a-z0-9]/gi, "") || "n0nce1";
  const ref = buildOrderRef(input.orgId, input.plan, input.interval, nonce);
  const order = await pp<{ id: string; links?: { rel: string; href: string }[] }>("/v2/checkout/orders", {
    method: "POST",
    requestId: `scc-order-${nonce}`,
    body: {
      intent: "CAPTURE",
      purchase_units: [
        {
          reference_id: `${input.plan}-${input.interval}`,
          custom_id: ref,
          description: `Super Coder Cloud — ${input.plan} (${input.interval === "year" ? "12 months" : "1 month"})`,
          amount: { currency_code: price.currency, value: moneyString(price.amount) },
        },
      ],
      payment_source: {
        paypal: {
          experience_context: {
            brand_name: (process.env.BILLING_BUSINESS_NAME || "Super Coder Cloud").slice(0, 127),
            locale: input.locale === "en" ? "en-US" : input.locale === "ar" ? "ar-EG" : "he-IL",
            landing_page: "GUEST_CHECKOUT",
            user_action: "PAY_NOW",
            shipping_preference: "NO_SHIPPING",
            return_url: input.returnUrl,
            cancel_url: input.cancelUrl,
          },
        },
      },
    },
  });
  const link = order.links?.find((l) => l.rel === "payer-action")?.href ?? order.links?.find((l) => l.rel === "approve")?.href;
  if (!link) throw new Error("paypal_no_payer_action_link");
  return link;
}

interface PayPalOrder {
  id: string;
  status: string;
  payer?: { payer_id?: string; email_address?: string; name?: { given_name?: string; surname?: string } };
  purchase_units?: {
    custom_id?: string;
    payments?: { captures?: { id: string; status: string; custom_id?: string; amount?: { value?: string; currency_code?: string } }[] };
  }[];
}

/**
 * Captures an approved card order (return page or webhook) and activates the plan for the
 * paid period. Idempotent: the same order never extends twice.
 */
export async function capturePayPalCardOrder(orderId: string): Promise<{ ok: boolean; orgId?: string; plan?: string; status?: string }> {
  if (!/^[A-Z0-9]{8,40}$/.test(orderId)) return { ok: false };
  let order: PayPalOrder;
  try {
    order = await pp<PayPalOrder>(`/v2/checkout/orders/${orderId}/capture`, { method: "POST", body: {}, requestId: `scc-capture-${orderId}` });
  } catch (e) {
    // already captured (return page + webhook) → read it
    if (!/ORDER_ALREADY_CAPTURED|422/.test((e as Error).message)) throw e;
    order = await pp<PayPalOrder>(`/v2/checkout/orders/${orderId}`);
  }
  const pu = order.purchase_units?.[0];
  const cap = pu?.payments?.captures?.[0];
  const { parseOrderRef, prepaidPeriodEnd } = await import("./payments-core");
  const ref = parseOrderRef(cap?.custom_id ?? pu?.custom_id);
  if (!ref) return { ok: false };
  if (order.status !== "COMPLETED" || !cap || cap.status !== "COMPLETED") return { ok: true, orgId: ref.org, plan: ref.plan, status: cap?.status ?? order.status };
  const admin = createAdminClient();
  const eventId = `order:${order.id}:captured`;
  const { error: dup } = await admin.from("billing_events").insert({ provider: "paypal", event_id: eventId, type: "order.captured", organization_id: ref.org });
  if (dup) return { ok: true, orgId: ref.org, plan: ref.plan, status: "COMPLETED" }; // already applied
  try {
    const { data: sub } = await admin.from("subscriptions").select("plan_key, status, current_period_end, provider, provider_subscription_id").eq("organization_id", ref.org).maybeSingle();
    const renewing = sub && sub.status === "active" && sub.plan_key === ref.plan && (sub.provider === "nowpayments" || String(sub.provider_subscription_id ?? "").startsWith("order:"));
    const periodEnd = prepaidPeriodEnd(ref.interval, renewing ? (sub.current_period_end as string | null) : null);
    await applyPlan({ orgId: ref.org, plan: ref.plan, status: "active", provider: "paypal", customer: order.payer?.payer_id ?? null, subscription: `order:${order.id}`, interval: ref.interval, periodEnd });
    await admin.from("subscriptions").update({ renewal_reminded_at: null }).eq("organization_id", ref.org);
    await recordPayment({
      orgId: ref.org,
      provider: "paypal",
      externalId: `capture:${cap.id}`,
      plan: ref.plan,
      interval: ref.interval,
      amount: Number(cap.amount?.value ?? 0),
      currency: cap.amount?.currency_code ?? "ILS",
      email: order.payer?.email_address ?? null,
      name: [order.payer?.name?.given_name, order.payer?.name?.surname].filter(Boolean).join(" ") || null,
      periodEnd,
      meta: { order: order.id, card: true },
    });
    return { ok: true, orgId: ref.org, plan: ref.plan, status: "COMPLETED" };
  } catch (e) {
    await admin.from("billing_events").delete().eq("provider", "paypal").eq("event_id", eventId);
    throw e;
  }
}

/** Human-readable reason for a failed checkout (shown to the business owner). */
export function paypalErrorCode(message: string): string {
  if (/paypal_auth_401|invalid_client|Client Authentication failed/i.test(message)) return "paypal_auth";
  if (/CURRENCY_NOT_SUPPORTED|currency/i.test(message)) return "paypal_currency";
  if (/PERMISSION_DENIED|NOT_AUTHORIZED|403/i.test(message)) return "paypal_permission";
  if (/no_price/.test(message)) return "no_price";
  if (/paypal_4\d\d/.test(message)) return "paypal_request";
  if (/paypal_5\d\d|timeout|aborted|fetch failed/i.test(message)) return "paypal_down";
  return "provider";
}
