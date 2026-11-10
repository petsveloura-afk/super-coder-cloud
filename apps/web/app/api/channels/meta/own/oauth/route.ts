import { NextResponse, type NextRequest } from "next/server";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { getOrgContext } from "@/lib/auth";
import { isLocale } from "@/lib/i18n/config";
import { publicEnv, publicBase } from "@/lib/env";
import { graphVersion } from "@/lib/channels/meta";
import { explainOwnAppError, ownOAuthUrl, ownRedirectUri } from "@/lib/channels/meta-own-core";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Facebook + Instagram through the business's OWN Meta app (full page, no popup):
 *   GET /api/channels/meta/own/oauth?locale=he        → Facebook's login dialog of the business's app
 *   GET /api/channels/meta/own/oauth?code=…&state=…    → back here; the Page (+ Instagram) is connected
 * The business adds this exact URL once in its app: Facebook Login → Settings → Valid OAuth Redirect URIs.
 * Several Pages → the same sealed 10-minute choice as the one-click connection (chooseMetaPageAction).
 */
export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const cookie = request.cookies.get("scc_meta_own")?.value ?? "";
  const [state = "", cl = "", orgId = ""] = cookie.split(".");
  const l = sp.get("locale") ?? cl;
  const locale = isLocale(l) ? l : "he";
  const back = new URL(`/${locale}/integrations`, publicBase(request));
  back.hash = "meta-alt";
  const redirectUri = ownRedirectUri(publicEnv.appUrl);
  const finish = (status: string, detail?: string, extra?: (res: NextResponse) => void) => {
    back.searchParams.set("metaown", status);
    if (detail) back.searchParams.set("detail", detail.slice(0, 600));
    const res = NextResponse.redirect(back);
    res.cookies.set("scc_meta_own", "", { path: "/api/channels/meta/own", maxAge: 0 });
    extra?.(res);
    return res;
  };

  const ctx = await getOrgContext(locale);
  if (!ctx.can("integrations.manage")) return finish("forbidden");
  const { loadOwnApp, pagesFromOwnCode } = await import("@/lib/channels/meta-own");
  const app = await loadOwnApp(ctx.org.id);
  if (!app?.secret) return finish("no_app");

  // step 2 — Facebook came back
  if (sp.get("code") || sp.get("error") || sp.get("error_reason")) {
    if (sp.get("error") || sp.get("error_reason")) return finish("cancelled", sp.get("error_description") ?? undefined);
    const given = sp.get("state") ?? "";
    if (!state || given.length !== state.length || !timingSafeEqual(Buffer.from(given), Buffer.from(state))) return finish("failed", "state");
    if (ctx.org.id !== orgId) return finish("forbidden");
    const { encryptionReady, sealSecrets } = await import("@/lib/channels/secrets");
    if (!encryptionReady()) return finish("failed", "integrations.channels.encryptionMissing");
    const r = await pagesFromOwnCode(sp.get("code") ?? "", app.appId, app.secret, redirectUri);
    const { createAdminClient } = await import("@/lib/supabase/admin");
    if (!r.ok) {
      await createAdminClient().from("meta_own_apps").update({ status: "error", last_error: `${r.code ?? ""} ${r.error ?? ""}`.trim().slice(0, 900), updated_at: new Date().toISOString() }).eq("organization_id", ctx.org.id);
      return finish("failed", `${explainOwnAppError(r.error, r.code)}|${r.error ?? ""}`);
    }
    if (!r.pages.length) return finish("failed", "integrations.meta.noPages");
    const { saveOwnPage } = await import("@/lib/channels/meta-own-save");
    if (r.pages.length === 1) {
      const s = await saveOwnPage(ctx.org.id, ctx.userId, r.pages[0]!, app.appId);
      return s.ok ? finish("connected", r.pages[0]!.name) : finish("failed", s.error);
    }
    // several Pages: the business picks one — sealed for 10 minutes, the same chooser as the one-click connection
    const pages = r.pages.slice(0, 8);
    const sealed = sealSecrets({ pages: JSON.stringify(pages), at: String(Date.now()), org: ctx.org.id, own_app: app.appId });
    const choose = pages.map((p) => ({ id: p.id, name: p.name, instagram: p.instagram?.username ?? (p.instagram ? "Instagram" : null) }));
    return finish("choose", undefined, (res) => {
      res.cookies.set("scc_meta_choose", JSON.stringify({ pages: choose, sealed }), { httpOnly: false, secure: true, sameSite: "lax", path: `/${locale}/integrations`, maxAge: 600 });
    });
  }

  // step 1 — start
  const newState = randomBytes(24).toString("hex");
  const res = NextResponse.redirect(ownOAuthUrl({ appId: app.appId, redirectUri, state: newState, version: graphVersion(), configId: app.configId }));
  res.cookies.set("scc_meta_own", `${newState}.${locale}.${ctx.org.id}`, { httpOnly: true, secure: true, sameSite: "lax", path: "/api/channels/meta/own", maxAge: 900 });
  return res;
}
