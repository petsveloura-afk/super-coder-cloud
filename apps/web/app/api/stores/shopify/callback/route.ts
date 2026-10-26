import { NextResponse, type NextRequest } from "next/server";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { getOrgContext } from "@/lib/auth";
import { isLocale } from "@/lib/i18n/config";
import { validShopDomain, verifyShopifyQuery } from "@/lib/stores/core";
import { shopifyBackfill, shopifyExchange, shopifyRegisterWebhooks } from "@/lib/stores/shopify";
import { encryptionReady } from "@/lib/channels/secrets";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Shopify OAuth redirect: verifies state + HMAC, stores the token (encrypted), registers webhooks. */
export async function GET(request: NextRequest) {
  const cookie = request.cookies.get("scc_shopify")?.value ?? "";
  const [state = "", cl = "", orgId = "", cookieShop = ""] = cookie.split(".").length >= 4 ? [cookie.split(".")[0], cookie.split(".")[1], cookie.split(".")[2], cookie.split(".").slice(3).join(".")] : [];
  const locale = isLocale(cl) ? cl : "he";
  const back = new URL(`/${locale}/integrations`, request.url);
  back.hash = "stores";
  const done = (status: string, detail?: string) => {
    back.searchParams.set("store", status);
    if (detail) back.searchParams.set("detail", detail.slice(0, 160));
    const res = NextResponse.redirect(back);
    res.cookies.set("scc_shopify", "", { path: "/api/stores", maxAge: 0 });
    return res;
  };
  const sp = request.nextUrl.searchParams;
  const shop = validShopDomain(sp.get("shop"));
  const given = sp.get("state") ?? "";
  if (!shop || shop !== cookieShop) return done("failed", "shop");
  if (!state || given.length !== state.length || !timingSafeEqual(Buffer.from(given), Buffer.from(state))) return done("failed", "state");
  if (!verifyShopifyQuery(sp, process.env.SHOPIFY_CLIENT_SECRET ?? "")) return done("failed", "hmac");
  const code = sp.get("code");
  if (!code) return done("cancelled");
  const ctx = await getOrgContext(locale);
  if (!ctx.can("integrations.manage") || ctx.org.id !== orgId) return done("forbidden");
  if (!encryptionReady()) return done("failed", "encryption_key_missing");
  const tok = await shopifyExchange(shop, code);
  if (!tok.ok || !tok.token) return done("failed", tok.error ?? "token");
  const { saveIntegration } = await import("@/lib/integrations/store");
  await saveIntegration(ctx.org.id, "shopify", { shop, scope: tok.scope ?? "", connected_at: new Date().toISOString(), nonce: randomBytes(4).toString("hex") }, { access_token: tok.token });
  const hooks = await shopifyRegisterWebhooks(shop, tok.token);
  if (hooks.failed.length) {
    const { createAdminClient } = await import("@/lib/supabase/admin");
    await createAdminClient().from("integrations").update({ last_error: `webhooks: ${hooks.failed.join(", ")}`.slice(0, 500) }).eq("organization_id", ctx.org.id).eq("provider", "shopify");
  }
  // wave 26: fill the CRM right away with the latest orders + abandoned carts (best effort, never blocks the connection)
  const filled = await shopifyBackfill(ctx.org.id, shop, tok.token).catch(() => ({ orders: 0, carts: 0 }));
  return done("connected", `${filled.orders}/${filled.carts}`);
}
