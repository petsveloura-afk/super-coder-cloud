import { NextResponse, type NextRequest } from "next/server";
import { isLocale } from "@/lib/i18n/config";
import { paypalConfigured } from "@/lib/billing/paypal";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET /api/billing/paypal/pack-return?token=<order id>&locale=he — the customer paid for an
 * AI credit pack on PayPal. Captured server to server (the URL is never trusted); the
 * webhook does the same if the customer closes the page.
 */
export async function GET(request: NextRequest) {
  const l = request.nextUrl.searchParams.get("locale");
  const locale = isLocale(l) ? l : "he";
  const back = new URL(`/${locale}/billing`, request.url);
  const id = request.nextUrl.searchParams.get("token") ?? "";
  if (!paypalConfigured() || !/^[A-Z0-9]{8,40}$/.test(id)) {
    back.searchParams.set("pack", "error");
    return NextResponse.redirect(back);
  }
  try {
    const { processPackPayPal } = await import("@/lib/billing/packs");
    const r = await processPackPayPal(id);
    back.searchParams.set("pack", r.handled && r.ok ? "ok" : r.handled ? "processing" : "error");
  } catch (e) {
    console.error("credit pack capture failed", (e as Error).message);
    back.searchParams.set("pack", "error");
  }
  return NextResponse.redirect(back);
}
