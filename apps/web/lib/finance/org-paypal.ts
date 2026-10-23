import "server-only";

/**
 * Wave 15 — card / PayPal payments into the BUSINESS'S OWN PayPal account (the
 * credentials are stored encrypted in finance_settings). Customers pay a quote's
 * invoice by card without a PayPal account (guest checkout) or with PayPal.
 * Tenant money never goes through the platform's PayPal.
 * API base overridable for tests (ORG_PAYPAL_API_BASE).
 */
export interface OrgPayPalCreds {
  clientId: string;
  secret: string;
  mode: "live" | "sandbox";
}

export function orgPayPalBase(mode: "live" | "sandbox"): string {
  return (process.env.ORG_PAYPAL_API_BASE || (mode === "sandbox" ? "https://api-m.sandbox.paypal.com" : "https://api-m.paypal.com")).replace(/\/$/, "");
}

export async function orgPayPalToken(c: OrgPayPalCreds): Promise<string> {
  const res = await fetch(`${orgPayPalBase(c.mode)}/v1/oauth2/token`, {
    method: "POST",
    headers: { Authorization: `Basic ${Buffer.from(`${c.clientId.trim()}:${c.secret.trim()}`).toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
    signal: AbortSignal.timeout(15_000),
    cache: "no-store",
  });
  const json = (await res.json().catch(() => ({}))) as { access_token?: string; error?: string; error_description?: string };
  if (!res.ok || !json.access_token) throw new Error(`paypal_auth:${res.status}:${json.error ?? "unknown"}`);
  return json.access_token;
}

async function call<T>(c: OrgPayPalCreds, path: string, init: { method?: "GET" | "POST"; body?: unknown; requestId?: string }): Promise<T> {
  const token = await orgPayPalToken(c);
  const res = await fetch(`${orgPayPalBase(c.mode)}${path}`, {
    method: init.method ?? "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init.requestId ? { "PayPal-Request-Id": init.requestId } : {}),
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
    signal: AbortSignal.timeout(20_000),
    cache: "no-store",
  });
  const json = (await res.json().catch(() => ({}))) as T & { name?: string; message?: string };
  if (!res.ok) throw new Error(`paypal_error:${res.status}:${json.name ?? json.message ?? "unknown"}`);
  return json;
}

/** Creates a one-time order for a document's open balance; returns the approve (checkout) link. */
export async function createOrgPayPalOrder(c: OrgPayPalCreds, input: { amount: number; currency: string; docToken: string; description: string; returnUrl: string; cancelUrl: string; locale: string; brand: string }): Promise<{ id: string; approveUrl: string }> {
  const o = await call<{ id: string; links?: { rel: string; href: string }[] }>(c, "/v2/checkout/orders", {
    method: "POST",
    requestId: `doc-${input.docToken}-${Math.round(input.amount * 100)}-${Date.now().toString(36)}`,
    body: {
      intent: "CAPTURE",
      purchase_units: [
        {
          custom_id: `doc:${input.docToken}`,
          description: input.description.slice(0, 127),
          amount: { currency_code: input.currency.toUpperCase(), value: input.amount.toFixed(2) },
        },
      ],
      payment_source: {
        paypal: {
          experience_context: {
            brand_name: input.brand.slice(0, 127),
            user_action: "PAY_NOW",
            shipping_preference: "NO_SHIPPING",
            landing_page: "GUEST_CHECKOUT",
            locale: input.locale === "en" ? "en-US" : input.locale === "ar" ? "ar-EG" : "he-IL",
            return_url: input.returnUrl,
            cancel_url: input.cancelUrl,
          },
        },
      },
    },
  });
  const approveUrl = o.links?.find((l) => l.rel === "payer-action" || l.rel === "approve")?.href;
  if (!o.id || !approveUrl) throw new Error("paypal_error:no_approve_link");
  return { id: o.id, approveUrl };
}

export interface OrgCapture {
  orderId: string;
  status: string;
  docToken: string | null;
  amount: number;
  currency: string;
  captureId: string | null;
}

/** Captures an approved order (idempotent: an already captured order is read back). */
export async function captureOrgPayPalOrder(c: OrgPayPalCreds, orderId: string): Promise<OrgCapture> {
  type Order = { id: string; status: string; purchase_units?: { custom_id?: string; payments?: { captures?: { id: string; status: string; amount: { value: string; currency_code: string } }[] }; amount?: { value: string; currency_code: string } }[] };
  let o: Order;
  try {
    o = await call<Order>(c, `/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, { method: "POST", requestId: `cap-${orderId}` });
  } catch (e) {
    if (!/422|ORDER_ALREADY_CAPTURED|UNPROCESSABLE/i.test((e as Error).message)) throw e;
    o = await call<Order>(c, `/v2/checkout/orders/${encodeURIComponent(orderId)}`, {});
  }
  const pu = o.purchase_units?.[0];
  const cap = pu?.payments?.captures?.find((x) => x.status === "COMPLETED") ?? pu?.payments?.captures?.[0];
  const custom = pu?.custom_id ?? "";
  return {
    orderId: o.id,
    status: cap?.status ?? o.status,
    docToken: custom.startsWith("doc:") ? custom.slice(4) : null,
    amount: Number(cap?.amount.value ?? pu?.amount?.value ?? 0),
    currency: cap?.amount.currency_code ?? pu?.amount?.currency_code ?? "",
    captureId: cap?.id ?? null,
  };
}

/** The organization's PayPal credentials (service role), or null when not connected. */
export async function loadOrgPayPal(orgId: string): Promise<OrgPayPalCreds | null> {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const { encryptionReady, openSecrets } = await import("@/lib/channels/secrets");
  if (!encryptionReady()) return null;
  const { data } = await createAdminClient().from("finance_settings").select("paypal_client_id, paypal_secret_enc, paypal_mode").eq("organization_id", orgId).maybeSingle();
  if (!data?.paypal_client_id || !data.paypal_secret_enc) return null;
  const secret = openSecrets(data.paypal_secret_enc as string).v;
  if (!secret) return null;
  return { clientId: data.paypal_client_id as string, secret, mode: data.paypal_mode === "sandbox" ? "sandbox" : "live" };
}
