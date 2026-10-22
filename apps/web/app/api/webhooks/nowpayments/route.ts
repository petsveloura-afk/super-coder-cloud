import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { cryptoConfigured } from "@/lib/billing/nowpayments";
import { parseOrderRef, prepaidPeriodEnd, verifyNowPaymentsSignature } from "@/lib/billing/payments-core";
import { applyPlan, planPrice, recordPayment } from "@/lib/billing/receipts";

export const dynamic = "force-dynamic";

interface Ipn {
  payment_id?: number | string;
  payment_status?: string;
  order_id?: string;
  price_amount?: number;
  price_currency?: string;
  pay_amount?: number;
  pay_currency?: string;
  actually_paid?: number;
}

/** POST /api/webhooks/nowpayments — crypto IPN (x-nowpayments-sig HMAC-SHA512 of the sorted JSON). */
export async function POST(request: NextRequest) {
  if (!cryptoConfigured() || !process.env.SUPABASE_SERVICE_ROLE_KEY) return NextResponse.json({ error: "not_configured" }, { status: 503 });
  const raw = await request.text();
  if (!verifyNowPaymentsSignature(raw, request.headers.get("x-nowpayments-sig"), process.env.NOWPAYMENTS_IPN_SECRET!)) {
    return NextResponse.json({ error: "invalid_signature" }, { status: 400 });
  }
  const ipn = JSON.parse(raw) as Ipn;
  // wave 18: AI credit pack (order_id "pack:<purchase>:<nonce>") — amount checked in the database
  if (String(ipn.order_id ?? "").startsWith("pack:")) {
    if (ipn.payment_status !== "finished") return NextResponse.json({ received: true, status: ipn.payment_status });
    const { processPackCrypto } = await import("@/lib/billing/packs");
    const r = await processPackCrypto(String(ipn.order_id), Number(ipn.price_amount ?? 0), String(ipn.price_currency ?? "usd"), String(ipn.payment_id ?? ""));
    return NextResponse.json({ received: true, pack: r.ok === true, error: r.ok ? undefined : r.error });
  }
  const ref = parseOrderRef(ipn.order_id);
  if (!ref) return NextResponse.json({ received: true, ignored: "bad_order" });
  // only the final state activates the plan
  if (ipn.payment_status !== "finished") return NextResponse.json({ received: true, status: ipn.payment_status });
  // wave 12: the plan is given only for its real price (invoice amount = plan price)
  const expected = await planPrice(ref.plan, ref.interval, true, ref.org).catch(() => null);
  if (expected && (String(ipn.price_currency ?? "").toUpperCase() !== expected.currency.toUpperCase() || Number(ipn.price_amount ?? 0) + 0.01 < expected.amount)) {
    console.error(`nowpayments ${ipn.payment_id}: amount mismatch (${ipn.price_amount} ${ipn.price_currency} for ${ref.plan}/${ref.interval})`);
    return NextResponse.json({ received: true, ignored: "amount_mismatch" });
  }
  const admin = createAdminClient();
  const eventId = `payment:${ipn.payment_id}:finished`;
  const { error: dup } = await admin.from("billing_events").insert({ provider: "nowpayments", event_id: eventId, type: "payment.finished", organization_id: ref.org });
  if (dup) {
    if (dup.code === "23505") return NextResponse.json({ received: true, duplicate: true });
    return NextResponse.json({ error: "store_failed" }, { status: 500 });
  }
  try {
    const { data: sub } = await admin.from("subscriptions").select("plan_key, status, current_period_end, provider").eq("organization_id", ref.org).maybeSingle();
    const renewing = sub && sub.provider === "nowpayments" && sub.plan_key === ref.plan && sub.status === "active";
    const periodEnd = prepaidPeriodEnd(ref.interval, renewing ? (sub.current_period_end as string | null) : null);
    await applyPlan({ orgId: ref.org, plan: ref.plan, status: "active", provider: "nowpayments", subscription: null, interval: ref.interval, periodEnd });
    await admin.from("subscriptions").update({ renewal_reminded_at: null }).eq("organization_id", ref.org);
    await recordPayment({
      orgId: ref.org,
      provider: "nowpayments",
      externalId: String(ipn.payment_id),
      plan: ref.plan,
      interval: ref.interval,
      amount: Number(ipn.price_amount ?? 0),
      currency: String(ipn.price_currency ?? "usd"),
      periodEnd,
      meta: { pay_amount: ipn.pay_amount ?? null, pay_currency: ipn.pay_currency ?? null, actually_paid: ipn.actually_paid ?? null },
    });
    return NextResponse.json({ received: true });
  } catch (err) {
    await admin.from("billing_events").delete().eq("provider", "nowpayments").eq("event_id", eventId);
    console.error("nowpayments ipn failed", (err as Error).message);
    return NextResponse.json({ error: "processing_failed" }, { status: 500 });
  }
}
