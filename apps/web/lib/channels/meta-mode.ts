import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { graphVersion } from "./meta";
import { META_MODE_FLAG, ownAppUrls, resolveMetaMode, subscriptionsReady, type MetaConnectMode, type SetupCheck } from "./meta-mode-core";

/**
 * Round 16 — the platform-wide "how businesses connect Facebook + Instagram" switch, and the own-app wizard's
 * automation: everything Meta lets an app's own keys do is done FOR the business (webhooks, privacy / terms / data
 * deletion addresses, app domain, Page subscription), and a one-click check says what is still missing.
 */
export async function loadMetaMode(): Promise<MetaConnectMode> {
  const { platformAppReady } = await import("./meta-own");
  let flag: boolean | null = null;
  try {
    if (process.env.SUPABASE_SERVICE_ROLE_KEY) {
      const { data } = await createAdminClient().from("feature_flags").select("enabled").eq("key", META_MODE_FLAG).is("organization_id", null).maybeSingle();
      flag = data ? Boolean((data as { enabled: boolean }).enabled) : null;
    }
  } catch {
    flag = null;
  }
  return resolveMetaMode(flag, platformAppReady() && /^\d{5,30}$/.test(process.env.META_PAGES_CONFIG_ID ?? ""));
}

const graph = () => (process.env.META_GRAPH_BASE || `https://graph.facebook.com/${graphVersion()}`).replace(/\/$/, "");

async function call(path: string, init: { method?: "GET" | "POST"; form?: Record<string, string>; token?: string } = {}) {
  try {
    const res = await fetch(`${graph()}${path}`, {
      method: init.method ?? "GET",
      headers: { ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}), ...(init.form ? { "Content-Type": "application/x-www-form-urlencoded" } : {}) },
      body: init.form ? new URLSearchParams(init.form).toString() : undefined,
      signal: AbortSignal.timeout(12_000),
      cache: "no-store",
    });
    const j = (await res.json().catch(() => ({}))) as Record<string, unknown> & { error?: { message?: string } };
    return { ok: res.ok && !j.error, data: j, error: j.error?.message };
  } catch (e) {
    return { ok: false, data: {} as Record<string, unknown>, error: (e as Error).message };
  }
}

/**
 * Fills the app's basic settings with the platform's addresses (privacy, terms, data deletion, deauthorize, app
 * domain) — what Meta requires before an app can be switched to Live. Each field separately and best effort: a field
 * Meta does not let the app's keys change is simply skipped (the wizard then shows it to copy).
 */
export async function configureOwnAppSettings(appId: string, secret: string, appUrl: string): Promise<{ done: string[]; skipped: string[] }> {
  const u = ownAppUrls(appUrl);
  const token = `${appId}|${secret}`;
  const fields: [string, string][] = [
    ["privacy_policy_url", u.privacy],
    ["terms_of_service_url", u.terms],
    ["user_data_deletion_url", u.deletion],
    ["deauth_callback_url", u.deauth],
    ["app_domains", JSON.stringify(u.host ? [u.host] : [])],
  ];
  const done: string[] = [];
  const skipped: string[] = [];
  for (const [k, v] of fields) {
    if (!v || v === "[]") continue;
    const r = await call(`/${encodeURIComponent(appId)}`, { method: "POST", form: { [k]: v, access_token: token } });
    (r.ok ? done : skipped).push(k);
  }
  return { done, skipped };
}

/**
 * The wizard's "check & fix": reads the app and the connected Page, repairs what the keys can repair (webhooks, the
 * Page subscription, the settings) and reports the rest in order. Never throws.
 */
export async function ownSetupStatus(orgId: string, appUrl: string): Promise<{ checks: SetupCheck[]; appId: string | null }> {
  const checks: SetupCheck[] = [];
  const { loadOwnApp, configureOwnWebhooks } = await import("./meta-own");
  const app = await loadOwnApp(orgId).catch(() => null);
  if (!app?.secret) return { checks: [{ key: "keys", ok: false }], appId: null };
  const u = ownAppUrls(appUrl);
  const token = `${app.appId}|${app.secret}`;
  const admin = createAdminClient();

  // 1. the keys still work
  const me = await call(`/${encodeURIComponent(app.appId)}?${new URLSearchParams({ fields: "name", access_token: token }).toString()}`);
  checks.push({ key: "keys", ok: me.ok, detail: me.ok ? undefined : me.error });
  if (!me.ok) return { checks, appId: app.appId };

  // 2. webhooks point to us (fixed automatically when not)
  const subs = await call(`/${encodeURIComponent(app.appId)}/subscriptions?${new URLSearchParams({ access_token: token }).toString()}`);
  let ready = subs.ok ? subscriptionsReady(subs.data, u.webhook) : { page: false, instagram: false };
  let fixedHooks = false;
  if (!ready.page && app.verifyToken) {
    const fix = await configureOwnWebhooks(app.appId, app.secret, u.webhook, app.verifyToken);
    if (fix.page) {
      fixedHooks = true;
      ready = { page: true, instagram: fix.instagram };
      await admin.from("meta_own_apps").update({ webhooks_ok: true, last_error: null, updated_at: new Date().toISOString() }).eq("organization_id", orgId);
    }
  }
  checks.push({ key: "webhooks", ok: ready.page, fixed: fixedHooks });

  // 3. the addresses Meta requires before Live (filled automatically, best effort)
  const s = await configureOwnAppSettings(app.appId, app.secret, appUrl).catch(() => ({ done: [] as string[], skipped: ["all"] }));
  checks.push({ key: "settings", ok: s.done.includes("privacy_policy_url") ? true : null, fixed: s.done.length > 0, detail: s.skipped.join(",") || undefined });

  // 4. a Page is connected through this app, 5. it is subscribed to the app (re-subscribed when not)
  const { data: fb } = await admin.from("channel_accounts").select("id, config").eq("organization_id", orgId).eq("kind", "messenger").maybeSingle();
  const cfg = ((fb?.config ?? {}) as Record<string, string>);
  const connected = Boolean(fb) && cfg.own_app_id === app.appId;
  checks.push({ key: "connected", ok: connected });
  let pageOk: boolean | null = null;
  if (connected) {
    const { loadAccountById } = await import("@/lib/social/accounts");
    const full = await loadAccountById(fb!.id as string).catch(() => null);
    const pageToken = full?.secrets.page_token ?? "";
    if (pageToken && cfg.page_id) {
      const sub = await call(`/${encodeURIComponent(cfg.page_id)}/subscribed_apps`, { token: pageToken });
      const list = (sub.data.data as { id?: string | number }[] | undefined) ?? [];
      pageOk = sub.ok && list.some((a) => String(a.id ?? "") === app.appId);
      if (!pageOk) {
        const { subscribePage } = await import("./meta-pages");
        const fix = await subscribePage(cfg.page_id, pageToken);
        if (fix.ok) pageOk = true;
        checks.push({ key: "page", ok: pageOk, fixed: fix.ok });
      } else checks.push({ key: "page", ok: true });
    } else checks.push({ key: "page", ok: false });
  }

  // 6. Live: Meta delivers customers' messages only to a Live app — seen when a webhook for this Page arrived lately
  if (connected) {
    const { data: igRow } = await admin.from("channel_accounts").select("config").eq("organization_id", orgId).eq("kind", "instagram").maybeSingle();
    const igId = ((igRow?.config ?? {}) as Record<string, string>).ig_id;
    const ids = [cfg.page_id, igId].filter((x): x is string => Boolean(x));
    let seen = false;
    try {
      const { data: ev } = await admin.from("meta_webhook_events").select("id").eq("status", "received").in("entry_id", ids).gte("created_at", new Date(Date.now() - 3 * 86_400_000).toISOString()).limit(1).maybeSingle();
      seen = Boolean(ev);
    } catch {
      seen = false;
    }
    checks.push({ key: "live", ok: seen ? true : null });
  }
  return { checks, appId: app.appId };
}
