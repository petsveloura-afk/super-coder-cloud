import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { shopifyCheckout, shopifyOrder, validShopDomain, verifyShopifyWebhook } from "@/lib/stores/core";

export const dynamic = "force-dynamic";

/**
 * Wave 19 — Shopify webhooks (one URL for every store): orders, checkouts (abandoned carts),
 * uninstall, and Shopify's mandatory privacy topics (customers/data_request, customers/redact, shop/redact).
 */
export async function POST(request: NextRequest) {
  const raw = await request.text();
  if (!verifyShopifyWebhook(raw, request.headers.get("x-shopify-hmac-sha256"), process.env.SHOPIFY_CLIENT_SECRET ?? "")) return NextResponse.json({ ok: false }, { status: 401 });
  const topic = request.headers.get("x-shopify-topic") ?? "";
  const shop = validShopDomain(request.headers.get("x-shopify-shop-domain"));
  if (!shop) return NextResponse.json({ ok: true });
  const admin = createAdminClient();
  const { data: integ } = await admin.from("integrations").select("id, organization_id, status").eq("provider", "shopify").eq("config->>shop", shop).maybeSingle();
  if (!integ) return NextResponse.json({ ok: true });
  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(raw || "{}") as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: true });
  }
  const org = integ.organization_id as string;
  if (topic === "app/uninstalled" || topic === "shop/redact") {
    await admin.from("integrations").update({ status: "disabled", last_error: "uninstalled" }).eq("id", integ.id);
    return NextResponse.json({ ok: true });
  }
  if (topic === "customers/redact") {
    // the shop asked to erase a customer: remove the store copies (the CRM contact stays the business's own record)
    const email = String((body.customer as { email?: string } | undefined)?.email ?? "").toLowerCase();
    if (email) {
      await admin.from("store_orders").update({ email: null, phone: null, customer_name: null }).eq("organization_id", org).eq("source", "shopify").eq("email", email);
      await admin.from("store_carts").delete().eq("organization_id", org).eq("source", "shopify").eq("email", email);
    }
    return NextResponse.json({ ok: true });
  }
  if (topic === "customers/data_request") return NextResponse.json({ ok: true });
  if (integ.status === "disabled") return NextResponse.json({ ok: true });
  if (topic.startsWith("orders/")) {
    const order = shopifyOrder(body);
    if (order) await admin.rpc("record_store_order", { p_org: org, p_source: "shopify", p_order: order });
  } else if (topic.startsWith("checkouts/")) {
    const cart = shopifyCheckout(body);
    if (cart && !body.completed_at) await admin.rpc("record_store_cart", { p_org: org, p_source: "shopify", p_cart: cart });
  }
  await admin.from("integrations").update({ last_success_at: new Date().toISOString(), last_error: null }).eq("id", integ.id);
  const { kickJobs } = await import("@/lib/jobs/kick");
  kickJobs();
  return NextResponse.json({ ok: true });
}
