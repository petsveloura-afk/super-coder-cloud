import "server-only";
import { graphVersion } from "./meta";
import { IG_WEBHOOK_FIELDS, igExpiry, parseIgProfile, type IgProfile } from "./ig-login-core";

/**
 * Instagram connected directly (Instagram API with Instagram Login) — the network side.
 *
 * One-time platform setup (owner), in the SAME Meta app:
 *   Instagram → "API setup with Instagram business login":
 *     • copy the Instagram app ID / secret → META_IG_APP_ID, META_IG_APP_SECRET
 *     • Business login settings → OAuth redirect URIs → https://<app>/api/channels/instagram/oauth
 *     • Webhooks → callback https://<app>/api/channels/meta/pages, verify token META_WEBHOOK_VERIFY_TOKEN,
 *       fields: messages, messaging_postbacks, comments
 *   permissions: instagram_business_basic, instagram_business_manage_messages, instagram_business_manage_comments,
 *     instagram_business_content_publish (Advanced access for customers who are not testers)
 */
export function igLoginConfigured(): boolean {
  return /^\d{5,30}$/.test(process.env.META_IG_APP_ID ?? "") && /^[a-f0-9]{32}$/i.test(process.env.META_IG_APP_SECRET ?? "");
}

const igGraph = () => (process.env.META_IG_GRAPH_BASE || `https://graph.instagram.com/${graphVersion()}`).replace(/\/$/, "");
const igApi = () => (process.env.META_IG_API_BASE || "https://api.instagram.com").replace(/\/$/, "");

async function call(url: string, init: { method?: "GET" | "POST" | "DELETE"; form?: Record<string, string>; token?: string } = {}) {
  try {
    const res = await fetch(url, {
      method: init.method ?? "GET",
      headers: { ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}), ...(init.form ? { "Content-Type": "application/x-www-form-urlencoded" } : {}) },
      body: init.form ? new URLSearchParams(init.form).toString() : undefined,
      signal: AbortSignal.timeout(15_000),
      cache: "no-store",
    });
    const j = (await res.json().catch(() => ({}))) as Record<string, unknown> & { error?: { message?: string; code?: number } | string; error_message?: string };
    const err = typeof j.error === "string" ? (j.error_message ?? j.error) : (j.error?.message ?? j.error_message);
    return { ok: res.ok && !j.error, status: res.status, data: j, error: err ?? (res.ok ? undefined : `HTTP ${res.status}`) };
  } catch (e) {
    return { ok: false, status: 0, data: {} as Record<string, unknown>, error: (e as Error).message };
  }
}

export interface IgConnection {
  token: string;
  expiresAt: string;
  profile: IgProfile;
}

/** sign-in code → a long-lived (60-day) token → the account's ids and username */
export async function igConnectFromCode(code: string, redirectUri: string): Promise<{ ok: true; conn: IgConnection } | { ok: false; error: string }> {
  if (!igLoginConfigured()) return { ok: false, error: "not_configured" };
  const short = await call(`${igApi()}/oauth/access_token`, { method: "POST", form: { client_id: process.env.META_IG_APP_ID!, client_secret: process.env.META_IG_APP_SECRET!, grant_type: "authorization_code", redirect_uri: redirectUri, code } });
  const shortData = ((short.data.data as unknown[] | undefined)?.[0] ?? short.data) as { access_token?: string };
  if (!short.ok || !shortData.access_token) return { ok: false, error: short.error ?? "token_failed" };
  let token = shortData.access_token;
  let expiresAt = igExpiry(3600, Date.now());
  const long = await call(`${igGraph().replace(/\/v\d+\.\d+$/, "")}/access_token?${new URLSearchParams({ grant_type: "ig_exchange_token", client_secret: process.env.META_IG_APP_SECRET!, access_token: token }).toString()}`);
  if (long.ok && typeof long.data.access_token === "string") {
    token = long.data.access_token;
    expiresAt = igExpiry(long.data.expires_in, Date.now());
  }
  const me = await call(`${igGraph()}/me?fields=user_id,id,username,name,account_type`, { token });
  const profile = me.ok ? parseIgProfile(me.data) : null;
  if (!profile) return { ok: false, error: me.error ?? "profile_failed" };
  return { ok: true, conn: { token, expiresAt, profile } };
}

/** the app receives this account's messages and comments */
export async function igSubscribe(token: string): Promise<{ ok: boolean; error?: string }> {
  const r = await call(`${igGraph()}/me/subscribed_apps?subscribed_fields=${IG_WEBHOOK_FIELDS.join(",")}`, { method: "POST", token });
  if (r.ok) return { ok: true };
  // older accounts reject some optional fields — the two that matter are enough
  const basic = await call(`${igGraph()}/me/subscribed_apps?subscribed_fields=messages,comments`, { method: "POST", token });
  return { ok: basic.ok, error: basic.ok ? undefined : (basic.error ?? r.error) };
}

export async function igUnsubscribe(token: string): Promise<void> {
  await call(`${igGraph()}/me/subscribed_apps`, { method: "DELETE", token }).catch(() => undefined);
}

/** a new 60-day token from a still-valid one (allowed after the token is 24 hours old) */
export async function igRefreshToken(token: string): Promise<{ ok: boolean; token?: string; expiresAt?: string; error?: string }> {
  const r = await call(`${igGraph().replace(/\/v\d+\.\d+$/, "")}/refresh_access_token?${new URLSearchParams({ grant_type: "ig_refresh_token", access_token: token }).toString()}`);
  if (!r.ok || typeof r.data.access_token !== "string") return { ok: false, error: r.error ?? "refresh_failed" };
  return { ok: true, token: r.data.access_token, expiresAt: igExpiry(r.data.expires_in, Date.now()) };
}
