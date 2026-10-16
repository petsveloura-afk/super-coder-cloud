import { NextResponse, type NextRequest } from "next/server";
import { randomBytes } from "node:crypto";
import { getOrgContext } from "@/lib/auth";
import { isLocale } from "@/lib/i18n/config";
import { authorizeUrl, mailOAuthConfigured, type MailOAuthProvider } from "@/lib/channels/oauth-mail";

export const dynamic = "force-dynamic";

/** GET /api/oauth/{google|microsoft}/start?locale=he — "Sign in with Google / Microsoft" for the e-mail channel. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  const l = request.nextUrl.searchParams.get("locale");
  const locale = isLocale(l) ? l : "he";
  if (provider !== "google" && provider !== "microsoft") return NextResponse.json({ error: "not_found" }, { status: 404 });
  const p = provider as MailOAuthProvider;
  const back = new URL(`/${locale}/integrations`, request.url);
  if (!mailOAuthConfigured(p)) {
    back.searchParams.set("mail", "not_configured");
    return NextResponse.redirect(back);
  }
  const ctx = await getOrgContext(locale);
  if (!ctx.can("integrations.manage")) {
    back.searchParams.set("mail", "forbidden");
    return NextResponse.redirect(back);
  }
  const state = randomBytes(24).toString("hex");
  const res = NextResponse.redirect(authorizeUrl(p, state, request.nextUrl.searchParams.get("hint") ?? undefined));
  res.cookies.set("scc_oauth_mail", `${state}.${p}.${locale}.${ctx.org.id}`, { httpOnly: true, secure: true, sameSite: "lax", path: "/api/oauth", maxAge: 600 });
  return res;
}
