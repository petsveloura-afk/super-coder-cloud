import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { getOrgContext } from "@/lib/auth";
import { isLocale } from "@/lib/i18n/config";
import { encryptionReady, sealSecrets } from "@/lib/channels/secrets";
import { googleExchange, grantedAreas } from "@/lib/google/connect";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Wave 19 — one Google consent → up to three connections, each only if granted:
 *   calendar  → my calendar (meetings + busy times; same as Settings → My calendar)
 *   gmail     → the e-mail channel (inbox + AI agent; same as "Sign in with Google")
 *   business  → Google Business Profile reviews (AI reply drafts)
 */
export async function GET(request: NextRequest) {
  const cookie = request.cookies.get("scc_google")?.value ?? "";
  const [state = "", cl = "", orgId = ""] = cookie.split(".");
  const locale = isLocale(cl) ? cl : "he";
  const back = new URL(`/${locale}/integrations`, request.url);
  back.hash = "google";
  const done = (status: string, detail?: string) => {
    back.searchParams.set("google", status);
    if (detail) back.searchParams.set("detail", detail.slice(0, 160));
    const res = NextResponse.redirect(back);
    res.cookies.set("scc_google", "", { path: "/api/google", maxAge: 0 });
    return res;
  };
  const given = request.nextUrl.searchParams.get("state") ?? "";
  if (!state || given.length !== state.length || !timingSafeEqual(Buffer.from(given), Buffer.from(state))) return done("failed", "state");
  if (request.nextUrl.searchParams.get("error")) return done("cancelled");
  const code = request.nextUrl.searchParams.get("code");
  if (!code) return done("failed", "code");
  const ctx = await getOrgContext(locale);
  if (!ctx.can("integrations.manage") || ctx.org.id !== orgId) return done("forbidden");
  if (!encryptionReady()) return done("failed", "encryption_key_missing");
  const tok = await googleExchange(code);
  if (!tok.ok || !tok.refreshToken) return done("failed", tok.error ?? "token");
  const areas = grantedAreas(tok.scope ?? "");
  const results: string[] = [];
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const admin = createAdminClient();

  if (areas.includes("calendar")) {
    const { error } = await admin.from("calendar_connections").upsert(
      { organization_id: ctx.org.id, user_id: ctx.userId, provider: "google", account_email: tok.email ?? null, calendar_id: "primary", secret_enc: sealSecrets({ refresh_token: tok.refreshToken }), status: "active", last_error: null, updated_at: new Date().toISOString() },
      { onConflict: "organization_id,user_id,provider" },
    );
    results.push(error ? "calendar:failed" : "calendar");
    if (!error) {
      const { refreshCalendarBusy } = await import("@/lib/calendar/sync");
      await refreshCalendarBusy(3).catch(() => undefined);
    }
  }
  if (areas.includes("gmail") && tok.email) {
    const { presetFor } = await import("@/lib/channels/email-core");
    const { verifyMailbox } = await import("@/lib/channels/email");
    const { saveMailbox } = await import("@/lib/channels/mailbox-save");
    const servers = presetFor("gmail")!;
    const cfg = { address: tok.email, display_name: ctx.org.name, auth: "google" as const, imap_host: servers.imap_host, imap_port: servers.imap_port, smtp_host: servers.smtp_host, smtp_port: 465 };
    const check = await verifyMailbox(cfg, { refresh_token: tok.refreshToken }).catch((e: Error) => ({ ok: false, step: "imap", error: e.message, uid_validity: undefined, last_uid: undefined }));
    if (check.ok) {
      const saved = await saveMailbox({ orgId: ctx.org.id, userId: ctx.userId, config: cfg, secrets: { refresh_token: tok.refreshToken }, uidValidity: check.uid_validity, lastUid: check.last_uid });
      results.push(saved.ok ? "gmail" : "gmail:failed");
    } else results.push("gmail:failed");
  }
  if (areas.includes("business")) {
    const { googleAccessToken } = await import("@/lib/google/connect");
    const { listLocations } = await import("@/lib/google/reviews");
    const at = await googleAccessToken(tok.refreshToken);
    const locations = at ? await listLocations(at).catch(() => []) : [];
    const { saveIntegration } = await import("@/lib/integrations/store");
    await saveIntegration(ctx.org.id, "google_business", { email: tok.email ?? "", locations, connected_at: new Date().toISOString() }, { refresh_token: tok.refreshToken });
    results.push(locations.length ? "business" : "business:no_locations");
  }
  return done("connected", results.join(","));
}
