import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { hookHash, verifyWooWebhook, wooOrder } from "@/lib/stores/core";

export const dynamic = "force-dynamic";

/** Wave 19 — WooCommerce order webhooks (?h=<store token>, body signed with the same token). */
export async function POST(request: NextRequest) {
  const h = request.nextUrl.searchParams.get("h") ?? "";
  if (!/^[a-f0-9]{48}$/.test(h)) return NextResponse.json({ ok: false }, { status: 404 });
  const raw = await request.text();
  const admin = createAdminClient();
  const { data: integ } = await admin.from("integrations").select("id, organization_id, status").eq("provider", "woocommerce").eq("config->>hook_hash", hookHash(h)).maybeSingle();
  if (!integ) return NextResponse.json({ ok: false }, { status: 404 });
  // WooCommerce pings a new webhook with "webhook_id=…" (form) — answer 200
  if (!request.headers.get("x-wc-webhook-signature")) return NextResponse.json({ ok: true });
  if (!verifyWooWebhook(raw, request.headers.get("x-wc-webhook-signature"), h)) return NextResponse.json({ ok: false }, { status: 401 });
  if (integ.status === "disabled") return NextResponse.json({ ok: true });
  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(raw || "{}") as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: true });
  }
  const topic = request.headers.get("x-wc-webhook-topic") ?? "";
  if (topic.startsWith("order.")) {
    const order = wooOrder(body);
    // only orders that count as sales (paid / processing / completed)
    if (order && ["processing", "completed", "on-hold"].includes(order.status)) await admin.rpc("record_store_order", { p_org: integ.organization_id, p_source: "woocommerce", p_order: order });
  }
  await admin.from("integrations").update({ last_success_at: new Date().toISOString(), last_error: null, status: "active" }).eq("id", integ.id);
  const { kickJobs } = await import("@/lib/jobs/kick");
  kickJobs();
  return NextResponse.json({ ok: true });
}
