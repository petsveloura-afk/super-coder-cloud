import { NextResponse, type NextRequest } from "next/server";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { getOrgContext } from "@/lib/auth";
import { isLocale } from "@/lib/i18n/config";
import { publicEnv, publicBase } from "@/lib/env";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Instagram connected DIRECTLY (Instagram Login) — a full-page round trip, no pop-up and no Facebook Page needed.
 *   GET /api/channels/instagram/oauth?locale=he      → Instagram's sign-in page (the business picks its account)
 *   GET /api/channels/instagram/oauth?code=…&state=… → Instagram comes back here; the account is connected
 * One-time Meta setting: Instagram → API setup with Instagram business login → Business login settings →
 *   OAuth redirect URIs → https://<app>/api/channels/instagram/oauth
 */
const redirectUri = () => `${publicEnv.appUrl.replace(/\/$/, "")}/api/channels/instagram/oauth`;
const COOKIE = "scc_ig_oauth";
const COOKIE_PATH = "/api/channels/instagram";

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const cookie = request.cookies.get(COOKIE)?.value ?? "";
  const [state = "", cl = "", orgId = ""] = cookie.split(".");
  const l = sp.get("locale") ?? cl;
  const locale = isLocale(l) ? l : "he";
  const back = new URL(`/${locale}/integrations`, publicBase(request));
  back.hash = "instagram";
  const finish = (status: string, detail?: string) => {
    back.searchParams.set("ig", status);
    if (detail) back.searchParams.set("detail", detail.slice(0, 400));
    const res = NextResponse.redirect(back);
    res.cookies.set(COOKIE, "", { path: COOKIE_PATH, maxAge: 0 });
    return res;
  };

  const { igLoginConfigured } = await import("@/lib/channels/ig-login");
  if (!igLoginConfigured()) return finish("not_configured");

  // step 2 — Instagram came back
  if (sp.get("code") || sp.get("error") || sp.get("error_reason")) {
    if (sp.get("error") || sp.get("error_reason")) return finish("cancelled");
    const given = sp.get("state") ?? "";
    if (!state || given.length !== state.length || !timingSafeEqual(Buffer.from(given), Buffer.from(state))) return finish("failed", "state");
    const ctx = await getOrgContext(locale);
    if (!ctx.can("integrations.manage") || ctx.org.id !== orgId) return finish("forbidden");
    const { cleanIgCode } = await import("@/lib/channels/ig-login-core");
    const { saveInstagramDirect } = await import("@/app/[locale]/(dashboard)/integrations/instagram-actions");
    const r = await saveInstagramDirect({ locale, code: cleanIgCode(sp.get("code")), redirectUri: redirectUri() });
    if (r.error) return finish(r.error === "integrations.ig.personal" ? "personal" : "failed", r.messageParams?.detail ? String(r.messageParams.detail) : r.error);
    back.searchParams.set("username", String(r.data?.username ?? ""));
    return finish("connected");
  }

  // step 1 — start
  const ctx = await getOrgContext(locale);
  if (!ctx.can("integrations.manage")) return finish("forbidden");
  const newState = randomBytes(24).toString("hex");
  const { igAuthorizeUrl } = await import("@/lib/channels/ig-login-core");
  const res = NextResponse.redirect(igAuthorizeUrl({ appId: process.env.META_IG_APP_ID!, redirectUri: redirectUri(), state: newState }));
  res.cookies.set(COOKIE, `${newState}.${locale}.${ctx.org.id}`, { httpOnly: true, secure: true, sameSite: "lax", path: COOKIE_PATH, maxAge: 900 });
  return res;
}
