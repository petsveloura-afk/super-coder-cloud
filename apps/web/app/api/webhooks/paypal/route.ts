import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { paypalConfigured, syncPayPalSubscription, verifyPayPalWebhook } from "@/lib/billing/paypal";
import { recordPayment } from "@/lib/billing/receipts";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/webhooks/paypal — subscription lifecycle + payments.
 * Verified with PayPal's verify-webhook-signature (PAYPAL_WEBHOOK_ID); each event once (billing_events).
 * Events: BILLING.SUBSCRIPTION.* (ACTIVATED/UPDATED/CANCELLED/SUSPENDED/EXPIRED), PAYMENT.SALE.COMPLETED.
 */
export async function POST(request: NextRequest) {
  if (!paypalConfigured() || !process.env.SUPABASE_SERVICE_ROLE_KEY) return NextResponse.json({ error: "not_configured" }, { status: 503 });
  const raw = await request.text();
  let event: { id?: string; event_type?: string; resource?: Record<string, unknown> };
  try {
    event = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  if (!(await verifyPayPalWebhook(request.headers, event))) return NextResponse.json({ error: "invalid_signature" }, { status: 400 });

  const admin = createAdminClient();
  const id = String(event.id ?? "").slice(0, 200);
  const { error: dup } = await admin.from("billing_events").insert({ provider: "paypal", event_id: id, type: String(event.event_type ?? "").slice(0, 120) });
  if (dup) {
    if (dup.code === "23505") return NextResponse.json({ received: true, duplicate: true });
    return NextResponse.json({ error: "store_failed" }, { status: 500 });
  }
  try {
    const type = String(event.event_type ?? "");
    const r = event.resource ?? {};
    if (type.startsWith("BILLING.SUBSCRIPTION.")) {
      const out = await syncPayPalSubscription(String(r.id ?? ""));
      if (out.orgId) await admin.from("billing_events").update({ organization_id: out.orgId }).eq("provider", "paypal").eq("event_id", id);
    } else if (type === "CHECKOUT.ORDER.APPROVED" || type === "PAYMENT.CAPTURE.COMPLETED") {
      // wave 11: card payments (one-time order) — captured even if the customer closed the page before returning
      const orderId = type === "CHECKOUT.ORDER.APPROVED" ? String(r.id ?? "") : String(((r.supplementary_data as { related_ids?: { order_id?: string } } | undefined)?.related_ids?.order_id) ?? "");
      const { capturePayPalCardOrder } = await import("@/lib/billing/paypal");
      if (orderId) {
        const out = await capturePayPalCardOrder(orderId);
        if (out.orgId) await admin.from("billing_events").update({ organization_id: out.orgId }).eq("provider", "paypal").eq("event_id", id);
      }
    } else if (type === "PAYMENT.SALE.COMPLETED") {
      const subId = String(r.billing_agreement_id ?? "");
      const out = await syncPayPalSubscription(subId);
      const amount = r.amount as { total?: string; currency?: string } | undefined;
      if (out.ok && out.orgId && amount?.total) {
        await recordPayment({ orgId: out.orgId, provider: "paypal", externalId: String(r.id ?? id), plan: out.plan ?? null, interval: null, amount: Number(amount.total), currency: amount.currency ?? "ILS", meta: { subscription: subId, sale: r.id } });
      }
    }
    return NextResponse.json({ received: true });
  } catch (err) {
    await admin.from("billing_events").delete().eq("provider", "paypal").eq("event_id", id);
    console.error("paypal webhook failed", (err as Error).message);
    return NextResponse.json({ error: "processing_failed" }, { status: 500 });
  }
}
