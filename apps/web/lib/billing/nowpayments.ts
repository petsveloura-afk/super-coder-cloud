import "server-only";
import { randomBytes } from "node:crypto";
import { buildOrderRef, moneyString } from "./payments-core";
import { planPrice } from "./receipts";

/**
 * Crypto payments (NOWPayments) — the money goes to the platform owner's crypto
 * wallet (payout address set in the NOWPayments dashboard). One payment buys a
 * prepaid period (month / year); the customer gets a reminder before it ends.
 *
 * Env: NOWPAYMENTS_API_KEY, NOWPAYMENTS_IPN_SECRET, NOWPAYMENTS_API_BASE (tests / sandbox).
 */

export function cryptoConfigured(): boolean {
  return Boolean(process.env.NOWPAYMENTS_API_KEY && process.env.NOWPAYMENTS_IPN_SECRET);
}

const base = () => (process.env.NOWPAYMENTS_API_BASE || "https://api.nowpayments.io").replace(/\/$/, "");

export async function createCryptoInvoice(input: { orgId: string; plan: string; interval: "month" | "year"; ipnUrl: string; successUrl: string; cancelUrl: string }): Promise<string> {
  const price = await planPrice(input.plan, input.interval, true);
  if (!price) throw new Error("no_price");
  const res = await fetch(`${base()}/v1/invoice`, {
    method: "POST",
    headers: { "x-api-key": process.env.NOWPAYMENTS_API_KEY!, "Content-Type": "application/json" },
    body: JSON.stringify({
      price_amount: Number(moneyString(price.amount)),
      price_currency: "usd",
      order_id: buildOrderRef(input.orgId, input.plan, input.interval, randomBytes(6).toString("hex")),
      order_description: `Super Coder Cloud ${input.plan} (${input.interval})`,
      ipn_callback_url: input.ipnUrl,
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
      is_fixed_rate: true,
      is_fee_paid_by_user: false,
    }),
    signal: AbortSignal.timeout(20_000),
    cache: "no-store",
  });
  const j = (await res.json().catch(() => ({}))) as { invoice_url?: string; message?: string };
  if (!res.ok || !j.invoice_url) throw new Error(`nowpayments_${res.status}:${j.message ?? ""}`);
  return j.invoice_url;
}
