import { NextResponse, type NextRequest } from "next/server";
import { isLocale } from "@/lib/i18n/config";
import { paypalConfigured } from "@/lib/billing/paypal";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET /api/billing/paypal/domain-return?token=<order id>&locale=he&site=<id> — the customer paid
 * for a domain on PayPal's card page. Captured server to server (the URL is never trusted),
 * then the domain is registered and attached to the site. The webhook does the same.
 */
export async function GET(request: NextRequest) {
  const l = request.nextUrl.searchParams.get("locale");
  const locale = isLocale(l) ? l : "he";
  const site = request.nextUrl.searchParams.get("site") ?? "";
  const back = new URL(/^[0-9a-f-]{36}$/.test(site) ? `/${locale}/websites/${site}` : `/${locale}/websites`, request.url);
  const id = request.nextUrl.searchParams.get("token") ?? "";
  if (!paypalConfigured() || !/^[A-Z0-9]{8,40}$/.test(id)) {
    back.searchParams.set("domain", "error");
    return NextResponse.redirect(back);
  }
  try {
    const { processDomainPayment } = await import("@/lib/site/domains");
    const r = await processDomainPayment(id);
    back.searchParams.set("domain", !r.handled ? "error" : r.status === "active" ? "bought" : r.status === "failed" ? "failed" : "processing");
  } catch (e) {
    console.error("domain payment failed", (e as Error).message);
    back.searchParams.set("domain", "error");
  }
  return NextResponse.redirect(back);
}
