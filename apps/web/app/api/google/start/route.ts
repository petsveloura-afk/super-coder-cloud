import { NextResponse, type NextRequest } from "next/server";
import { randomBytes } from "node:crypto";
import { getOrgContext } from "@/lib/auth";
import { isLocale } from "@/lib/i18n/config";
import { googleAuthorizeUrl, googleConfigured, type GoogleArea } from "@/lib/google/connect";

export const dynamic = "force-dynamic";

/** GET /api/google/start?locale=he[&areas=calendar,gmail,business] — wave 19: everything Google in one consent. */
export async function GET(request: NextRequest) {
  const l = request.nextUrl.searchParams.get("locale");
  const locale = isLocale(l) ? l : "he";
  const back = new URL(`/${locale}/integrations`, request.url);
  back.hash = "google";
  if (!googleConfigured()) {
    back.searchParams.set("google", "not_configured");
    return NextResponse.redirect(back);
  }
  const ctx = await getOrgContext(locale);
  if (!ctx.can("integrations.manage")) {
    back.searchParams.set("google", "forbidden");
    return NextResponse.redirect(back);
  }
  const wanted = (request.nextUrl.searchParams.get("areas") ?? "calendar,gmail,business").split(",").filter((a): a is GoogleArea => a === "calendar" || a === "gmail" || a === "business");
  const state = randomBytes(24).toString("hex");
  const res = NextResponse.redirect(googleAuthorizeUrl(state, wanted.length ? wanted : ["calendar", "gmail", "business"]));
  res.cookies.set("scc_google", `${state}.${locale}.${ctx.org.id}`, { httpOnly: true, secure: true, sameSite: "lax", path: "/api/google", maxAge: 900 });
  return res;
}
