import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { graphVersion } from "./meta";
import type { MetaPage } from "./meta-pages";
import { IG_WEBHOOK_FIELDS, PAGE_WEBHOOK_FIELDS, validAppId, validAppSecret } from "./meta-own-core";

/**
 * Facebook / Instagram through the business's OWN Meta app (works at once, no platform verification needed) and
 * automatic tester invitations to the platform app. Secrets never reach the browser: the App Secret and the webhook
 * verify token are sealed (AES-GCM, ENCRYPTION_KEY); only a sha256 of the verify token is stored in clear.
 */

const graph = () => (process.env.META_GRAPH_BASE || `https://graph.facebook.com/${graphVersion()}`).replace(/\/$/, "");

type GraphRes = { ok: boolean; status: number; data: Record<string, unknown>; error?: string; code?: number };

async function g(path: string, init: { method?: "GET" | "POST" | "DELETE"; token?: string; form?: Record<string, string> } = {}): Promise<GraphRes> {
  try {
    const res = await fetch(`${graph()}${path}`, {
      method: init.method ?? "GET",
      headers: { ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}), ...(init.form ? { "Content-Type": "application/x-www-form-urlencoded" } : {}) },
      body: init.form ? new URLSearchParams(init.form).toString() : undefined,
      signal: AbortSignal.timeout(15_000),
      cache: "no-store",
    });
    const j = (await res.json().catch(() => ({}))) as Record<string, unknown> & { error?: { message?: string; code?: number } };
    return { ok: res.ok && !j.error, status: res.status, data: j, error: j.error?.message ?? (res.ok ? undefined : `HTTP ${res.status}`), code: j.error?.code };
  } catch (e) {
    return { ok: false, status: 0, data: {}, error: (e as Error).message };
  }
}

export const hashVerifyToken = (token: string) => createHash("sha256").update(token).digest("hex");
export const newVerifyToken = () => `scc_${randomBytes(18).toString("hex")}`;

/** The App ID + App Secret really belong together (Meta answers with the app's name). */
export async function checkOwnApp(appId: string, secret: string): Promise<{ ok: boolean; name?: string; error?: string; code?: number }> {
  if (!validAppId(appId) || !validAppSecret(secret)) return { ok: false, error: "invalid app id or app secret format" };
  const r = await g(`/${encodeURIComponent(appId)}?${new URLSearchParams({ fields: "name", access_token: `${appId}|${secret}` }).toString()}`);
  if (!r.ok) return { ok: false, error: r.error, code: r.code };
  return { ok: true, name: typeof r.data.name === "string" ? r.data.name.slice(0, 160) : undefined };
}

/** Sets the app's webhooks (Page + Instagram) to the platform's endpoint — no copying in Meta's dashboard. Best effort. */
export async function configureOwnWebhooks(appId: string, secret: string, callbackUrl: string, verifyToken: string): Promise<{ ok: boolean; page: boolean; instagram: boolean; error?: string }> {
  const token = `${appId}|${secret}`;
  const sub = (object: string, fields: string) =>
    g(`/${encodeURIComponent(appId)}/subscriptions`, { method: "POST", form: { object, callback_url: callbackUrl, verify_token: verifyToken, fields, include_values: "true", access_token: token } });
  const page = await sub("page", PAGE_WEBHOOK_FIELDS);
  const ig = await sub("instagram", IG_WEBHOOK_FIELDS);
  return { ok: page.ok, page: page.ok, instagram: ig.ok, error: page.ok ? (ig.ok ? undefined : ig.error) : page.error };
}

/** login code of the business's own app → long-lived user token → its Pages (+ Instagram) with their own tokens */
export async function pagesFromOwnCode(code: string, appId: string, secret: string, redirectUri: string): Promise<{ ok: boolean; error?: string; code?: number; pages: MetaPage[] }> {
  const tok = await g(`/oauth/access_token?${new URLSearchParams({ client_id: appId, client_secret: secret, code, redirect_uri: redirectUri }).toString()}`);
  let userToken = tok.data.access_token as string | undefined;
  if (!tok.ok || !userToken) return { ok: false, error: tok.error ?? "token_failed", code: tok.code, pages: [] };
  const ll = await g(`/oauth/access_token?${new URLSearchParams({ grant_type: "fb_exchange_token", client_id: appId, client_secret: secret, fb_exchange_token: userToken }).toString()}`);
  if (ll.ok && typeof ll.data.access_token === "string") userToken = ll.data.access_token;
  const pages = await g(`/me/accounts?fields=id,name,access_token,instagram_business_account%7Bid,username%7D&limit=50`, { token: userToken });
  if (!pages.ok) return { ok: false, error: pages.error, code: pages.code, pages: [] };
  const list = ((pages.data.data as { id: string; name?: string; access_token?: string; instagram_business_account?: { id?: string; username?: string } }[] | undefined) ?? [])
    .filter((p) => /^\d{3,40}$/.test(p.id) && p.access_token)
    .map((p) => ({ id: p.id, name: (p.name ?? "").slice(0, 160), token: p.access_token!, instagram: p.instagram_business_account?.id ? { id: p.instagram_business_account.id, username: p.instagram_business_account.username ?? null } : null }));
  return { ok: true, pages: list };
}

export interface OwnAppRow {
  appId: string;
  appName: string | null;
  configId: string | null;
  status: "saved" | "connected" | "error";
  webhooksOk: boolean;
  lastError: string | null;
}

export async function loadOwnApp(orgId: string): Promise<(OwnAppRow & { secret: string; verifyToken: string }) | null> {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return null;
  const { data } = await createAdminClient().from("meta_own_apps").select("app_id, app_name, config_id, status, webhooks_ok, last_error, secret_enc").eq("organization_id", orgId).maybeSingle();
  if (!data) return null;
  const { openSecrets } = await import("./secrets");
  let s: Record<string, string> = {};
  try {
    s = openSecrets(data.secret_enc as string);
  } catch {
    s = {};
  }
  return {
    appId: data.app_id as string,
    appName: (data.app_name as string | null) ?? null,
    configId: (data.config_id as string | null) ?? null,
    status: data.status as OwnAppRow["status"],
    webhooksOk: Boolean(data.webhooks_ok),
    lastError: (data.last_error as string | null) ?? null,
    secret: s.app_secret ?? "",
    verifyToken: s.verify_token ?? "",
  };
}

/** The webhook GET handshake: is this one of the businesses' own verify tokens? */
export async function ownVerifyTokenKnown(token: string): Promise<boolean> {
  if (!token || token.length < 12 || token.length > 200 || !process.env.SUPABASE_SERVICE_ROLE_KEY) return false;
  const { data } = await createAdminClient().from("meta_own_apps").select("organization_id").eq("verify_token_hash", hashVerifyToken(token)).limit(1).maybeSingle();
  return Boolean(data);
}

/** The app secrets (and app ids) that may have signed a webhook for these Page / Instagram ids. */
export async function ownAppsForEntries(entryIds: string[]): Promise<{ orgId: string; appId: string; secret: string }[]> {
  if (!entryIds.length || !process.env.SUPABASE_SERVICE_ROLE_KEY) return [];
  const admin = createAdminClient();
  const ids = entryIds.slice(0, 10);
  const list = ids.map((id) => `config->>page_id.eq.${id},config->>ig_id.eq.${id}`).join(",");
  const { data: accs } = await admin.from("channel_accounts").select("organization_id").in("kind", ["messenger", "instagram"]).or(list).limit(20);
  const orgs = [...new Set(((accs ?? []) as { organization_id: string }[]).map((a) => a.organization_id))];
  if (!orgs.length) return [];
  const { data: apps } = await admin.from("meta_own_apps").select("organization_id, app_id, secret_enc").in("organization_id", orgs);
  const { openSecrets } = await import("./secrets");
  const out: { orgId: string; appId: string; secret: string }[] = [];
  for (const a of (apps ?? []) as { organization_id: string; app_id: string; secret_enc: string }[]) {
    try {
      const s = openSecrets(a.secret_enc);
      if (s.app_secret) out.push({ orgId: a.organization_id, appId: a.app_id, secret: s.app_secret });
    } catch {
      /* unreadable row — skip */
    }
  }
  return out;
}

export function platformAppReady(): boolean {
  return validAppId(process.env.META_APP_ID) && validAppSecret(process.env.META_APP_SECRET);
}

/**
 * Invites a person as a tester of the PLATFORM app (Meta app-roles API). After they accept the invitation
 * (developers.facebook.com/requests) the normal one-click connection works for them, before the app review.
 */
export async function invitePlatformTester(user: string): Promise<{ ok: boolean; error?: string; code?: number }> {
  if (!platformAppReady()) return { ok: false, error: "not_configured" };
  const appId = process.env.META_APP_ID!;
  const r = await g(`/${encodeURIComponent(appId)}/roles`, { method: "POST", form: { user, role: "testers", access_token: `${appId}|${process.env.META_APP_SECRET}` } });
  if (r.ok && (r.data.success === true || r.data.success === "true" || r.data.success === undefined)) return { ok: true };
  return { ok: false, error: r.error ?? "invite_failed", code: r.code };
}
