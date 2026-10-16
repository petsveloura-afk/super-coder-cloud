"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { generateApiKey } from "@scc/shared/crypto";
import { AUTOMATION_TRIGGERS } from "@scc/shared/automations";
import { fieldErrors, uuidSchema } from "@scc/shared/validators";
import { getOrgContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { dbErrorKey, type ActionState } from "@/lib/action-state";
import { formLocale, str } from "@/lib/form";
import { API_SCOPES } from "@/lib/public-api";
import { assertPublicHttpsUrl } from "@/lib/net/safe-url";

/* ---------------------------------------------------------- API keys ---- */

const keySchema = z.object({
  name: z.string().trim().min(1, { message: "validation.required" }).max(80, { message: "validation.tooLong" }),
  scopes: z.array(z.enum(API_SCOPES)).min(1, { message: "integrations.needScope" }),
});

export async function createApiKeyAction(_prev: ActionState<{ key: string }>, fd: FormData): Promise<ActionState<{ key: string }>> {
  const locale = formLocale(fd);
  const ctx = await getOrgContext(locale);
  if (!ctx.can("api.manage")) return { error: "errors.forbidden" };
  const parsed = keySchema.safeParse({ name: str(fd, "name"), scopes: fd.getAll("scopes").map(String) });
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error), values: { name: str(fd, "name") } };
  const k = generateApiKey();
  const supabase = await createClient();
  const { error } = await supabase.from("api_keys").insert({
    organization_id: ctx.org.id,
    name: parsed.data.name,
    prefix: k.prefix,
    key_hash: k.hash,
    scopes: parsed.data.scopes,
    created_by: ctx.userId,
  });
  if (error) return { error: dbErrorKey(error) };
  revalidatePath(`/${locale}/integrations`);
  // The full key is returned ONCE to the creator and never stored.
  return { ok: true, message: "integrations.keyCreated", data: { key: k.key } };
}

export async function revokeApiKeyAction(fd: FormData): Promise<ActionState> {
  const locale = formLocale(fd);
  const ctx = await getOrgContext(locale);
  if (!ctx.can("api.manage")) return { error: "errors.forbidden" };
  const id = uuidSchema.safeParse(str(fd, "id"));
  if (!id.success) return { error: "validation.invalidId" };
  const supabase = await createClient();
  const { error } = await supabase.from("api_keys").update({ revoked_at: new Date().toISOString() }).eq("id", id.data).eq("organization_id", ctx.org.id);
  if (error) return { error: dbErrorKey(error) };
  revalidatePath(`/${locale}/integrations`);
  return { ok: true, message: "integrations.keyRevoked" };
}

/* ------------------------------------------------- outbound webhooks ---- */

const WEBHOOK_EVENTS = ["*", ...AUTOMATION_TRIGGERS.filter((t) => t !== "webhook.inbound")] as const;

const webhookSchema = z.object({
  url: z.string().trim().max(2000).regex(/^https:\/\/\S+$/, { message: "validation.httpsUrl" }),
  description: z.string().trim().max(200, { message: "validation.tooLong" }).optional().default(""),
  events: z.array(z.enum(WEBHOOK_EVENTS)).min(1, { message: "integrations.needEvent" }).max(30),
});

export async function saveWebhookAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const locale = formLocale(fd);
  const ctx = await getOrgContext(locale);
  const values = { url: str(fd, "url"), description: str(fd, "description") };
  if (!ctx.can("api.manage")) return { error: "errors.forbidden", values };
  const parsed = webhookSchema.safeParse({ ...values, events: fd.getAll("events").map(String) });
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error), values };
  try {
    await assertPublicHttpsUrl(parsed.data.url);
  } catch {
    return { fieldErrors: { url: "integrations.urlNotPublic" }, values };
  }
  const supabase = await createClient();
  const rawId = str(fd, "id");
  const row = { url: parsed.data.url, description: parsed.data.description || null, events: parsed.data.events };
  if (rawId) {
    const id = uuidSchema.safeParse(rawId);
    if (!id.success) return { error: "validation.invalidId", values };
    const { error } = await supabase.from("webhooks").update({ ...row, failure_count: 0, enabled: true }).eq("id", id.data).eq("organization_id", ctx.org.id);
    if (error) return { error: dbErrorKey(error), values };
  } else {
    const { error } = await supabase.from("webhooks").insert({ ...row, organization_id: ctx.org.id, created_by: ctx.userId });
    if (error) return { error: dbErrorKey(error), values };
  }
  revalidatePath(`/${locale}/integrations`);
  return { ok: true, message: "integrations.webhookSaved" };
}

export async function toggleWebhookAction(fd: FormData): Promise<ActionState> {
  const locale = formLocale(fd);
  const ctx = await getOrgContext(locale);
  if (!ctx.can("api.manage")) return { error: "errors.forbidden" };
  const id = uuidSchema.safeParse(str(fd, "id"));
  if (!id.success) return { error: "validation.invalidId" };
  const enabled = str(fd, "enabled") === "true";
  const supabase = await createClient();
  const { error } = await supabase.from("webhooks").update({ enabled, failure_count: 0 }).eq("id", id.data).eq("organization_id", ctx.org.id);
  if (error) return { error: dbErrorKey(error) };
  revalidatePath(`/${locale}/integrations`);
  return { ok: true, message: enabled ? "integrations.webhookEnabled" : "integrations.webhookDisabled" };
}

export async function deleteWebhookAction(fd: FormData): Promise<ActionState> {
  const locale = formLocale(fd);
  const ctx = await getOrgContext(locale);
  if (!ctx.can("api.manage")) return { error: "errors.forbidden" };
  const id = uuidSchema.safeParse(str(fd, "id"));
  if (!id.success) return { error: "validation.invalidId" };
  const supabase = await createClient();
  const { error } = await supabase.from("webhooks").delete().eq("id", id.data).eq("organization_id", ctx.org.id);
  if (error) return { error: dbErrorKey(error) };
  revalidatePath(`/${locale}/integrations`);
  return { ok: true, message: "integrations.webhookDeleted" };
}

export async function rotateWebhookSecretAction(fd: FormData): Promise<ActionState> {
  const locale = formLocale(fd);
  const ctx = await getOrgContext(locale);
  if (!ctx.can("api.manage")) return { error: "errors.forbidden" };
  const id = uuidSchema.safeParse(str(fd, "id"));
  if (!id.success) return { error: "validation.invalidId" };
  const { randomBytes } = await import("node:crypto");
  const supabase = await createClient();
  const { error } = await supabase.from("webhooks").update({ secret: randomBytes(24).toString("hex") }).eq("id", id.data).eq("organization_id", ctx.org.id);
  if (error) return { error: dbErrorKey(error) };
  revalidatePath(`/${locale}/integrations`);
  return { ok: true, message: "integrations.secretRotated" };
}

/* --------------------------------------------- messaging channels ------- */

const channelSchemas = {
  telegram: z.object({
    bot_token: z.string().trim().regex(/^\d{5,15}:[A-Za-z0-9_-]{30,60}$/, { message: "integrations.channels.badBotToken" }),
  }),
  whatsapp: z.object({
    access_token: z.string().trim().min(20, { message: "integrations.channels.badAccessToken" }).max(1000),
    phone_number_id: z.string().trim().regex(/^\d{5,30}$/, { message: "integrations.channels.badPhoneNumberId" }),
    app_secret: z.string().trim().regex(/^[a-f0-9]{32}$/i, { message: "integrations.channels.badAppSecret" }),
  }),
  sms: z.object({
    account_sid: z.string().trim().regex(/^AC[a-f0-9]{32}$/i, { message: "integrations.channels.badSid" }),
    auth_token: z.string().trim().regex(/^[a-f0-9]{32}$/i, { message: "integrations.channels.badAuthToken" }),
    from_number: z.string().trim().regex(/^\+\d{7,15}$/, { message: "validation.phone" }),
  }),
} as const;
type ChannelKind = keyof typeof channelSchemas;

export async function connectChannelAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const locale = formLocale(fd);
  const ctx = await getOrgContext(locale);
  const kind = str(fd, "kind") as ChannelKind;
  if (!ctx.can("integrations.manage")) return { error: "errors.forbidden" };
  if (!(kind in channelSchemas)) return { error: "validation.invalidId" };
  const { encryptionReady, sealSecrets } = await import("@/lib/channels/secrets");
  if (!encryptionReady()) return { error: "integrations.channels.encryptionMissing" };
  const raw: Record<string, string> = {};
  for (const k of Object.keys(channelSchemas[kind].shape)) raw[k] = str(fd, k);
  const parsed = channelSchemas[kind].safeParse(raw);
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error), values: kind === "sms" ? { from_number: raw.from_number ?? "", account_sid: raw.account_sid ?? "" } : kind === "whatsapp" ? { phone_number_id: raw.phone_number_id ?? "" } : {} };
  const v = parsed.data as Record<string, string>;
  const providers = await import("@/lib/channels/providers");

  // 1. verify the credentials against the provider before storing anything
  let config: Record<string, string> = {};
  let secrets: Record<string, string> = {};
  if (kind === "telegram") {
    const me = await providers.telegramCall(v.bot_token!, "getMe");
    if (!me.ok) return { error: "integrations.channels.verifyFailed", messageParams: { detail: me.error ?? "" } };
    config = { username: String(me.data?.username ?? ""), bot_id: String(me.data?.id ?? "") };
    secrets = { bot_token: v.bot_token! };
  } else if (kind === "whatsapp") {
    const ph = await providers.whatsappGetPhone(v.access_token!, v.phone_number_id!);
    if (!ph.ok) return { error: "integrations.channels.verifyFailed", messageParams: { detail: ph.error ?? "" } };
    config = { phone_number_id: v.phone_number_id!, display_phone_number: String(ph.data?.display_phone_number ?? ""), verified_name: String(ph.data?.verified_name ?? "") };
    secrets = { access_token: v.access_token!, app_secret: v.app_secret! };
  } else {
    const acc = await providers.twilioGetAccount(v.account_sid!, v.auth_token!);
    if (!acc.ok) return { error: "integrations.channels.verifyFailed", messageParams: { detail: acc.error ?? "" } };
    config = { account_sid: v.account_sid!, from_number: v.from_number!, friendly_name: String(acc.data?.friendly_name ?? "") };
    secrets = { auth_token: v.auth_token! };
  }

  // 2. store (encrypted) — one account per channel per workspace
  const supabase = await createClient();
  const row = { config, secret_enc: sealSecrets(secrets), status: "active", last_error: null, name: config.username || config.verified_name || config.friendly_name || kind, updated_at: new Date().toISOString() };
  const { data: existing } = await supabase.from("channel_accounts").select("id, webhook_token").eq("organization_id", ctx.org.id).eq("kind", kind).maybeSingle();
  let token = existing?.webhook_token as string | undefined;
  if (existing) {
    const { error } = await supabase.from("channel_accounts").update(row).eq("id", existing.id).eq("organization_id", ctx.org.id);
    if (error) return { error: dbErrorKey(error) };
  } else {
    const { data, error } = await supabase.from("channel_accounts").insert({ ...row, organization_id: ctx.org.id, kind, created_by: ctx.userId }).select("webhook_token").single();
    if (error) return { error: dbErrorKey(error) };
    token = data.webhook_token as string;
  }

  // 3. Telegram can be wired automatically; WhatsApp/Twilio need the URL pasted in their console
  if (kind === "telegram" && token) {
    const { publicEnv } = await import("@/lib/env");
    const url = `${publicEnv.appUrl.replace(/\/$/, "")}/api/channels/telegram/${token}`;
    const hook = await providers.telegramCall(v.bot_token!, "setWebhook", { url, secret_token: token, allowed_updates: ["message", "edited_message", "channel_post"], drop_pending_updates: false });
    if (!hook.ok) {
      await supabase.from("channel_accounts").update({ status: "error", last_error: `setWebhook: ${hook.error ?? ""}`.slice(0, 500) }).eq("organization_id", ctx.org.id).eq("kind", kind);
      revalidatePath(`/${locale}/integrations`);
      return { error: "integrations.channels.webhookFailed", messageParams: { detail: hook.error ?? "" } };
    }
  }
  revalidatePath(`/${locale}/integrations`);
  revalidatePath(`/${locale}/inbox`);
  return { ok: true, message: "integrations.channels.connected" };
}

export async function disconnectChannelAction(fd: FormData): Promise<ActionState> {
  const locale = formLocale(fd);
  const ctx = await getOrgContext(locale);
  if (!ctx.can("integrations.manage")) return { error: "errors.forbidden" };
  const kind = str(fd, "kind");
  if (!["telegram", "whatsapp", "sms"].includes(kind)) return { error: "validation.invalidId" };
  if (kind === "telegram") {
    try {
      const { loadAccount } = await import("@/lib/channels/accounts");
      const { telegramCall } = await import("@/lib/channels/providers");
      const acc = await loadAccount(ctx.org.id, "telegram");
      if (acc?.secrets.bot_token) await telegramCall(acc.secrets.bot_token, "deleteWebhook", { drop_pending_updates: false });
    } catch {
      // best effort — the row is removed either way
    }
  }
  const supabase = await createClient();
  const { error } = await supabase.from("channel_accounts").delete().eq("organization_id", ctx.org.id).eq("kind", kind);
  if (error) return { error: dbErrorKey(error) };
  revalidatePath(`/${locale}/integrations`);
  return { ok: true, message: "integrations.channels.disconnected" };
}
