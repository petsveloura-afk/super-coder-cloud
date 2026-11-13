"use server";

import { revalidatePath } from "next/cache";
import { getOrgContext } from "@/lib/auth";
import type { ActionState } from "@/lib/action-state";
import { cleanAppId, cleanAppSecret, explainOwnAppError, parseFacebookProfile, validAppId, validAppSecret, webhookCallbackUrl } from "@/lib/channels/meta-own-core";

/**
 * Facebook / Instagram for every business while the platform's Meta app is still in review:
 *   • saveOwnAppAction    — the business's own Meta app (App ID + App Secret) is checked with Meta, stored sealed,
 *                           and its webhooks are pointed at the platform automatically
 *   • requestTesterAction — the platform invites the person as a tester of the platform app (automatic);
 *                           when Meta refuses, the request waits for a platform admin
 */
const loc = (l: string) => (l === "ar" || l === "en" ? l : "he");

async function appUrl(): Promise<string> {
  const { publicEnv } = await import("@/lib/env");
  return publicEnv.appUrl.replace(/\/$/, "");
}

export async function saveOwnAppAction(input: { locale: string; appId: string; appSecret: string; configId?: string }): Promise<ActionState<{ webhooks: boolean; name: string | null }>> {
  const locale = loc(input.locale);
  const ctx = await getOrgContext(locale);
  if (!ctx.can("integrations.manage")) return { error: "errors.forbidden" };
  const appId = cleanAppId(input.appId);
  const secret = cleanAppSecret(input.appSecret);
  const configId = cleanAppId(input.configId ?? "");
  if (!validAppId(appId)) return { error: "metaAlt.err.appIdFormat" };
  if (!validAppSecret(secret)) return { error: "metaAlt.err.secretFormat" };
  if (configId && !validAppId(configId)) return { error: "metaAlt.err.configFormat" };
  const { encryptionReady, sealSecrets } = await import("@/lib/channels/secrets");
  if (!encryptionReady()) return { error: "integrations.channels.encryptionMissing" };
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return { error: "common.error" };
  const { checkOwnApp, configureOwnWebhooks, hashVerifyToken, loadOwnApp, newVerifyToken } = await import("@/lib/channels/meta-own");
  const check = await checkOwnApp(appId, secret);
  if (!check.ok) return { error: explainOwnAppError(check.error, check.code), messageParams: { detail: (check.error ?? "").slice(0, 300) } };
  const prev = await loadOwnApp(ctx.org.id);
  const verifyToken = prev?.verifyToken && prev.appId === appId ? prev.verifyToken : newVerifyToken();
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const admin = createAdminClient();
  const row = {
    organization_id: ctx.org.id,
    app_id: appId,
    app_name: check.name ?? null,
    config_id: configId || null,
    secret_enc: sealSecrets({ app_secret: secret, verify_token: verifyToken }),
    verify_token_hash: hashVerifyToken(verifyToken),
    status: prev?.status === "connected" && prev.appId === appId ? "connected" : "saved",
    last_error: null,
    created_by: ctx.userId,
    updated_at: new Date().toISOString(),
  };
  const { error } = await admin.from("meta_own_apps").upsert(row, { onConflict: "organization_id" });
  if (error) return { error: "common.error" };
  // the hash is stored first: Meta checks the callback (GET with the verify token) while we configure it
  const hooks = await configureOwnWebhooks(appId, secret, webhookCallbackUrl(await appUrl()), verifyToken);
  await admin.from("meta_own_apps").update({ webhooks_ok: hooks.ok, last_error: hooks.ok ? null : `webhooks: ${hooks.error ?? ""}`.slice(0, 900) }).eq("organization_id", ctx.org.id);
  const publicEnvUrl = await appUrl();
  // round 16: the addresses Meta requires before the app can go Live (privacy, terms, data deletion, domain) — filled for the business
  await import("@/lib/channels/meta-mode").then((m) => m.configureOwnAppSettings(appId, secret, publicEnvUrl)).catch(() => undefined);
  await admin.from("audit_logs").insert({ organization_id: ctx.org.id, actor_id: ctx.userId, action: "integrations.meta_own_app", entity_type: "organization", entity_id: ctx.org.id, metadata: { app_id: appId, webhooks: hooks.ok } }).then(() => undefined, () => undefined);
  revalidatePath(`/${locale}/integrations`);
  return { ok: true, message: hooks.ok ? "metaAlt.savedWithHooks" : "metaAlt.savedNoHooks", messageParams: { name: check.name ?? appId }, data: { webhooks: hooks.ok, name: check.name ?? null } };
}

export async function retryOwnWebhooksAction(input: { locale: string }): Promise<ActionState> {
  const locale = loc(input.locale);
  const ctx = await getOrgContext(locale);
  if (!ctx.can("integrations.manage")) return { error: "errors.forbidden" };
  const { configureOwnWebhooks, loadOwnApp } = await import("@/lib/channels/meta-own");
  const app = await loadOwnApp(ctx.org.id);
  if (!app?.secret || !app.verifyToken) return { error: "metaAlt.err.noApp" };
  const hooks = await configureOwnWebhooks(app.appId, app.secret, webhookCallbackUrl(await appUrl()), app.verifyToken);
  const { createAdminClient } = await import("@/lib/supabase/admin");
  await createAdminClient().from("meta_own_apps").update({ webhooks_ok: hooks.ok, last_error: hooks.ok ? null : `webhooks: ${hooks.error ?? ""}`.slice(0, 900), updated_at: new Date().toISOString() }).eq("organization_id", ctx.org.id);
  revalidatePath(`/${locale}/integrations`);
  return hooks.ok ? { ok: true, message: "metaAlt.hooksOk" } : { error: explainOwnAppError(hooks.error), messageParams: { detail: (hooks.error ?? "").slice(0, 300) } };
}

/** the webhook verify token for the manual setup in Meta (shown only to people who manage integrations) */
export async function revealOwnVerifyTokenAction(input: { locale: string }): Promise<ActionState<{ token: string; callback: string }>> {
  const locale = loc(input.locale);
  const ctx = await getOrgContext(locale);
  if (!ctx.can("integrations.manage")) return { error: "errors.forbidden" };
  const { loadOwnApp } = await import("@/lib/channels/meta-own");
  const app = await loadOwnApp(ctx.org.id);
  if (!app?.verifyToken) return { error: "metaAlt.err.noApp" };
  return { ok: true, data: { token: app.verifyToken, callback: webhookCallbackUrl(await appUrl()) } };
}

export async function removeOwnAppAction(fd: FormData): Promise<ActionState> {
  const locale = loc(String(fd.get("locale") ?? "he"));
  const ctx = await getOrgContext(locale);
  if (!ctx.can("integrations.manage")) return { error: "errors.forbidden" };
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return { error: "common.error" };
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const { error } = await createAdminClient().from("meta_own_apps").delete().eq("organization_id", ctx.org.id);
  if (error) return { error: "common.error" };
  revalidatePath(`/${locale}/integrations`);
  return { ok: true, message: "metaAlt.removed" };
}

export async function requestTesterAction(input: { locale: string; profile: string }): Promise<ActionState<{ invited: boolean }>> {
  const locale = loc(input.locale);
  const ctx = await getOrgContext(locale);
  if (!ctx.can("integrations.manage")) return { error: "errors.forbidden" };
  const ref = parseFacebookProfile(input.profile);
  if (!ref) return { error: "metaAlt.err.profileFormat" };
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return { error: "common.error" };
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const admin = createAdminClient();
  // at most 5 requests per business a day — Meta limits invitations too
  const { count } = await admin.from("meta_tester_requests").select("id", { count: "exact", head: true }).eq("organization_id", ctx.org.id).gte("created_at", new Date(Date.now() - 86_400_000).toISOString());
  if ((count ?? 0) >= 5) return { error: "metaAlt.err.tooMany" };
  const { invitePlatformTester } = await import("@/lib/channels/meta-own");
  const r = await invitePlatformTester(ref.id ?? ref.username ?? ref.ref);
  const { error } = await admin.from("meta_tester_requests").insert({
    organization_id: ctx.org.id,
    user_id: ctx.userId,
    profile_ref: input.profile.trim().slice(0, 300),
    fb_user: (ref.id ?? ref.username ?? "").slice(0, 120) || null,
    status: r.ok ? "invited" : "pending",
    last_error: r.ok ? null : `${r.code ?? ""} ${r.error ?? ""}`.trim().slice(0, 900),
  });
  if (error) return { error: "common.error" };
  revalidatePath(`/${locale}/integrations`);
  // when Meta refuses (e.g. it does not accept a username) the request waits for the platform admin — never a dead end
  return r.ok ? { ok: true, message: "metaAlt.tester.invited", data: { invited: true } } : { ok: true, message: "metaAlt.tester.queued", data: { invited: false } };
}

/** platform admin: mark a waiting tester request as handled (added by hand in Meta) */
export async function markTesterRequestAction(fd: FormData): Promise<ActionState> {
  const locale = loc(String(fd.get("locale") ?? "he"));
  const ctx = await getOrgContext(locale);
  if (!ctx.isPlatformAdmin) return { error: "errors.forbidden" };
  const id = String(fd.get("id") ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { error: "validation.invalidId" };
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const { error } = await createAdminClient().from("meta_tester_requests").update({ status: "done", updated_at: new Date().toISOString() }).eq("id", id);
  if (error) return { error: "common.error" };
  revalidatePath(`/${locale}/integrations`);
  return { ok: true, message: "metaAlt.tester.marked" };
}
