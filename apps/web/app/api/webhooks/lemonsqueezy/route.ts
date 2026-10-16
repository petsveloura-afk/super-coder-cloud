import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { lemonConfigured, planForLemonVariant } from "@/lib/billing/lemonsqueezy";
import { lemonStatus, verifyLemonSignature } from "@/lib/billing/payments-core";
import { applyPlan, recordPayment } from "@/lib/billing/receipts";

export const dynamic = "force-dynamic";

interface LemonEvent {
  meta?: { event_name?: string; custom_data?: { org_id?: string; plan?: string; interval?: string }; webhook_id?: string };
  data?: { id?: string; type?: string; attributes?: Record<string, unknown> };
}

/** POST /api/webhooks/lemonsqueezy — X-Signature HMAC-SHA256; subscription + payment events. */
export async function POST(request: NextRequest) {
  if (!lemonConfigured() || !process.env.SUPABASE_SERVICE_ROLE_KEY) return NextResponse.json({ error: "not_configured" }, { status: 503 });
  const raw = await request.text();
  if (!verifyLemonSignature(raw, request.headers.get("x-signature"), process.env.LEMONSQUEEZY_WEBHOOK_SECRET!)) {
    return NextResponse.json({ error: "invalid_signature" }, { status: 400 });
  }
  const ev = JSON.parse(raw || "{}") as LemonEvent;
  const name = ev.meta?.event_name ?? "";
  const a = ev.data?.attributes ?? {};
  const orgId = ev.meta?.custom_data?.org_id ?? "";
  if (!/^[0-9a-f-]{36}$/.test(orgId)) return NextResponse.json({ received: true, ignored: "no_org" });
  const admin = createAdminClient();
  const eventId = `${name}:${ev.data?.id ?? ""}:${String(a.updated_at ?? a.created_at ?? "")}`.slice(0, 200);
  const { error: dup } = await admin.from("billing_events").insert({ provider: "lemonsqueezy", event_id: eventId, type: name.slice(0, 120), organization_id: orgId });
  if (dup) {
    if (dup.code === "23505") return NextResponse.json({ received: true, duplicate: true });
    return NextResponse.json({ error: "store_failed" }, { status: 500 });
  }
  try {
    if (name.startsWith("subscription_") && ev.data?.type === "subscriptions") {
      const mapped = planForLemonVariant(a.variant_id as number) ?? (ev.meta?.custom_data?.plan ? { plan: ev.meta.custom_data.plan, interval: (ev.meta.custom_data.interval === "year" ? "year" : "month") as "month" | "year" } : null);
      if (!mapped) return NextResponse.json({ received: true, ignored: "unknown_variant" });
      const st = lemonStatus(String(a.status ?? ""));
      await applyPlan({
        orgId,
        plan: mapped.plan,
        status: st.status,
        provider: "lemonsqueezy",
        customer: a.customer_id != null ? String(a.customer_id) : null,
        subscription: ev.data.id ?? null,
        interval: mapped.interval,
        periodEnd: (st.cancelAtPeriodEnd ? (a.ends_at as string) : (a.renews_at as string)) ?? null,
        cancel: st.cancelAtPeriodEnd,
      });
    }
    if (name === "subscription_payment_success" || name === "order_created") {
      const cents = Number(a.total ?? a.subtotal ?? 0);
      const mapped = ev.meta?.custom_data?.plan ? { plan: ev.meta.custom_data.plan, interval: (ev.meta.custom_data.interval === "year" ? "year" : "month") as "month" | "year" } : null;
      if (cents > 0) {
        await recordPayment({
          orgId,
          provider: "lemonsqueezy",
          externalId: `${ev.data?.type ?? "x"}:${ev.data?.id ?? eventId}`,
          plan: mapped?.plan ?? null,
          interval: mapped?.interval ?? null,
          amount: cents / 100,
          currency: String(a.currency ?? "USD"),
          email: (a.user_email as string | undefined) ?? null,
          name: (a.user_name as string | undefined) ?? null,
          meta: { receipt_url: (a.urls as { invoice_url?: string; receipt?: string } | undefined)?.invoice_url ?? null },
        });
      }
    }
    return NextResponse.json({ received: true });
  } catch (err) {
    await admin.from("billing_events").delete().eq("provider", "lemonsqueezy").eq("event_id", eventId);
    console.error("lemonsqueezy webhook failed", (err as Error).message);
    return NextResponse.json({ error: "processing_failed" }, { status: 500 });
  }
}
