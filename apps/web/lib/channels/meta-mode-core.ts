/**
 * Round 16 — how businesses connect Facebook + Instagram (pure, unit-tested).
 *
 *   "platform" — the one-click button of the platform's own Meta app (needs the platform app to be approved by Meta)
 *   "own_app"  — every business connects through its own free Meta app with a short guided wizard (works at once,
 *                no approval of the platform needed)
 *
 * The platform admin switches between them with one switch (a platform-wide feature flag). Switching NEVER removes a
 * connection: Pages / Instagram already connected either way keep working — the webhook accepts both, the sync and
 * the agent treat both the same. Only which button the businesses see changes.
 */
export const META_MODE_FLAG = "meta_connect_own_app";
export type MetaConnectMode = "platform" | "own_app";

/**
 * the switch (true / false / never set) → the mode. Never set = "platform": nothing changes for anyone until the platform
 * admin turns own apps on (the screens stay exactly as they were). `platformReady` is kept for the admin card's hint.
 */
export function resolveMetaMode(flag: boolean | null | undefined, platformReady: boolean): MetaConnectMode {
  void platformReady;
  if (flag === true) return "own_app";
  return "platform";
}

/** every address the business's own app needs, from the platform's public address */
export function ownAppUrls(appUrl: string) {
  const base = appUrl.replace(/\/$/, "");
  let host = "";
  try {
    host = new URL(base).hostname;
  } catch {
    host = "";
  }
  return {
    base,
    host,
    redirect: `${base}/api/channels/meta/own/oauth`,
    webhook: `${base}/api/channels/meta/pages`,
    privacy: `${base}/en/legal/privacy`,
    terms: `${base}/en/legal/terms`,
    deletion: `${base}/api/meta/data-deletion`,
    deauth: `${base}/api/meta/deauthorize`,
  };
}

/** direct links into the business's app in Meta's dashboard (the fewer clicks, the better) */
export function appDashboardLinks(appId: string) {
  const id = /^\d{5,30}$/.test(appId) ? appId : "";
  const root = id ? `https://developers.facebook.com/apps/${id}` : "https://developers.facebook.com/apps";
  return {
    dashboard: `${root}/`,
    basic: `${root}/settings/basic/`,
    useCases: `${root}/use_cases/`,
    create: "https://developers.facebook.com/apps/creation/",
  };
}

export type CheckKey = "keys" | "webhooks" | "settings" | "connected" | "page" | "live";
export interface SetupCheck {
  key: CheckKey;
  /** true = fine, false = needs action, null = cannot tell yet */
  ok: boolean | null;
  /** fixed automatically during this check */
  fixed?: boolean;
  detail?: string;
}

/** GET /{app-id}/subscriptions → which objects deliver to our callback with the "messages" field */
export function subscriptionsReady(json: unknown, callback: string): { page: boolean; instagram: boolean } {
  const list = ((json as { data?: { object?: string; callback_url?: string; active?: boolean; fields?: ({ name?: string } | string)[] }[] } | null)?.data ?? []);
  const ok = (object: string) => {
    const s = list.find((x) => x.object === object);
    if (!s || s.active === false) return false;
    if ((s.callback_url ?? "").replace(/\/$/, "") !== callback.replace(/\/$/, "")) return false;
    return (s.fields ?? []).some((f) => (typeof f === "string" ? f : f.name) === "messages");
  };
  return { page: ok("page"), instagram: ok("instagram") };
}

/** the one next thing the business should do (the screen shows only this, big) */
export function nextOwnStep(checks: SetupCheck[]): CheckKey | "done" {
  const order: CheckKey[] = ["keys", "connected", "webhooks", "page", "live"];
  for (const k of order) {
    const c = checks.find((x) => x.key === k);
    if (c && c.ok === false) return k;
  }
  return "done";
}
