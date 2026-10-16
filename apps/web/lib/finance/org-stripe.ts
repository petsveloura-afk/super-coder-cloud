import "server-only";
import { stripeForm } from "@scc/shared/stripe";

/**
 * One-time card payments into the ORGANIZATION'S OWN Stripe account (its keys are
 * stored encrypted in finance_settings) — tenant money never goes through the
 * platform's account. API base overridable for tests (PAYMENT_PROVIDER_API_BASE).
 */
const API = () => (process.env.PAYMENT_PROVIDER_API_BASE || "https://api.stripe.com/v1").replace(/\/$/, "");

export async function createDocumentCheckout(secretKey: string, input: {
  amount: number;
  currency: string;
  name: string;
  documentToken: string;
  successUrl: string;
  cancelUrl: string;
  email?: string | null;
}): Promise<string> {
  const res = await fetch(`${API()}/checkout/sessions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${secretKey}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: stripeForm({
      mode: "payment",
      line_items: [{ quantity: 1, price_data: { currency: input.currency.toLowerCase(), unit_amount: Math.round(input.amount * 100), product_data: { name: input.name.slice(0, 250) } } }],
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
      customer_email: input.email ?? undefined,
      metadata: { kind: "document_payment", document_token: input.documentToken },
      payment_intent_data: { metadata: { kind: "document_payment", document_token: input.documentToken } },
    }),
    signal: AbortSignal.timeout(20_000),
    cache: "no-store",
  });
  const json = (await res.json().catch(() => ({}))) as { url?: string; error?: { message?: string } };
  if (!res.ok || !json.url) throw new Error(`stripe_error:${res.status}:${json.error?.message ?? "unknown"}`);
  return json.url;
}
