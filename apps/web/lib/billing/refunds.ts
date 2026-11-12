import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { isFullRefund, refundAmount, refundedPaymentIds, storedIdsFor } from "./refunds-core";

/**
 * Round 12 — a refund / chargeback from PayPal: the payment is marked "refunded" (its receipt stays — a refund never deletes
 * a receipt), a credit pack's credits are taken back once (never below zero), a plan bought by card goes back to its
 * previous state through the normal subscription sync, and the business owners are notified. Never throws.
 */
export async function processRefundEvent(type: string, resource: Record<string, unknown>): Promise<{ handled: boolean; orgId?: string; payments: number; credits: number }> {
  const out = { handled: false as boolean, orgId: undefined as string | undefined, payments: 0, credits: 0 };
  try {
    const ids = refundedPaymentIds(type, resource);
    if (!ids.length) return out;
    const admin = createAdminClient();
    const candidates = ids.flatMap(storedIdsFor);
    const { data } = await admin.from("billing_payments").select("id, organization_id, external_id, amount, status, meta").eq("provider", "paypal").in("external_id", candidates).limit(5);
    const rows = (data ?? []) as { id: string; organization_id: string; external_id: string; amount: number; status: string; meta: Record<string, unknown> | null }[];
    const { amount: refunded } = refundAmount(resource);
    for (const p of rows) {
      out.handled = true;
      out.orgId = p.organization_id;
      const full = isFullRefund(type, Number(p.amount), refunded);
      const meta = { ...(p.meta ?? {}), refund: { type, amount: refunded, full, at: new Date().toISOString() } };
      if (p.status === "paid") {
        await admin.from("billing_payments").update(full ? { status: "refunded", refunded_at: new Date().toISOString(), meta } : { meta }).eq("id", p.id);
        out.payments++;
      }
      // a credit pack: take its credits back (full refund / chargeback only)
      const pack = typeof p.meta?.credit_pack === "string" ? (p.meta.credit_pack as string) : null;
      if (pack && full) {
        const { data: r } = await admin.rpc("revoke_credit_purchase", { p_purchase: pack, p_note: type.endsWith(".REVERSED") ? "chargeback" : "payment refunded" });
        out.credits += Number((r as { credits?: number } | null)?.credits ?? 0);
      }
    }
    if (out.handled && out.orgId && !rows.some((p) => typeof p.meta?.credit_pack === "string")) {
      // a plan payment was refunded — the owners hear it (the plan itself follows the provider's subscription state)
      await notifyOwners(out.orgId, "billing.refundedNotification", { amount: refunded ?? 0 });
    }
    return out;
  } catch (e) {
    console.error("refund processing failed", (e as Error).message.slice(0, 200));
    return out;
  }
}

/** a subscription payment failed at PayPal — the owners are told to update the payment method before the plan stops */
export async function notifyPaymentFailed(orgId: string): Promise<void> {
  await notifyOwners(orgId, "billing.paymentFailedNotification", {}).catch(() => undefined);
}

async function notifyOwners(orgId: string, key: string, params: Record<string, unknown>): Promise<void> {
  const admin = createAdminClient();
  const { data: members } = await admin.from("organization_members").select("user_id").eq("organization_id", orgId).in("role", ["agency_owner", "owner", "admin"]).limit(20);
  const rows = ((members ?? []) as { user_id: string }[]).map((m) => ({ organization_id: orgId, user_id: m.user_id, kind: "billing", title_key: key, params, link: "/billing" }));
  if (rows.length) await admin.from("notifications").insert(rows);
}
