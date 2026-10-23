import { NextResponse, type NextRequest } from "next/server";
import { randomBytes } from "node:crypto";
import { getOrgContext } from "@/lib/auth";
import { isLocale } from "@/lib/i18n/config";
import { validShopDomain } from "@/lib/stores/core";
import { shopifyAuthorizeUrl, shopifyConfigured } from "@/lib/stores/shopify";

export const dynamic = "force-dynamic";

/** GET /api/stores/shopify/start?shop=my-store&locale=he — wave 19: connect a Shopify store. */
export async function GET(request: NextRequest) {
  const l = request.nextUrl.searchParams.get("locale");
  const locale = isLocale(l) ? l : "he";
  const back = new URL(`/${locale}/integrations`, request.url);
  back.hash = "stores";
  const shop = validShopDomain(request.nextUrl.searchParams.get("shop"));
  if (!shopifyConfigured()) {
    back.searchParams.set("store", "not_configured");
    return NextResponse.redirect(back);
  }
  if (!shop) {
    back.searchParams.set("store", "bad_shop");
    return NextResponse.redirect(back);
  }
  const ctx = await getOrgContext(locale);
  if (!ctx.can("integrations.manage")) {
    back.searchParams.set("store", "forbidden");
    return NextResponse.redirect(back);
  }
  const state = randomBytes(24).toString("hex");
  const res = NextResponse.redirect(shopifyAuthorizeUrl(shop, state));
  res.cookies.set("scc_shopify", `${state}.${locale}.${ctx.org.id}.${shop}`, { httpOnly: true, secure: true, sameSite: "lax", path: "/api/stores", maxAge: 900 });
  return res;
}
