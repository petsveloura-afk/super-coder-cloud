import "server-only";
import { publicEnv } from "@/lib/env";

/**
 * "Sign in with Google / Microsoft" for the e-mail channel. The refresh token
 * is used for IMAP + SMTP (XOAUTH2), so the same e-mail pipeline serves every
 * provider. Env: GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET, MICROSOFT_CLIENT_ID /
 * MICROSOFT_CLIENT_SECRET. Redirect URIs to register:
 *   https://<app>/api/oauth/google/callback
 *   https://<app>/api/oauth/microsoft/callback
 */

export type MailOAuthProvider = "google" | "microsoft";

export function mailOAuthConfigured(p: MailOAuthProvider): boolean {
  return p === "google"
    ? Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET)
    : Boolean(process.env.MICROSOFT_CLIENT_ID && process.env.MICROSOFT_CLIENT_SECRET);
}

export function redirectUri(p: MailOAuthProvider) {
  return `${publicEnv.appUrl.replace(/\/$/, "")}/api/oauth/${p}/callback`;
}

const SCOPES: Record<MailOAuthProvider, string> = {
  google: "openid email profile https://mail.google.com/",
  microsoft: "openid email profile offline_access https://outlook.office.com/IMAP.AccessAsUser.All https://outlook.office.com/SMTP.Send",
};

export function authorizeUrl(p: MailOAuthProvider, state: string, loginHint?: string): string {
  if (p === "google") {
    const u = new URL(process.env.GOOGLE_OAUTH_AUTHORIZE_URL || "https://accounts.google.com/o/oauth2/v2/auth");
    u.search = new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID ?? "",
      redirect_uri: redirectUri(p),
      response_type: "code",
      scope: SCOPES.google,
      access_type: "offline",
      prompt: "consent",
      include_granted_scopes: "true",
      state,
      ...(loginHint ? { login_hint: loginHint } : {}),
    }).toString();
    return u.toString();
  }
  const u = new URL(process.env.MICROSOFT_OAUTH_AUTHORIZE_URL || "https://login.microsoftonline.com/common/oauth2/v2.0/authorize");
  u.search = new URLSearchParams({
    client_id: process.env.MICROSOFT_CLIENT_ID ?? "",
    redirect_uri: redirectUri(p),
    response_type: "code",
    response_mode: "query",
    scope: SCOPES.microsoft,
    prompt: "select_account",
    state,
    ...(loginHint ? { login_hint: loginHint } : {}),
  }).toString();
  return u.toString();
}

/** Reads the e-mail claim of an id_token we just received from the provider over TLS. */
export function emailFromIdToken(idToken: string | undefined): string | null {
  if (!idToken) return null;
  try {
    const payload = JSON.parse(Buffer.from(idToken.split(".")[1] ?? "", "base64url").toString("utf8")) as { email?: string; preferred_username?: string; upn?: string };
    const e = (payload.email || payload.preferred_username || payload.upn || "").toLowerCase();
    return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e) ? e : null;
  } catch {
    return null;
  }
}

export async function exchangeCode(p: MailOAuthProvider, code: string): Promise<{ ok: boolean; refreshToken?: string; email?: string | null; name?: string | null; error?: string }> {
  const url = p === "google" ? (process.env.GOOGLE_OAUTH_TOKEN_URL || "https://oauth2.googleapis.com/token") : (process.env.MICROSOFT_OAUTH_TOKEN_URL || "https://login.microsoftonline.com/common/oauth2/v2.0/token");
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri(p),
    client_id: (p === "google" ? process.env.GOOGLE_CLIENT_ID : process.env.MICROSOFT_CLIENT_ID) ?? "",
    client_secret: (p === "google" ? process.env.GOOGLE_CLIENT_SECRET : process.env.MICROSOFT_CLIENT_SECRET) ?? "",
  });
  if (p === "microsoft") body.set("scope", SCOPES.microsoft);
  try {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body, signal: AbortSignal.timeout(15_000) });
    const j = (await res.json().catch(() => ({}))) as { refresh_token?: string; id_token?: string; error?: string; error_description?: string };
    if (!res.ok || !j.refresh_token) return { ok: false, error: `${j.error ?? res.status}${j.error_description ? `: ${j.error_description}` : ""}`.slice(0, 300) };
    let name: string | null = null;
    try {
      const payload = JSON.parse(Buffer.from((j.id_token ?? "").split(".")[1] ?? "", "base64url").toString("utf8")) as { name?: string };
      name = payload.name ?? null;
    } catch {
      name = null;
    }
    return { ok: true, refreshToken: j.refresh_token, email: emailFromIdToken(j.id_token), name };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
