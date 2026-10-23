import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { getOrgContext } from "@/lib/auth";
import { isLocale } from "@/lib/i18n/config";
import { exchangeCalendarCode, type CalProvider } from "@/lib/calendar/sync";
import { encryptionReady, sealSecrets } from "@/lib/channels/secrets";

export const dynamic = "force-dynamic";

/** OAuth redirect target for calendars: stores MY connection (refresh token, encrypted). */
export async function GET(request: NextRequest, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  const cookie = request.cookies.get("scc_oauth_cal")?.value ?? "";
  const [state = "", cp = "", cl = "", orgId = ""] = cookie.split(".");
  const locale = isLocale(cl) ? cl : "he";
  const back = new URL(`/${locale}/settings`, request.url);
  const done = (status: string, detail?: string) => {
    back.searchParams.set("calendar", status);
    if (detail) back.searchParams.set("detail", detail.slice(0, 160));
    back.hash = "calendar";
    const res = NextResponse.redirect(back);
    res.cookies.set("scc_oauth_cal", "", { path: "/api/calendar", maxAge: 0 });
    return res;
  };
  if ((provider !== "google" && provider !== "microsoft") || cp !== provider) return done("failed", "provider");
  const given = request.nextUrl.searchParams.get("state") ?? "";
  if (!state || given.length !== state.length || !timingSafeEqual(Buffer.from(given), Buffer.from(state))) return done("failed", "state");
  if (request.nextUrl.searchParams.get("error")) return done("cancelled");
  const code = request.nextUrl.searchParams.get("code");
  if (!code) return done("failed", "code");
  const ctx = await getOrgContext(locale);
  if (ctx.org.id !== orgId) return done("forbidden");
  if (!encryptionReady()) return done("failed", "encryption_key_missing");
  const tok = await exchangeCalendarCode(provider as CalProvider, code);
  if (!tok.ok || !tok.refreshToken) return done("failed", tok.error ?? "token");
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const { error } = await createAdminClient()
    .from("calendar_connections")
    .upsert(
      { organization_id: ctx.org.id, user_id: ctx.userId, provider, account_email: tok.email ?? null, calendar_id: "primary", secret_enc: sealSecrets({ refresh_token: tok.refreshToken }), status: "active", last_error: null, updated_at: new Date().toISOString() },
      { onConflict: "organization_id,user_id,provider" },
    );
  if (error) return done("failed", "save");
  // first busy-time sync right away
  const { refreshCalendarBusy } = await import("@/lib/calendar/sync");
  await refreshCalendarBusy(3).catch(() => undefined);
  return done("connected");
}
