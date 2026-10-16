import { NextResponse, type NextRequest } from "next/server";
import { isLocale } from "@/lib/i18n/config";
import { capturePayPalCardOrder, paypalConfigured } from "@/lib/billing/paypal";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET /api/billing/paypal/order-return?token=<order id>&locale=he — the customer paid by card
 * (or PayPal) on PayPal's page. The order is captured server to server (the URL is never
 * trusted) and the plan is active immediately; the webhook does the same if this page is skipped.
 */
export async function GET(request: NextRequest) {
  const l = request.nextUrl.searchParams.get("locale");
  const locale = isLocale(l) ? l : "he";
  const back = new URL(`/${locale}/billing`, request.url);
  const id = request.nextUrl.searchParams.get("token") ?? "";
  if (!paypalConfigured() || !/^[A-Z0-9]{8,40}$/.test(id)) {
    back.searchParams.set("error", "provider");
    return NextResponse.redirect(back);
  }
  try {
    const r = await capturePayPalCardOrder(id);
    if (r.ok && r.status === "COMPLETED") back.searchParams.set("checkout", "success");
    else if (r.ok) back.searchParams.set("checkout", "pending");
    else back.searchParams.set("error", "capture_failed");
  } catch (e) {
    console.error("paypal order capture failed", (e as Error).message);
    back.searchParams.set("error", "capture_failed");
  }
  return NextResponse.redirect(back);
}
