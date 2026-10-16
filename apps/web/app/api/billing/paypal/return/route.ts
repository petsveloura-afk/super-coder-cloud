import { NextResponse, type NextRequest } from "next/server";
import { isLocale } from "@/lib/i18n/config";
import { paypalConfigured, syncPayPalSubscription } from "@/lib/billing/paypal";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET /api/billing/paypal/return?subscription_id=I-…&locale=he — PayPal sends the
 * customer back here after approving. The subscription is read from PayPal
 * (server to server — the URL itself is never trusted) and applied right away,
 * so the plan is active even before the webhook arrives.
 */
export async function GET(request: NextRequest) {
  const l = request.nextUrl.searchParams.get("locale");
  const locale = isLocale(l) ? l : "he";
  const back = new URL(`/${locale}/billing`, request.url);
  const id = request.nextUrl.searchParams.get("subscription_id") ?? "";
  if (!paypalConfigured() || !/^I-[A-Z0-9]{6,40}$/.test(id)) {
    back.searchParams.set("error", "provider");
    return NextResponse.redirect(back);
  }
  try {
    const r = await syncPayPalSubscription(id);
    back.searchParams.set("checkout", r.ok && r.status !== "incomplete" ? "success" : "pending");
  } catch (e) {
    console.error("paypal return sync failed", (e as Error).message);
    back.searchParams.set("checkout", "pending");
  }
  return NextResponse.redirect(back);
}
