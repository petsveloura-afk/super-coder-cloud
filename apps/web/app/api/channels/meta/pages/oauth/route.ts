import { NextResponse, type NextRequest } from "next/server";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { getOrgContext } from "@/lib/auth";
import { isLocale } from "@/lib/i18n/config";
import { publicEnv } from "@/lib/env";
import { metaPagesPublicConfig } from "@/lib/channels/meta-pages";
import { metaPublicConfig } from "@/lib/channels/meta";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Wave 25 — Facebook + Instagram connection as a FULL PAGE (no popup at all).
 * Used automatically when the Facebook script is blocked or the popup could not open (Safari / iPhone / in-app browsers).
 *   GET /api/channels/meta/pages/oauth?locale=he            → goes to Facebook's login dialog
 *   GET /api/channels/meta/pages/oauth?code=…&state=…        → Facebook comes back here; the Page is connected
 * One-time Meta setting: Facebook Login for Business → Settings → Valid OAuth Redirect URIs →
 *   https://<app>/api/channels/meta/pages/oauth
 */
const redirectUri = () => `${publicEnv.appUrl.replace(/\/$/, "")}/api/channels/meta/pages/oauth`;

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const cookie = request.cookies.get("scc_meta_oauth")?.value ?? "";
  const [state = "", cl = "", orgId = "", ck = ""] = cookie.split(".");
  // wave 26: ?kind=wa starts the WhatsApp Embedded Signup as a full page (same whitelisted redirect URI); the cookie remembers it
  const isWa = (sp.get("kind") ?? ck) === "wa";
  const l = sp.get("locale") ?? cl;
  const locale = isLocale(l) ? l : "he";
  const back = new URL(`/${locale}/integrations`, request.url);
  back.hash = "marketplace";
  const finish = (status: string, detail?: string, extra?: (res: NextResponse) => void) => {
    back.searchParams.set("meta", status);
    if (detail) back.searchParams.set("detail", detail.slice(0, 600));
    const res = NextResponse.redirect(back);
    res.cookies.set("scc_meta_oauth", "", { path: "/api/channels/meta/pages", maxAge: 0 });
    extra?.(res);
    return res;
  };

  const cfg = isWa ? metaPublicConfig() : metaPagesPublicConfig();
  if (!cfg) return finish("not_configured");

  // step 2 — Facebook came back
  if (sp.get("code") || sp.get("error") || sp.get("error_reason")) {
    if (sp.get("error") || sp.get("error_reason")) return finish("cancelled");
    const given = sp.get("state") ?? "";
    if (!state || given.length !== state.length || !timingSafeEqual(Buffer.from(given), Buffer.from(state))) return finish("failed", "state");
    const ctx = await getOrgContext(locale);
    if (!ctx.can("integrations.manage") || ctx.org.id !== orgId) return finish("forbidden");
    if (isWa) {
      const { connectWhatsAppEmbeddedAction } = await import("@/app/[locale]/(dashboard)/integrations/actions");
      const w = await connectWhatsAppEmbeddedAction({ locale, code: sp.get("code") ?? "", phoneNumberId: "", wabaId: "", redirectUri: redirectUri() });
      if (w.error) return finish("failed", w.messageParams?.detail ? String(w.messageParams.detail) : w.error);
      return finish("connected");
    }
    const { connectMetaPagesAction } = await import("@/app/[locale]/(dashboard)/integrations/connect-actions");
    const r = await connectMetaPagesAction({ locale, code: sp.get("code") ?? "", redirectUri: redirectUri() });
    if (r.error) return finish("failed", r.messageParams?.detail ? String(r.messageParams.detail) : r.error);
    if (r.data?.choose && r.data.sealed) {
      // several Pages: the (encrypted, 10-minute) choice travels in short cookies the integrations page reads once
      const choose = r.data.choose.slice(0, 8);
      return finish("choose", undefined, (res) => {
        res.cookies.set("scc_meta_choose", JSON.stringify({ pages: choose, sealed: r.data!.sealed }), { httpOnly: false, secure: true, sameSite: "lax", path: `/${locale}/integrations`, maxAge: 600 });
      });
    }
    return finish("connected");
  }

  // step 1 — start
  const ctx = await getOrgContext(locale);
  if (!ctx.can("integrations.manage")) return finish("forbidden");
  const newState = randomBytes(24).toString("hex");
  const u = new URL(`https://www.facebook.com/${cfg.version}/dialog/oauth`);
  const q: Record<string, string> = { client_id: cfg.appId, redirect_uri: redirectUri(), state: newState, config_id: cfg.configId, response_type: "code", override_default_response_type: "true" };
  if (isWa) q.extras = JSON.stringify({ setup: {}, sessionInfoVersion: "3" });
  u.search = new URLSearchParams(q).toString();
  const res = NextResponse.redirect(u.toString());
  res.cookies.set("scc_meta_oauth", `${newState}.${locale}.${ctx.org.id}${isWa ? ".wa" : ""}`, { httpOnly: true, secure: true, sameSite: "lax", path: "/api/channels/meta/pages", maxAge: 900 });
  return res;
}
