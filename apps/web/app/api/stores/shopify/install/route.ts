import { NextResponse, type NextRequest } from "next/server";
import { validShopDomain, verifyShopifyQuery } from "@/lib/stores/core";
import { shopifyConfigured } from "@/lib/stores/shopify";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * Wave 24 — the Shopify "App URL": a merchant installs (or opens) the app from Shopify, Shopify sends
 * them here with ?shop=&hmac=&timestamp=. We verify Shopify's signature and continue straight into
 * OAuth (Shopify's review requires immediate authentication). Not signed in → sign in first, then back.
 */
export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const shop = validShopDomain(sp.get("shop"));
  const home = new URL("/he/integrations", request.url);
  home.hash = "stores";
  if (!shop || !shopifyConfigured()) return NextResponse.redirect(home);
  const ts = Number(sp.get("timestamp") ?? 0);
  const fresh = Number.isFinite(ts) && Math.abs(Date.now() / 1000 - ts) < 24 * 3600;
  if (!sp.get("hmac") || !fresh || !verifyShopifyQuery(sp, process.env.SHOPIFY_CLIENT_SECRET ?? "")) {
    return NextResponse.json({ ok: false, error: "invalid_signature" }, { status: 401 });
  }
  const connect = `/he/connect/shopify?shop=${encodeURIComponent(shop)}`;
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return NextResponse.redirect(new URL(`/he/login?next=${encodeURIComponent(connect)}`, request.url));
  return NextResponse.redirect(new URL(connect, request.url));
}
