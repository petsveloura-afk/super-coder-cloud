import "server-only";
import { graphVersion } from "./meta";
import { APP_WEBHOOK_OBJECTS, evaluateAppSubscriptions, type AppWebhookIssue } from "./meta-webhook-health-core";

export interface AppWebhookReport {
  checked: boolean;
  issues: AppWebhookIssue[];
  repaired: string[];
  error?: string;
}

const base = () => (process.env.META_GRAPH_BASE || `https://graph.facebook.com/${graphVersion()}`).replace(/\/$/, "");

/**
 * Reads the app's webhook subscriptions (Page + Instagram) and repairs what is clearly broken: a missing / switched-off
 * subscription or one without the "messages" field. A subscription that points somewhere else is only reported.
 * Set META_WEBHOOK_AUTOFIX=0 to only report. Never throws.
 */
export async function checkMetaAppWebhooks(opts: { callbackBase: string; fix?: boolean }): Promise<AppWebhookReport> {
  const appId = process.env.META_APP_ID ?? "";
  const secret = process.env.META_APP_SECRET ?? "";
  const verify = process.env.META_WEBHOOK_VERIFY_TOKEN ?? "";
  if (!/^\d{5,30}$/.test(appId) || !secret) return { checked: false, issues: [], repaired: [], error: "meta_app_not_configured" };
  const appToken = `${appId}|${secret}`;
  const callback = `${opts.callbackBase.replace(/\/$/, "")}/api/channels/meta/pages`;
  try {
    const res = await fetch(`${base()}/${appId}/subscriptions?access_token=${encodeURIComponent(appToken)}`, { signal: AbortSignal.timeout(10_000), cache: "no-store" });
    const json = (await res.json().catch(() => ({}))) as unknown;
    if (!res.ok) return { checked: false, issues: [], repaired: [], error: `subscriptions HTTP ${res.status}: ${JSON.stringify((json as { error?: { message?: string } }).error?.message ?? "").slice(0, 200)}` };
    const issues = evaluateAppSubscriptions(json, callback);
    const repaired: string[] = [];
    const autofix = opts.fix !== false && process.env.META_WEBHOOK_AUTOFIX !== "0" && verify.length >= 8;
    if (autofix) {
      for (const object of new Set(issues.filter((i) => i.fixable).map((i) => i.object))) {
        const body = new URLSearchParams({ object, callback_url: callback, fields: APP_WEBHOOK_OBJECTS[object].join(","), verify_token: verify, access_token: appToken });
        const r = await fetch(`${base()}/${appId}/subscriptions`, { method: "POST", body, signal: AbortSignal.timeout(10_000), cache: "no-store" }).catch(() => null);
        if (r?.ok) repaired.push(object);
        else console.error("meta app webhook repair failed", object, r?.status ?? "no response");
      }
    }
    for (const i of issues) console.error(`meta app webhook problem: ${i.detail}${repaired.includes(i.object) && i.fixable ? " (repaired)" : ""}`);
    return { checked: true, issues, repaired };
  } catch (e) {
    return { checked: false, issues: [], repaired: [], error: (e as Error).message.slice(0, 200) };
  }
}
