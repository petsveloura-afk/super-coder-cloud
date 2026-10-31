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
  const esc = (v: string) => v.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string);
  const finish = async (status: string, detail?: string, extra?: (res: NextResponse) => void) => {
    // wave 26: a failed WhatsApp full-page signup shows the whole reason on a plain page (the toast vanishes and cuts it)
    // wave 61: the page speaks the business's language, explains what to do in Meta, and offers the QR connection
    if (isWa && status !== "connected") {
      const { getT } = await import("@/lib/i18n/server");
      const { t } = await getT(locale);
      const dir = locale === "en" ? "ltr" : "rtl";
      const reason = detail && /^[a-z]+(\.[A-Za-z_]+)+$/.test(detail) ? t(detail) : detail ?? "";
      const steps = (["verify", "techProvider", "manager", "retry"] as const).map((k) => `<li style="margin:6px 0">${esc(t(`integrations.wa.stuck.${k}`))}</li>`).join("");
      const titleKey = status === "cancelled" ? "integrations.wa.page.cancelled" : status === "not_configured" ? "integrations.wa.page.notConfigured" : status === "forbidden" ? "errors.forbidden" : "integrations.wa.page.failed";
      const html = `<!doctype html><html lang="${locale}" dir="${dir}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>WhatsApp</title></head><body style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;background:#080d19;color:#f8fafc;padding:24px;max-width:760px;margin:auto;line-height:1.6"><div style="background:#0f172a;border:1px solid #1e293b;border-radius:20px;padding:22px"><div style="font-size:30px">💬</div><h2 style="margin:6px 0 4px">${esc(t(titleKey))}</h2><p style="color:#cbd5e1">${esc(t("integrations.wa.stuckBody"))}</p><ol style="padding-inline-start:20px;color:#e2e8f0">${steps}</ol><p style="color:#86efac">${esc(t("integrations.wa.stuckQr"))}</p><p style="display:flex;gap:10px;flex-wrap:wrap;margin-top:16px"><a href="/${locale}/integrations#wa-hero" style="background:#2f63e8;color:#fff;padding:10px 16px;border-radius:12px;text-decoration:none;font-weight:600">${esc(t("integrations.wa.page.qr"))}</a><a href="/${locale}/integrations" style="color:#93b4ff;padding:10px 4px">${esc(t("integrations.wa.page.back"))}</a></p>${reason ? `<details style="margin-top:14px;color:#94a3b8"><summary style="cursor:pointer">${esc(t("notify.techDetails"))}</summary><pre dir="ltr" style="white-space:pre-wrap;word-break:break-word;background:#111a2b;padding:12px;border-radius:12px">${esc(status)}: ${esc(reason)}</pre></details>` : ""}</div></body></html>`;
      const r = new NextResponse(html, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
      r.cookies.set("scc_meta_oauth", "", { path: "/api/channels/meta/pages", maxAge: 0 });
      return r;
    }
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
