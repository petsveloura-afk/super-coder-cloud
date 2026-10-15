import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { isPlanKey, normaliseStatus, planForPrice } from "@scc/shared/billing";
import { verifyStripeSignature } from "@scc/shared/stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSubscription, periodEnd, stripeConfigured, type StripeSubscription } from "@/lib/billing/stripe";

export const dynamic = "force-dynamic";

const uuid = z.uuid();

/**
 * POST /api/webhooks/stripe
 *  1. verify Stripe-Signature (HMAC, 5-min replay window)
 *  2. idempotency: each event id is recorded once in billing_events
 *  3. sync subscription → apply_subscription() (service role) → organizations.plan
 * Plans are NEVER changed from the browser; only verified events change them.
 */
export async function POST(request: NextRequest) {
  if (!stripeConfigured() || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }
  const raw = await request.text();
  if (!verifyStripeSignature(raw, request.headers.get("stripe-signature"), process.env.PAYMENT_WEBHOOK_SECRET!)) {
    return NextResponse.json({ error: "invalid_signature" }, { status: 400 });
  }

  let event: { id: string; type: string; data: { object: Record<string, unknown> } };
  try {
    event = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { error: dupError } = await admin
    .from("billing_events")
    .insert({ provider: "stripe", event_id: String(event.id).slice(0, 200), type: String(event.type).slice(0, 120) });
  if (dupError) {
    if (dupError.code === "23505") return NextResponse.json({ received: true, duplicate: true });
    return NextResponse.json({ error: "store_failed" }, { status: 500 });
  }

  try {
    let sub: StripeSubscription | null = null;
    let orgHint: string | undefined;

    if (event.type === "checkout.session.completed") {
      const s = event.data.object as { client_reference_id?: string; subscription?: string; metadata?: Record<string, string> };
      orgHint = s.client_reference_id ?? s.metadata?.org_id;
      if (s.subscription) sub = await getSubscription(s.subscription);
    } else if (event.type.startsWith("customer.subscription.")) {
      sub = event.data.object as unknown as StripeSubscription;
      if (event.type === "customer.subscription.deleted") sub = { ...sub, status: "canceled" };
    } else {
      return NextResponse.json({ received: true, ignored: event.type });
    }
    if (!sub) return NextResponse.json({ received: true, ignored: "no_subscription" });

    const orgId = sub.metadata?.org_id ?? orgHint;
    if (!uuid.safeParse(orgId).success) return NextResponse.json({ received: true, ignored: "no_org" });

    const priceId = sub.items?.data?.[0]?.price?.id ?? "";
    const mapped = planForPrice(priceId, process.env);
    const plan = mapped?.plan ?? (isPlanKey(sub.metadata?.plan) ? sub.metadata!.plan : null);
    if (!plan) return NextResponse.json({ received: true, ignored: "unknown_price" });

    const { error } = await admin.rpc("apply_subscription", {
      p_org: orgId,
      p_plan: plan,
      p_status: normaliseStatus(sub.status),
      p_provider: "stripe",
      p_customer: typeof sub.customer === "string" ? sub.customer : null,
      p_subscription: sub.id,
      p_interval: mapped?.interval ?? null,
      p_period_end: periodEnd(sub),
      p_cancel: Boolean(sub.cancel_at_period_end),
    });
    if (error) throw new Error(error.message);
    await admin.from("billing_events").update({ organization_id: orgId }).eq("provider", "stripe").eq("event_id", event.id);
    return NextResponse.json({ received: true });
  } catch (err) {
    // Remove the idempotency record so Stripe's automatic retry can be processed.
    await admin.from("billing_events").delete().eq("provider", "stripe").eq("event_id", event.id);
    console.error("stripe webhook failed", (err as Error).message);
    return NextResponse.json({ error: "processing_failed" }, { status: 500 });
  }
}
