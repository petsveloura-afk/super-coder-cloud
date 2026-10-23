import { NextResponse, type NextRequest } from "next/server";
import { randomBytes } from "node:crypto";
import { getOrgContext } from "@/lib/auth";
import { isLocale } from "@/lib/i18n/config";
import { calendarAuthorizeUrl, calendarConfigured, type CalProvider } from "@/lib/calendar/sync";

export const dynamic = "force-dynamic";

/** GET /api/calendar/{google|microsoft}/start?locale=he — connect MY calendar (wave 16). */
export async function GET(request: NextRequest, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  const l = request.nextUrl.searchParams.get("locale");
  const locale = isLocale(l) ? l : "he";
  if (provider !== "google" && provider !== "microsoft") return NextResponse.json({ error: "not_found" }, { status: 404 });
  const back = new URL(`/${locale}/settings#calendar`, request.url);
  if (!calendarConfigured(provider as CalProvider)) {
    back.searchParams.set("calendar", "not_configured");
    return NextResponse.redirect(back);
  }
  const ctx = await getOrgContext(locale);
  const { orgHasFeature } = await import("@/lib/billing/features");
  if (!(await orgHasFeature(ctx.org.id, "calendar_sync"))) {
    back.searchParams.set("calendar", "forbidden");
    return NextResponse.redirect(back);
  }
  const state = randomBytes(24).toString("hex");
  const res = NextResponse.redirect(calendarAuthorizeUrl(provider as CalProvider, state));
  res.cookies.set("scc_oauth_cal", `${state}.${provider}.${locale}.${ctx.org.id}`, { httpOnly: true, secure: true, sameSite: "lax", path: "/api/calendar", maxAge: 600 });
  return res;
}
