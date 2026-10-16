import { NextResponse, type NextRequest } from "next/server";
import { verifyStripeSignature } from "@scc/shared/stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { encryptionReady, openSecrets } from "@/lib/channels/secrets";

export const dynamic = "force-dynamic";

/**
 * POST /api/webhooks/payments/{stripe_webhook_token}
 * Webhook endpoint the ORGANIZATION registers in its own Stripe dashboard
 * (event: checkout.session.completed). The token identifies the org; the payload is
 * verified with that org's own whsec_ secret; the payment is recorded idempotently
 * (unique external_id), which marks the invoice paid and fires invoice.paid automations.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!/^[a-f0-9]{48}$/.test(token) || !process.env.SUPABASE_SERVICE_ROLE_KEY || !encryptionReady()) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const admin = createAdminClient();
  const { data: settings } = await admin
    .from("finance_settings")
    .select("organization_id, stripe_webhook_secret_enc")
    .eq("stripe_webhook_token", token)
    .maybeSingle();
  if (!settings?.stripe_webhook_secret_enc) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const secret = openSecrets(settings.stripe_webhook_secret_enc as string).v;
  const raw = await request.text();
  if (!secret || !verifyStripeSignature(raw, request.headers.get("stripe-signature"), secret)) {
    return NextResponse.json({ error: "invalid_signature" }, { status: 400 });
  }
  let event: { id?: string; type?: string; data?: { object?: Record<string, unknown> } };
  try {
    event = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  if (event.type !== "checkout.session.completed" && event.type !== "checkout.session.async_payment_succeeded") {
    return NextResponse.json({ received: true, ignored: event.type ?? null });
  }
  const s = (event.data?.object ?? {}) as { id?: string; payment_status?: string; amount_total?: number; metadata?: Record<string, string>; payment_intent?: string };
  if (s.metadata?.kind !== "document_payment" || !s.metadata.document_token) return NextResponse.json({ received: true, ignored: "not_document" });
  if (s.payment_status !== "paid") return NextResponse.json({ received: true, ignored: "unpaid" });
  const { data: doc } = await admin
    .from("documents")
    .select("id")
    .eq("public_token", s.metadata.document_token)
    .eq("organization_id", settings.organization_id)
    .eq("kind", "invoice")
    .maybeSingle();
  if (!doc) return NextResponse.json({ received: true, ignored: "unknown_document" });
  const amount = Math.round(Number(s.amount_total ?? 0)) / 100;
  if (!(amount > 0)) return NextResponse.json({ received: true, ignored: "zero_amount" });
  const { error } = await admin.rpc("record_online_payment", {
    p_token: s.metadata.document_token,
    p_amount: amount,
    p_external_id: String(s.payment_intent ?? s.id ?? event.id).slice(0, 190),
  });
  if (error) return NextResponse.json({ error: "store_failed" }, { status: 500 });
  return NextResponse.json({ received: true });
}
