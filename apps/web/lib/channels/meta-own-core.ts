/**
 * Facebook / Instagram without waiting for the platform's Meta verification — pure helpers (no I/O, unit-tested).
 *
 * Two ways a business connects while the platform app is still in review:
 *   1. "my own Meta app" — the business creates a free Meta app (2 minutes), pastes its App ID + App Secret here and
 *      clicks connect. The owner of an app has full access to their own Pages / Instagram even in Development mode,
 *      so posting, comments and (through the 1-minute sync) messages work at once. Webhooks are set automatically.
 *   2. "add me as a tester" — the platform invites the person to the platform app (Meta's app-roles API); after they
 *      accept the invitation the normal one-click connection works for them.
 */

/** what the business's own app asks for — the same abilities the platform app uses */
export const OWN_APP_SCOPES = [
  "pages_show_list",
  "pages_messaging",
  "pages_manage_metadata",
  "pages_read_engagement",
  "pages_manage_engagement",
  "pages_manage_posts",
  "pages_read_user_content",
  "business_management",
  "instagram_basic",
  "instagram_manage_messages",
  "instagram_manage_comments",
  "instagram_content_publish",
] as const;

export const PAGE_WEBHOOK_FIELDS = "messages,messaging_postbacks,message_echoes,messaging_referrals,feed";
export const IG_WEBHOOK_FIELDS = "messages,comments";

export function validAppId(v: string | null | undefined): boolean {
  return /^\d{5,30}$/.test((v ?? "").trim());
}

export function validAppSecret(v: string | null | undefined): boolean {
  return /^[a-f0-9]{32}$/i.test((v ?? "").trim());
}

/** a pasted App ID often comes with spaces, "App ID:" or the whole dashboard URL — keep the number */
export function cleanAppId(v: string | null | undefined): string {
  const s = (v ?? "").trim();
  const fromUrl = s.match(/apps\/(\d{5,30})/);
  if (fromUrl) return fromUrl[1]!;
  const digits = s.match(/\d{5,30}/);
  return digits ? digits[0] : s.replace(/\s+/g, "");
}

export function cleanAppSecret(v: string | null | undefined): string {
  return (v ?? "").trim().replace(/\s+/g, "").toLowerCase();
}

/** the Facebook login dialog of the business's own app (classic scopes, or its Login for Business configuration) */
export function ownOAuthUrl(input: { appId: string; redirectUri: string; state: string; version: string; configId?: string | null }): string {
  const u = new URL(`https://www.facebook.com/${input.version}/dialog/oauth`);
  const q: Record<string, string> = { client_id: input.appId, redirect_uri: input.redirectUri, state: input.state, response_type: "code" };
  if (input.configId && validAppId(input.configId)) {
    q.config_id = input.configId;
    q.override_default_response_type = "true";
  } else {
    q.scope = OWN_APP_SCOPES.join(",");
    q.auth_type = "rerequest";
  }
  u.search = new URLSearchParams(q).toString();
  return u.toString();
}

/**
 * A Facebook profile reference from whatever the person pastes: a profile link (facebook.com/name,
 * facebook.com/profile.php?id=123, m.facebook.com/…, fb.com/…), a numeric id or a username.
 * Returns null when it cannot be a profile.
 */
export function parseFacebookProfile(input: string | null | undefined): { id: string | null; username: string | null; ref: string } | null {
  const raw = (input ?? "").trim();
  if (!raw || raw.length > 300) return null;
  if (/^\d{5,25}$/.test(raw)) return { id: raw, username: null, ref: raw };
  let url: URL | null = null;
  try {
    url = new URL(/^https?:\/\//i.test(raw) ? raw : /^(www\.|m\.|web\.)?(facebook|fb)\.com\//i.test(raw) ? `https://${raw}` : "");
  } catch {
    url = null;
  }
  if (url) {
    if (!/(^|\.)(facebook|fb)\.com$/i.test(url.hostname)) return null;
    const id = url.searchParams.get("id");
    if (id && /^\d{5,25}$/.test(id)) return { id, username: null, ref: id };
    const seg = url.pathname.split("/").filter(Boolean);
    if (seg[0] === "people" && seg[2] && /^\d{5,25}$/.test(seg[2])) return { id: seg[2], username: null, ref: seg[2] };
    const name = seg[0] ?? "";
    if (!name || ["profile.php", "groups", "pages", "watch", "events", "share", "story.php", "permalink.php", "login", "home.php"].includes(name.toLowerCase())) return null;
    return /^[A-Za-z0-9.]{3,80}$/.test(name) ? { id: null, username: name, ref: name } : null;
  }
  const at = raw.replace(/^@/, "");
  return /^[A-Za-z0-9.]{3,80}$/.test(at) ? { id: null, username: at, ref: at } : null;
}

/** Meta's answers in plain words: an i18n key the screen shows (the raw text stays under "technical details") */
export function explainOwnAppError(message: string | null | undefined, code?: number | null): string {
  const m = `${message ?? ""} ${code ?? ""}`.toLowerCase();
  if (!m.trim()) return "metaAlt.err.unknown";
  if (/app not active|not active|isn't available|app is not set up|currently inactive/.test(m)) return "metaAlt.err.notActive";
  if (/redirect_uri|redirect uri|url blocked|not whitelisted|valid oauth redirect/.test(m)) return "metaAlt.err.redirect";
  if (/invalid client_secret|client secret|error validating client secret|invalid app secret|appsecret/.test(m)) return "metaAlt.err.secret";
  if (/invalid (app|client) id|unknown application|cannot get application|application does not exist|invalid oauth access token signature|\(#803\)/.test(m)) return "metaAlt.err.appId";
  if (/invalid scope|invalid scopes|not a valid permission/.test(m)) return "metaAlt.err.scopes";
  if (/domain|app domains/.test(m)) return "metaAlt.err.domain";
  if (/already|is already a/.test(m)) return "metaAlt.err.already";
  if (/invalid user|user id|cannot be found|does not exist|unsupported post request|\(#100\)/.test(m)) return "metaAlt.err.userNotFound";
  if (/permission|not authorized|\(#10\)|\(#200\)|requires/.test(m)) return "metaAlt.err.permission";
  if (/rate|limit|too many|\(#4\)|\(#17\)|\(#32\)/.test(m)) return "metaAlt.err.rate";
  if (/timeout|network|fetch failed|econn/.test(m)) return "metaAlt.err.network";
  return "metaAlt.err.unknown";
}

/** true when a failed platform connection is the "app still in review / not live" situation — the screen then offers the alternatives */
export function needsAlternative(detail: string | null | undefined): boolean {
  const d = (detail ?? "").toLowerCase();
  return /app not active|not active|isn't available|in development|development mode|app_not_live|not_configured|tester|app review|advanced access|feature unavailable/.test(d);
}

export type OwnAppStep = "create" | "keys" | "redirect" | "connect";

/** the guide on screen — each step's text key and the value to copy, when there is one */
export function ownAppSteps(appUrl: string): { key: OwnAppStep; copy?: string; link?: string }[] {
  const base = appUrl.replace(/\/$/, "");
  return [
    { key: "create", link: "https://developers.facebook.com/apps/create/" },
    { key: "keys", link: "https://developers.facebook.com/apps/" },
    { key: "redirect", copy: `${base}/api/channels/meta/own/oauth` },
    { key: "connect" },
  ];
}

export function ownRedirectUri(appUrl: string): string {
  return `${appUrl.replace(/\/$/, "")}/api/channels/meta/own/oauth`;
}

export function webhookCallbackUrl(appUrl: string): string {
  return `${appUrl.replace(/\/$/, "")}/api/channels/meta/pages`;
}

/** the entry ids of a webhook body (Page id / Instagram id), read only to find whose app signed it */
export function webhookEntryIds(raw: string): string[] {
  try {
    const j = JSON.parse(raw || "{}") as { entry?: { id?: unknown }[] };
    const ids = (j.entry ?? []).map((e) => String(e?.id ?? "")).filter((id) => /^\d{3,40}$/.test(id));
    return [...new Set(ids)].slice(0, 10);
  } catch {
    return [];
  }
}
