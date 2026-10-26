import "server-only";
import { publicEnv } from "@/lib/env";

/**
 * Wave 19 — "Connect Google" in ONE consent screen: Calendar (my meetings + busy times),
 * Gmail (the e-mail channel), and Google Business Profile (reviews + AI replies).
 * Google shows every permission with a checkbox — whatever the business unticks is skipped.
 * Uses the same GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET; add the redirect URI
 *   https://<app>/api/google/callback
 * Business Profile APIs must be enabled for the Google Cloud project (Google approves access).
 */
export const GOOGLE_SCOPES = {
  base: ["openid", "email", "profile"],
  calendar: ["https://www.googleapis.com/auth/calendar.events", "https://www.googleapis.com/auth/calendar.freebusy"],
  gmail: ["https://mail.google.com/"],
  business: ["https://www.googleapis.com/auth/business.manage"],
} as const;

export type GoogleArea = "calendar" | "gmail" | "business";

export function googleConfigured(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

export const googleRedirectUri = () => `${publicEnv.appUrl.replace(/\/$/, "")}/api/google/callback`;

export function googleAuthorizeUrl(state: string, areas: GoogleArea[] = ["calendar", "gmail", "business"]): string {
  const scopes = [...GOOGLE_SCOPES.base, ...areas.flatMap((a) => GOOGLE_SCOPES[a])];
  const u = new URL(process.env.GOOGLE_OAUTH_AUTHORIZE_URL || "https://accounts.google.com/o/oauth2/v2/auth");
  u.search = new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID ?? "", redirect_uri: googleRedirectUri(), response_type: "code", scope: scopes.join(" "), access_type: "offline", prompt: "consent", include_granted_scopes: "true", state }).toString();
  return u.toString();
}

/** Which areas the business actually granted (from the token response's "scope"). */
export function grantedAreas(scope: string): GoogleArea[] {
  const s = new Set(scope.split(/\s+/));
  const out: GoogleArea[] = [];
  // wave 25: either calendar permission is enough (Google lets people untick one of the two)
  if (GOOGLE_SCOPES.calendar.some((x) => s.has(x)) || s.has("https://www.googleapis.com/auth/calendar")) out.push("calendar");
  if (s.has("https://mail.google.com/")) out.push("gmail");
  if (s.has("https://www.googleapis.com/auth/business.manage")) out.push("business");
  return out;
}

export async function googleExchange(code: string): Promise<{ ok: boolean; refreshToken?: string; accessToken?: string; scope?: string; email?: string | null; error?: string }> {
  try {
    const res = await fetch(process.env.GOOGLE_OAUTH_TOKEN_URL || "https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: googleRedirectUri(), client_id: process.env.GOOGLE_CLIENT_ID ?? "", client_secret: process.env.GOOGLE_CLIENT_SECRET ?? "" }),
      signal: AbortSignal.timeout(15_000),
      cache: "no-store",
    });
    const j = (await res.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; scope?: string; id_token?: string; error?: string; error_description?: string };
    if (!res.ok || !j.refresh_token) return { ok: false, error: `${j.error ?? "token"}${j.error_description ? `: ${j.error_description}` : ""}`.slice(0, 300) };
    let email: string | null = null;
    try {
      email = ((JSON.parse(Buffer.from((j.id_token ?? "").split(".")[1] ?? "", "base64url").toString("utf8")) as { email?: string }).email ?? "").toLowerCase() || null;
    } catch {
      email = null;
    }
    return { ok: true, refreshToken: j.refresh_token, accessToken: j.access_token, scope: j.scope ?? "", email };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function googleAccessToken(refreshToken: string): Promise<string | null> {
  try {
    const res = await fetch(process.env.GOOGLE_OAUTH_TOKEN_URL || "https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken, client_id: process.env.GOOGLE_CLIENT_ID ?? "", client_secret: process.env.GOOGLE_CLIENT_SECRET ?? "" }),
      signal: AbortSignal.timeout(15_000),
      cache: "no-store",
    });
    const j = (await res.json().catch(() => ({}))) as { access_token?: string };
    return res.ok && j.access_token ? j.access_token : null;
  } catch {
    return null;
  }
}
