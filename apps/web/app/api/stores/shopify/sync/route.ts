import { NextResponse, type NextRequest } from "next/server";
import { getOrgContext } from "@/lib/auth";
import { isLocale } from "@/lib/i18n/config";
import { shopifyBackfill, shopifyPing, shopifyRegisterWebhooks } from "@/lib/stores/shopify";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/stores/shopify/sync  { action: "sync" | "disconnect", locale }
 * Wave 26 — "sync now" (re-checks the token, re-registers webhooks, re-imports recent orders + carts)
 * and a clean disconnect. Needs integrations.manage in the current organization.
 */
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as { action?: string; locale?: string };
  const locale = isLocale(body.locale) ? body.locale : "he";
  const ctx = await getOrgContext(locale);
  if (!ctx.can("integrations.manage")) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const { loadIntegration, removeIntegration, markIntegration } = await import("@/lib/integrations/store");
  const integ = await loadIntegration(ctx.org.id, "shopify");
  if (!integ) return NextResponse.json({ ok: false, error: "not_connected" }, { status: 404 });
  if (body.action === "disconnect") {
    await removeIntegration(ctx.org.id, "shopify");
    return NextResponse.json({ ok: true, disconnected: true });
  }
  const shop = String((integ.config as { shop?: string }).shop ?? "");
  const token = integ.secrets.access_token;
  if (!shop || !token) return NextResponse.json({ ok: false, error: "no_token" }, { status: 409 });
  const ping = await shopifyPing(shop, token);
  if (!ping.ok) {
    await markIntegration(integ.id, false, ping.status === 401 || ping.status === 403 ? "token_revoked" : `shop_unreachable:${ping.status}`);
    return NextResponse.json({ ok: false, error: ping.status === 401 || ping.status === 403 ? "token_revoked" : "unreachable" }, { status: 502 });
  }
  const hooks = await shopifyRegisterWebhooks(shop, token);
  const filled = await shopifyBackfill(ctx.org.id, shop, token);
  await markIntegration(integ.id, !filled.error, filled.error ?? (hooks.failed.length ? hooks.failed.join(",") : null));
  // wave 28: orders imported fine but live webhooks failed → keep that visible as a warning (not an error)
  if (!filled.error && hooks.failed.length) {
    const { createAdminClient } = await import("@/lib/supabase/admin");
    await createAdminClient().from("integrations").update({ last_error: `webhooks: ${hooks.failed.join(", ")}`.slice(0, 500) }).eq("id", integ.id);
  }
  return NextResponse.json({ ok: true, name: ping.name ?? null, orders: filled.orders, carts: filled.carts, webhooks: hooks.ok, webhookErrors: hooks.failed });
}
