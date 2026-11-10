/**
 * Public runtime configuration. Only NEXT_PUBLIC_* values live here; server
 * secrets are read in lib/supabase/admin.ts and integration adapters only.
 */
export const publicEnv = {
  appUrl: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
  supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
  googleAuthEnabled: process.env.NEXT_PUBLIC_GOOGLE_AUTH_ENABLED === "true",
};

export function isSupabaseConfigured(): boolean {
  return Boolean(publicEnv.supabaseUrl && publicEnv.supabaseAnonKey);
}

export function missingPublicEnv(): string[] {
  const missing: string[] = [];
  if (!publicEnv.supabaseUrl) missing.push("NEXT_PUBLIC_SUPABASE_URL");
  if (!publicEnv.supabaseAnonKey) missing.push("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  if (!process.env.NEXT_PUBLIC_APP_URL) missing.push("NEXT_PUBLIC_APP_URL");
  return missing;
}

/** Only allow same-origin relative redirects ("/x"), never "//evil" or absolute URLs. */
export function safeRedirectPath(value: string | null | undefined, fallback: string): string {
  if (!value) return fallback;
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return fallback;
  return value;
}

const LOCAL_HOST = /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])$/i;

/**
 * Base URL for building redirects. Behind Railway's proxy, `request.url` can be the
 * container's internal address (http://localhost:8080), which sends users to a dead link.
 * If the request looks internal, fall back to the public NEXT_PUBLIC_APP_URL; otherwise keep
 * the request's own origin (so custom domains keep working).
 */
export function publicBase(request: { url: string }): string {
  try {
    if (!LOCAL_HOST.test(new URL(request.url).hostname)) return request.url;
  } catch {
    /* fall through */
  }
  const app = process.env.NEXT_PUBLIC_APP_URL;
  try {
    if (app && !LOCAL_HOST.test(new URL(app).hostname)) return app;
  } catch {
    /* fall through */
  }
  return request.url;
}
