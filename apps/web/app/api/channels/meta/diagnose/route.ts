import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { isOrgRole, roleHasPermission } from "@scc/shared/permissions";
import { ACTIVE_ORG_COOKIE, getMemberships, getUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { graphVersion } from "@/lib/channels/meta";
import { evaluateAppSubscriptions } from "@/lib/channels/meta-webhook-health-core";
import { publicEnv } from "@/lib/env";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const REQUIRED_SCOPES = ["pages_messaging", "pages_show_list", "pages_read_engagement", "pages_manage_metadata"];

async function graph(path: string, token?: string) {
  const base = (process.env.META_GRAPH_BASE || `https://graph.facebook.com/${graphVersion()}`).replace(/\/$/, "");
  try {
    const res = await fetch(`${base}${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {}, signal: AbortSignal.timeout(10_000), cache: "no-store" });
    return { ok: res.ok, data: (await res.json().catch(() => ({}))) as Record<string, unknown> & { error?: { message?: string } } };
  } catch (e) {
    return { ok: false, data: { error: { message: (e as Error).message } } as Record<string, unknown> & { error?: { message?: string } } };
  }
}

/**
 * GET /api/channels/meta/diagnose — wave 44: one page that says why Facebook / Instagram messages are (not) arriving.
 * Open it in the browser while signed in as an owner / admin. No secrets and no message text are shown.
 */
export async function GET() {
  const user = await getUser();
  if (!user) return NextResponse.json({ ok: false, error: "sign in first" }, { status: 401 });
  const memberships = (await getMemberships(user.id)).filter((m) => isOrgRole(m.role) && roleHasPermission(m.role, "integrations.manage"));
  const hint = (await cookies()).get(ACTIVE_ORG_COOKIE)?.value;
  const active = memberships.find((m) => m.organization_id === hint) ?? memberships[0];
  if (!active) return NextResponse.json({ ok: false, error: "owner / admin access needed" }, { status: 403 });
  const admin = createAdminClient();
  const appId = process.env.META_APP_ID ?? "";
  const secret = process.env.META_APP_SECRET ?? "";
  const appToken = `${appId}|${secret}`;
  const callback = `${publicEnv.appUrl.replace(/\/$/, "")}/api/channels/meta/pages`;

  const env = {
    META_APP_ID: /^\d{5,30}$/.test(appId),
    META_APP_SECRET: secret.length > 10,
    META_WEBHOOK_VERIFY_TOKEN: (process.env.META_WEBHOOK_VERIFY_TOKEN ?? "").length >= 8,
    CRON_SECRET: Boolean(process.env.CRON_SECRET),
    NEXT_PUBLIC_APP_URL: publicEnv.appUrl,
  };

  const appSubs = env.META_APP_ID && env.META_APP_SECRET ? await graph(`/${appId}/subscriptions?access_token=${encodeURIComponent(appToken)}`) : null;
  const appWebhooks = appSubs ? (appSubs.ok ? { issues: evaluateAppSubscriptions(appSubs.data, callback), raw: appSubs.data.data } : { error: appSubs.data.error?.message }) : { error: "META_APP_ID / META_APP_SECRET missing" };

  const { data: rows } = await admin.from("channel_accounts").select("id, kind, status, last_error, last_inbound_at, config, secret_enc").eq("organization_id", active.organization_id).in("kind", ["messenger", "instagram"]);
  const { openSecrets } = await import("@/lib/channels/secrets");
  const accounts = [];
  for (const a of (rows ?? []) as { id: string; kind: string; status: string; last_error: string | null; last_inbound_at: string | null; config: Record<string, string> | null; secret_enc: string | null }[]) {
    let token = "";
    try {
      token = a.secret_enc ? (openSecrets(a.secret_enc).page_token ?? "") : "";
    } catch {
      token = "";
    }
    const pageId = a.config?.page_id ?? "";
    const subscribed = token && pageId ? await graph(`/${encodeURIComponent(pageId)}/subscribed_apps`, token) : null;
    const dbg = token && env.META_APP_ID && env.META_APP_SECRET ? await graph(`/debug_token?input_token=${encodeURIComponent(token)}&access_token=${encodeURIComponent(appToken)}`) : null;
    const d = (dbg?.data?.data ?? {}) as { is_valid?: boolean; scopes?: string[]; expires_at?: number; app_id?: string };
    accounts.push({
      kind: a.kind,
      status: a.status,
      pageId: pageId || null,
      instagramId: a.config?.ig_id ?? null,
      lastError: a.last_error,
      lastInboundAt: a.last_inbound_at,
      pageSubscribedFields: subscribed?.ok ? ((subscribed.data.data as { id?: string; subscribed_fields?: string[] }[] | undefined) ?? []).map((x) => ({ app: x.id, fields: x.subscribed_fields })) : { error: subscribed?.data.error?.message ?? "no page token / page id" },
      token: dbg ? { valid: d.is_valid ?? false, belongsToThisApp: d.app_id === appId, expiresAt: d.expires_at ? new Date(d.expires_at * 1000).toISOString() : "never", missingPermissions: REQUIRED_SCOPES.filter((x) => !(d.scopes ?? []).includes(x)) } : { error: "could not check" },
    });
  }

  const { data: events } = await admin.from("meta_webhook_events").select("created_at, status, object, entry_id, detail").order("created_at", { ascending: false }).limit(25);
  const list = (events ?? []) as { created_at: string; status: string }[];
  const verdict: string[] = [];
  if (!env.META_APP_SECRET || !env.META_WEBHOOK_VERIFY_TOKEN || !env.META_APP_ID) verdict.push("A Meta environment variable is missing on the server (see env).");
  if ("issues" in appWebhooks && (appWebhooks.issues?.length ?? 0) > 0) verdict.push("The Meta app's webhook is not set up as required (see appWebhooks.issues) — the 5-minute sweep repairs it.");
  if (list.some((e) => e.status === "bad_signature")) verdict.push("Meta IS calling the site but the signature is rejected: META_APP_SECRET must be the secret of the app that sends the webhook.");
  if (list.some((e) => e.status === "no_account")) verdict.push("Meta delivers messages for a Page id that is not connected in this platform (see events).");
  if (!list.some((e) => e.status === "received")) verdict.push("No message webhook from Meta was received recently: check that the Meta app is in Live mode and the Page is subscribed to the app.");
  for (const a of accounts) if (a.token && "missingPermissions" in a.token && (a.token.missingPermissions?.length ?? 0) > 0) verdict.push(`Page token lacks: ${(a.token.missingPermissions ?? []).join(", ")} — reconnect Facebook in Integrations.`);
  return NextResponse.json({ ok: true, verdict: verdict.length ? verdict : ["Everything checked looks correct."], env, appWebhooks, accounts, recentWebhookEvents: events ?? [] }, { headers: { "Cache-Control": "no-store" } });
}
