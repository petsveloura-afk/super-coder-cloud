import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { parsePackRef } from "./packs-core";

/**
 * Wave 18 — a credit pack payment is confirmed server to server (PayPal capture /
 * NOWPayments IPN), then grant_credit_purchase adds the credits exactly once
 * (it also checks the amount and currency against the purchase).
 */
export async function processPackPayPal(paypalOrderId: string): Promise<{ handled: boolean; ok?: boolean; orgId?: string; credits?: number; error?: string }> {
  const admin = createAdminClient();
  const { data: row } = await admin.from("credit_purchases").select("id, organization_id, status").eq("provider", "paypal").eq("provider_order_id", paypalOrderId).maybeSingle();
  if (!row) return { handled: false };
  if (row.status === "paid") return { handled: true, ok: true, orgId: row.organization_id as string };
  const { paypalCaptureOrder } = await import("./paypal");
  const order = await paypalCaptureOrder(paypalOrderId);
  if (!order?.capture || order.status !== "COMPLETED" || order.capture.status !== "COMPLETED") return { handled: true, ok: false, orgId: row.organization_id as string, error: "not_completed" };
  if (parsePackRef(order.customId) !== row.id) return { handled: true, ok: false, orgId: row.organization_id as string, error: "mismatch" };
  return grant(row.id as string, row.organization_id as string, order.capture.amount, order.capture.currency, `paypal:${order.capture.id}`);
}

export async function processPackCrypto(ref: string, amount: number, currency: string, paymentId: string): Promise<{ handled: boolean; ok?: boolean; orgId?: string; credits?: number; error?: string }> {
  const id = parsePackRef(ref);
  if (!id) return { handled: false };
  const admin = createAdminClient();
  const { data: row } = await admin.from("credit_purchases").select("id, organization_id").eq("id", id).eq("provider", "nowpayments").maybeSingle();
  if (!row) return { handled: true, ok: false, error: "not_found" };
  return grant(row.id as string, row.organization_id as string, amount, currency, `nowpayments:${paymentId}`);
}

async function grant(purchaseId: string, orgId: string, amount: number, currency: string, externalId: string) {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("grant_credit_purchase", { p_purchase: purchaseId, p_amount: amount, p_currency: currency.toUpperCase() });
  if (error) return { handled: true, ok: false, orgId, error: error.message };
  const r = (data ?? {}) as { ok: boolean; already?: boolean; credits?: number; error?: string };
  if (r.ok && !r.already) {
    const { recordPayment } = await import("./receipts");
    await recordPayment({ orgId, provider: externalId.startsWith("paypal") ? "paypal" : "nowpayments", externalId, plan: null, interval: null, amount, currency, meta: { credit_pack: purchaseId, credits: r.credits } }).catch(() => null);
  }
  return { handled: true, ok: r.ok, orgId, credits: r.credits, error: r.error };
}
