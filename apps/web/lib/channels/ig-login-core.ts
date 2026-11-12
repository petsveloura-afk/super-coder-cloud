/**
 * Instagram connected DIRECTLY ("Instagram API with Instagram Login", pure, unit-tested).
 *
 * The Facebook connection brings Instagram along only when the Instagram professional account is linked to the chosen
 * Facebook Page — otherwise the integrations screen said "Instagram: not connected" with no way forward. This is the
 * second, independent way: the business signs in with Instagram itself (no Facebook Page needed) and the account is
 * stored exactly like the Page-linked one (kind "instagram", config.ig_id, secret page_token), so the inbox, the AI agent,
 * comments, private replies and publishing all work through the same code. Only the Graph host differs: Instagram-login
 * tokens ("IG…") are served by graph.instagram.com, Facebook tokens ("EAA…") by graph.facebook.com.
 */

/** what the business is asked to allow (Instagram's own permission names for business login) */
export const IG_LOGIN_SCOPES = ["instagram_business_basic", "instagram_business_manage_messages", "instagram_business_manage_comments", "instagram_business_content_publish"] as const;

/** webhook fields the app subscribes this account to */
export const IG_WEBHOOK_FIELDS = ["messages", "messaging_postbacks", "messaging_seen", "message_reactions", "comments"] as const;

/** an access token issued by Instagram Login (served by graph.instagram.com) */
export function isIgLoginToken(token: string | null | undefined): boolean {
  return /^IG[A-Za-z0-9]/.test(String(token ?? "").trim());
}

/** the Graph base for a token: Instagram-login tokens → graph.instagram.com, everything else → graph.facebook.com */
export function graphBaseFor(token: string | null | undefined, version: string, env: { META_GRAPH_BASE?: string; META_IG_GRAPH_BASE?: string } = {}): string {
  if (isIgLoginToken(token)) return (env.META_IG_GRAPH_BASE || `https://graph.instagram.com/${version}`).replace(/\/$/, "");
  return (env.META_GRAPH_BASE || `https://graph.facebook.com/${version}`).replace(/\/$/, "");
}

/** Instagram's sign-in page for the business (state protects the round trip) */
export function igAuthorizeUrl(input: { appId: string; redirectUri: string; state: string }): string {
  const qs = new URLSearchParams({
    client_id: input.appId,
    redirect_uri: input.redirectUri,
    response_type: "code",
    scope: IG_LOGIN_SCOPES.join(","),
    state: input.state,
    // the business always sees the account picker (lets them choose another Instagram account)
    force_reauth: "true",
  });
  return `https://www.instagram.com/oauth/authorize?${qs.toString()}`;
}

/** Instagram appends "#_" to the code in some browsers */
export function cleanIgCode(code: string | null | undefined): string {
  return String(code ?? "").trim().replace(/#_$/, "");
}

/** long-lived tokens live 60 days and can be refreshed after 24 hours: refresh when fewer than `days` days are left */
export function igTokenNeedsRefresh(expiresAtIso: string | null | undefined, now: number, days = 15): boolean {
  const at = Date.parse(String(expiresAtIso ?? ""));
  if (!Number.isFinite(at)) return true;
  return at - now < days * 86_400_000;
}

/** expiry from Instagram's "expires_in" (seconds) — 60 days when missing */
export function igExpiry(expiresIn: unknown, now: number): string {
  const s = Number(expiresIn);
  return new Date(now + (Number.isFinite(s) && s > 0 ? s : 60 * 86_400) * 1000).toISOString();
}

export interface IgProfile {
  /** the Instagram professional account id — the id webhooks use as entry.id */
  igId: string;
  /** the app-scoped id of the same account */
  appScopedId: string | null;
  username: string | null;
  name: string | null;
  accountType: string | null;
}

/** GET /me?fields=user_id,id,username,name,account_type → the ids we store */
export function parseIgProfile(json: unknown): IgProfile | null {
  const d = (json ?? {}) as { user_id?: string | number; id?: string | number; username?: string; name?: string; account_type?: string };
  const igId = String(d.user_id ?? d.id ?? "");
  if (!/^\d{3,40}$/.test(igId)) return null;
  const appScoped = d.id != null && String(d.id) !== igId && /^\d{3,40}$/.test(String(d.id)) ? String(d.id) : null;
  return { igId, appScopedId: appScoped, username: d.username ? String(d.username).slice(0, 80) : null, name: d.name ? String(d.name).slice(0, 160) : null, accountType: d.account_type ? String(d.account_type).slice(0, 40) : null };
}

/** a personal Instagram account cannot receive messages through the API: only Business / Creator ("MEDIA_CREATOR") accounts */
export function igAccountUsable(accountType: string | null): boolean {
  if (!accountType) return true; // unknown: let Instagram decide
  return /^(BUSINESS|MEDIA_CREATOR|CREATOR)$/i.test(accountType);
}

/**
 * Why a Facebook Page came back without Instagram (shown to the business with the exact fix):
 *   "permission" — the Instagram permissions were not granted in the Facebook pop-up
 *   "not_linked" — the Page has no Instagram professional account linked to it
 */
export function igIssueFromPermissions(granted: string[] | null): "permission" | "not_linked" {
  if (granted && !granted.some((p) => p === "instagram_basic" || p === "instagram_manage_messages")) return "permission";
  return "not_linked";
}

/** GET /me/permissions → the permissions that were granted */
export function grantedPermissions(json: unknown): string[] | null {
  const list = (json as { data?: { permission?: string; status?: string }[] } | null)?.data;
  if (!Array.isArray(list)) return null;
  return list.filter((p) => p.status === "granted" && p.permission).map((p) => String(p.permission));
}

/**
 * The exact redirect address Instagram must know (Business login settings → OAuth redirect URIs). Instagram refuses the
 * sign-in with "Invalid redirect_uri" unless it matches character for character, so: META_IG_REDIRECT_URI when set,
 * otherwise the app's public address (NEXT_PUBLIC_APP_URL) — and when that is missing or local, the address the request
 * came to. The same value is used for the sign-in and for the code exchange.
 */
export function igRedirectUri(env: { META_IG_REDIRECT_URI?: string; NEXT_PUBLIC_APP_URL?: string }, requestOrigin?: string | null): string {
  const explicit = String(env.META_IG_REDIRECT_URI ?? "").trim();
  if (/^https:\/\/[^\s]+$/i.test(explicit)) return explicit;
  const base = (raw: string | null | undefined): string | null => {
    try {
      const u = new URL(String(raw ?? "").trim());
      if (!/^https?:$/.test(u.protocol)) return null;
      return u.origin;
    } catch {
      return null;
    }
  };
  const app = base(env.NEXT_PUBLIC_APP_URL);
  const local = (o: string | null) => !o || /\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0)(:|$)/.test(o);
  const origin = !local(app) ? app : (base(requestOrigin) ?? app ?? "");
  return `${origin}/api/channels/instagram/oauth`;
}
