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
  // wave 13: API keys are part of the Business plan and up
  const { orgHasFeature } = await import("@/lib/billing/features");
  if (!(await orgHasFeature(ctx.org.id, "api_access"))) return { error: "plans.locked.api_access.title" };
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
    const hook = await providers.telegramCall(v.bot_token!, "setWebhook", { url, secret_token: token, allowed_updates: [...(await import("@/lib/channels/telegram-setup")).TELEGRAM_UPDATES], drop_pending_updates: false });
    if (!hook.ok) {
      await supabase.from("channel_accounts").update({ status: "error", last_error: `setWebhook: ${hook.error ?? ""}`.slice(0, 500) }).eq("organization_id", ctx.org.id).eq("kind", kind);
      revalidatePath(`/${locale}/integrations`);
      return { error: "integrations.channels.webhookFailed", messageParams: { detail: hook.error ?? "" } };
    }
    // wave 8: bot menu (commands), description and short description from the AI agent
    try {
      const { configureTelegramBot } = await import("@/lib/channels/telegram-setup");
      await configureTelegramBot(ctx.org.id);
    } catch {
      // cosmetic — the bot works without it
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

/* ------------------------------------- wave 6: e-mail, WhatsApp (official / QR) ---- */

const mailboxSchema = z.object({
  address: z.string().trim().toLowerCase().email({ message: "validation.email" }).max(200),
  password: z.string().trim().min(4, { message: "integrations.mail.badPassword" }).max(300),
  display_name: z.string().trim().max(120).optional().default(""),
  imap_host: z.string().trim().max(200).optional().default(""),
  imap_port: z.string().trim().max(5).optional().default(""),
  smtp_host: z.string().trim().max(200).optional().default(""),
  smtp_port: z.string().trim().max(5).optional().default(""),
});
const HOST_RE = /^[a-z0-9.-]{3,200}$/i;

/** Any mailbox (Gmail, Outlook, Yahoo, iCloud, a business domain…) with an app password. */
export async function connectMailboxAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const locale = formLocale(fd);
  const ctx = await getOrgContext(locale);
  const values = { address: str(fd, "address"), display_name: str(fd, "display_name"), imap_host: str(fd, "imap_host"), imap_port: str(fd, "imap_port"), smtp_host: str(fd, "smtp_host"), smtp_port: str(fd, "smtp_port") };
  if (!ctx.can("integrations.manage")) return { error: "errors.forbidden", values };
  const { encryptionReady } = await import("@/lib/channels/secrets");
  if (!encryptionReady()) return { error: "integrations.channels.encryptionMissing", values };
  const parsed = mailboxSchema.safeParse({ ...values, password: str(fd, "password").replace(/\s+/g, "") });
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error), values };
  const v = parsed.data;
  const { detectMailServers } = await import("@/lib/channels/email-core");
  const auto = detectMailServers(v.address);
  const imap_host = v.imap_host || auto.imap_host;
  const smtp_host = v.smtp_host || auto.smtp_host;
  const imap_port = Number(v.imap_port || auto.imap_port);
  const smtp_port = Number(v.smtp_port || auto.smtp_port);
  if (!HOST_RE.test(imap_host) || !HOST_RE.test(smtp_host) || !(imap_port > 0 && imap_port < 65536) || !(smtp_port > 0 && smtp_port < 65536)) {
    return { error: "integrations.mail.badServer", values };
  }
  const { verifyMailbox } = await import("@/lib/channels/email");
  const cfg = { address: v.address, display_name: v.display_name || ctx.org.name, auth: "password" as const, imap_host, imap_port, smtp_host, smtp_port };
  const check = await verifyMailbox(cfg, { password: v.password });
  if (!check.ok) {
    return { error: check.step === "smtp" ? "integrations.mail.smtpFailed" : "integrations.mail.imapFailed", messageParams: { detail: check.error ?? "" }, values: { ...values, imap_host, smtp_host, imap_port: String(imap_port), smtp_port: String(smtp_port) } };
  }
  const { saveMailbox } = await import("@/lib/channels/mailbox-save");
  const saved = await saveMailbox({ orgId: ctx.org.id, userId: ctx.userId, config: cfg, secrets: { password: v.password }, uidValidity: check.uid_validity, lastUid: check.last_uid });
  if (!saved.ok) return { error: "errors.generic", values };
  revalidatePath(`/${locale}/integrations`);
  revalidatePath(`/${locale}/inbox`);
  return { ok: true, message: "integrations.mail.connected" };
}

/** Disconnect for the wave-6 channels (e-mail, WhatsApp QR); the original action keeps serving the others. */
export async function disconnectChannelV2Action(fd: FormData): Promise<ActionState> {
  const locale = formLocale(fd);
  const ctx = await getOrgContext(locale);
  if (!ctx.can("integrations.manage")) return { error: "errors.forbidden" };
  const kind = str(fd, "kind");
  if (!["email", "whatsapp_qr", "telegram_user"].includes(kind)) return { error: "validation.invalidId" };
  const supabase = await createClient();
  const { data: acc } = await supabase.from("channel_accounts").select("id").eq("organization_id", ctx.org.id).eq("kind", kind).maybeSingle();
  if (kind === "whatsapp_qr" && acc) {
    const { bridgeLogout } = await import("@/lib/channels/wa-bridge");
    await bridgeLogout(acc.id as string).catch(() => {});
  }
  if (kind === "telegram_user" && acc) {
    const { tgUserLogout } = await import("@/lib/channels/tg-user");
    await tgUserLogout(acc.id as string).catch(() => {});
  }
  const { error } = await supabase.from("channel_accounts").delete().eq("organization_id", ctx.org.id).eq("kind", kind);
  if (error) return { error: dbErrorKey(error) };
  revalidatePath(`/${locale}/integrations`);
  return { ok: true, message: "integrations.channels.disconnected" };
}

const embeddedSchema = z.object({
  code: z.string().trim().min(10).max(2000),
  phoneNumberId: z.string().trim().regex(/^\d{5,30}$/),
  wabaId: z.string().trim().regex(/^\d{5,30}$/),
});

/** Official WhatsApp — finishes Meta Embedded Signup (the popup returned a code + the chosen number). */
export async function connectWhatsAppEmbeddedAction(input: { locale: string; code: string; phoneNumberId: string; wabaId: string }): Promise<ActionState> {
  const locale = input.locale === "ar" || input.locale === "en" ? input.locale : "he";
  const ctx = await getOrgContext(locale);
  if (!ctx.can("integrations.manage")) return { error: "errors.forbidden" };
  const parsed = embeddedSchema.safeParse(input);
  if (!parsed.success) return { error: "integrations.whatsapp.signupIncomplete" };
  const { encryptionReady, sealSecrets } = await import("@/lib/channels/secrets");
  if (!encryptionReady()) return { error: "integrations.channels.encryptionMissing" };
  const { completeEmbeddedSignup } = await import("@/lib/channels/meta");
  const done = await completeEmbeddedSignup(parsed.data);
  if (!done.ok || !done.accessToken || !done.config) return { error: "integrations.whatsapp.signupFailed", messageParams: { detail: `${done.step ?? ""} ${done.error ?? ""}`.trim() } };
  const supabase = await createClient();
  const row = {
    config: done.config,
    secret_enc: sealSecrets({ access_token: done.accessToken, app_secret: process.env.META_APP_SECRET ?? "" }),
    status: "active",
    last_error: done.warning ? `register: ${done.warning}`.slice(0, 500) : null,
    name: done.config.verified_name || done.config.display_phone_number || "WhatsApp",
    updated_at: new Date().toISOString(),
  };
  const { data: existing } = await supabase.from("channel_accounts").select("id").eq("organization_id", ctx.org.id).eq("kind", "whatsapp").maybeSingle();
  const { error } = existing
    ? await supabase.from("channel_accounts").update(row).eq("id", existing.id).eq("organization_id", ctx.org.id)
    : await supabase.from("channel_accounts").insert({ ...row, organization_id: ctx.org.id, kind: "whatsapp", created_by: ctx.userId });
  if (error) return { error: dbErrorKey(error) };
  revalidatePath(`/${locale}/integrations`);
  revalidatePath(`/${locale}/inbox`);
  return { ok: true, message: "integrations.channels.connected" };
}

export interface QrState {
  status: "starting" | "qr" | "connected" | "logged_out" | "error" | "unknown" | "not_configured";
  qr?: string | null;
  phone?: string | null;
  error?: string | null;
}

/** WhatsApp by QR — opens a session on the bridge and returns the QR to scan. */
export async function startWhatsAppQrAction(input: { locale: string }): Promise<QrState> {
  const locale = input.locale === "ar" || input.locale === "en" ? input.locale : "he";
  const ctx = await getOrgContext(locale);
  if (!ctx.can("integrations.manage")) return { status: "error", error: "errors.forbidden" };
  const { bridgeConfigured, bridgeStart } = await import("@/lib/channels/wa-bridge");
  if (!bridgeConfigured()) return { status: "not_configured" };
  const supabase = await createClient();
  let { data: acc } = await supabase.from("channel_accounts").select("id, webhook_token").eq("organization_id", ctx.org.id).eq("kind", "whatsapp_qr").maybeSingle();
  if (!acc) {
    const { data, error } = await supabase
      .from("channel_accounts")
      .insert({ organization_id: ctx.org.id, kind: "whatsapp_qr", name: "WhatsApp", status: "active", config: { state: "starting" }, created_by: ctx.userId })
      .select("id, webhook_token")
      .single();
    if (error || !data) return { status: "error", error: error ? dbErrorKey(error) : "errors.generic" };
    acc = data;
  }
  const st = await bridgeStart(acc.id as string, acc.webhook_token as string);
  return { status: st.status, qr: st.qr ?? null, phone: st.phone ?? null, error: st.error ?? null };
}

export async function whatsAppQrStatusAction(input: { locale: string }): Promise<QrState> {
  const locale = input.locale === "ar" || input.locale === "en" ? input.locale : "he";
  const ctx = await getOrgContext(locale);
  if (!ctx.can("integrations.manage")) return { status: "error", error: "errors.forbidden" };
  const { bridgeConfigured, bridgeStatus } = await import("@/lib/channels/wa-bridge");
  if (!bridgeConfigured()) return { status: "not_configured" };
  const supabase = await createClient();
  const { data: acc } = await supabase.from("channel_accounts").select("id, config").eq("organization_id", ctx.org.id).eq("kind", "whatsapp_qr").maybeSingle();
  if (!acc) return { status: "unknown" };
  const st = await bridgeStatus(acc.id as string);
  if (st.status === "connected") revalidatePath(`/${locale}/integrations`);
  return { status: st.status, qr: st.qr ?? null, phone: st.phone ?? null, error: st.error ?? null };
}

/* ------------------------------------- wave 8: Telegram personal account ---- */

export interface TgUserState {
  status: "starting" | "qr" | "password" | "connected" | "error" | "unknown" | "not_configured";
  qr?: string | null;
  hint?: string | null;
  phone?: string | null;
  error?: string | null;
}

async function tgUserAccount(orgId: string, userId: string, create: boolean) {
  const supabase = await createClient();
  const { data: acc } = await supabase.from("channel_accounts").select("id, webhook_token").eq("organization_id", orgId).eq("kind", "telegram_user").maybeSingle();
  if (acc || !create) return acc as { id: string; webhook_token: string } | null;
  const { data } = await supabase
    .from("channel_accounts")
    .insert({ organization_id: orgId, kind: "telegram_user", name: "Telegram", status: "active", config: { state: "starting" }, created_by: userId })
    .select("id, webhook_token")
    .single();
  return (data as { id: string; webhook_token: string } | null) ?? null;
}

/** Telegram personal account — opens a login session on the bridge and returns the QR to scan. */
export async function startTelegramUserAction(input: { locale: string }): Promise<TgUserState> {
  const locale = input.locale === "ar" || input.locale === "en" ? input.locale : "he";
  const ctx = await getOrgContext(locale);
  if (!ctx.can("integrations.manage")) return { status: "error", error: "errors.forbidden" };
  const { tgUserConfigured, tgUserStart } = await import("@/lib/channels/tg-user");
  if (!tgUserConfigured()) return { status: "not_configured" };
  const acc = await tgUserAccount(ctx.org.id, ctx.userId, true);
  if (!acc) return { status: "error", error: "errors.generic" };
  const st = await tgUserStart(acc.id, acc.webhook_token);
  return { status: st.status, qr: st.qr ?? null, hint: st.hint ?? null, phone: st.phone ?? null, error: st.error ?? null };
}

export async function telegramUserStatusAction(input: { locale: string }): Promise<TgUserState> {
  const locale = input.locale === "ar" || input.locale === "en" ? input.locale : "he";
  const ctx = await getOrgContext(locale);
  if (!ctx.can("integrations.manage")) return { status: "error", error: "errors.forbidden" };
  const { tgUserConfigured, tgUserStatus } = await import("@/lib/channels/tg-user");
  if (!tgUserConfigured()) return { status: "not_configured" };
  const acc = await tgUserAccount(ctx.org.id, ctx.userId, false);
  if (!acc) return { status: "unknown" };
  const st = await tgUserStatus(acc.id);
  if (st.status === "connected") revalidatePath(`/${locale}/integrations`);
  return { status: st.status, qr: st.qr ?? null, hint: st.hint ?? null, phone: st.phone ?? null, error: st.error ?? null };
}

/** The account has two-step verification: forward the password to the login session (never stored). */
export async function telegramUserPasswordAction(input: { locale: string; password: string }): Promise<TgUserState> {
  const locale = input.locale === "ar" || input.locale === "en" ? input.locale : "he";
  const ctx = await getOrgContext(locale);
  if (!ctx.can("integrations.manage")) return { status: "error", error: "errors.forbidden" };
  const pw = String(input.password ?? "").slice(0, 256);
  if (!pw) return { status: "password" };
  const { tgUserPassword } = await import("@/lib/channels/tg-user");
  const acc = await tgUserAccount(ctx.org.id, ctx.userId, false);
  if (!acc) return { status: "unknown" };
  const st = await tgUserPassword(acc.id, pw);
  return { status: st.status, error: st.error ?? null };
}

/* ---------------------------------------- wave 10: team updates (who gets the agent's conversations) ---- */

const recipientSchema = z.object({
  kind: z.enum(["email", "telegram", "whatsapp", "sms"]),
  target: z.string().trim().max(200).optional().default(""),
  label: z.string().trim().max(80).optional().default(""),
  events: z.array(z.enum(["messages", "leads", "handoff"])).min(1),
});

/** Adds a person who gets updates. Telegram → an invite link they open in the business's bot. */
export async function addRecipientAction(input: { locale: string; kind: string; target?: string; label?: string; events: string[] }): Promise<ActionState<{ invite?: string }>> {
  const ctx = await getOrgContext(input.locale === "en" || input.locale === "ar" ? input.locale : "he");
  if (!ctx.can("integrations.manage")) return { error: "errors.forbidden" };
  const p = recipientSchema.safeParse(input);
  if (!p.success) return { error: "notify.invalid" };
  const { normalizeTarget, newInviteCode } = await import("@/lib/notify/format");
  const supabase = await createClient();
  let target: string | null = null;
  let invite: string | null = null;
  if (p.data.kind === "telegram") {
    const { data: bot } = await supabase.from("channel_accounts").select("config").eq("organization_id", ctx.org.id).eq("kind", "telegram").maybeSingle();
    if (!bot) return { error: "notify.needBot" };
    invite = newInviteCode();
  } else {
    target = normalizeTarget(p.data.kind, p.data.target);
    if (!target) return { error: p.data.kind === "email" ? "notify.badEmail" : "notify.badPhone" };
  }
  const { error } = await supabase.from("notify_recipients").insert({
    organization_id: ctx.org.id,
    kind: p.data.kind,
    target,
    label: p.data.label || null,
    events: p.data.events,
    invite_code: invite,
    verified_at: target ? new Date().toISOString() : null,
    created_by: ctx.userId,
  });
  if (error) return { error: error.message.includes("plan_limit:notify_recipients") ? "notify.tooMany" : dbErrorKey(error) };
  revalidatePath(`/${input.locale}/integrations`);
  return { ok: true, message: "notify.added", data: invite ? { invite } : {} };
}

export async function updateRecipientAction(input: { locale: string; id: string; enabled?: boolean; events?: string[] }): Promise<ActionState> {
  const ctx = await getOrgContext(input.locale === "en" || input.locale === "ar" ? input.locale : "he");
  if (!ctx.can("integrations.manage")) return { error: "errors.forbidden" };
  if (!uuidSchema.safeParse(input.id).success) return { error: "validation.invalidId" };
  const patch: Record<string, unknown> = {};
  if (typeof input.enabled === "boolean") patch.enabled = input.enabled;
  if (input.events) {
    const ev = z.array(z.enum(["messages", "leads", "handoff"])).min(1).safeParse(input.events);
    if (!ev.success) return { error: "notify.invalid" };
    patch.events = ev.data;
  }
  const supabase = await createClient();
  const { error } = await supabase.from("notify_recipients").update(patch).eq("id", input.id).eq("organization_id", ctx.org.id);
  if (error) return { error: dbErrorKey(error) };
  revalidatePath(`/${input.locale}/integrations`);
  return { ok: true };
}

export async function deleteRecipientAction(input: { locale: string; id: string }): Promise<ActionState> {
  const ctx = await getOrgContext(input.locale === "en" || input.locale === "ar" ? input.locale : "he");
  if (!ctx.can("integrations.manage")) return { error: "errors.forbidden" };
  if (!uuidSchema.safeParse(input.id).success) return { error: "validation.invalidId" };
  const supabase = await createClient();
  const { error } = await supabase.from("notify_recipients").delete().eq("id", input.id).eq("organization_id", ctx.org.id);
  if (error) return { error: dbErrorKey(error) };
  revalidatePath(`/${input.locale}/integrations`);
  return { ok: true };
}

/** Sends a sample update to one recipient right now. */
export async function testRecipientAction(input: { locale: string; id: string }): Promise<ActionState> {
  const ctx = await getOrgContext(input.locale === "en" || input.locale === "ar" ? input.locale : "he");
  if (!ctx.can("integrations.manage")) return { error: "errors.forbidden" };
  if (!uuidSchema.safeParse(input.id).success) return { error: "validation.invalidId" };
  const supabase = await createClient();
  const { data: r } = await supabase.from("notify_recipients").select("id, kind, target, label, events").eq("id", input.id).eq("organization_id", ctx.org.id).maybeSingle();
  if (!r) return { error: "errors.notFound" };
  if (!r.target) return { error: "notify.notLinked" };
  const { sendToRecipient, inboxLink } = await import("@/lib/notify/forward");
  const res = await sendToRecipient(ctx.org.id, r as never, "leads", {
    orgName: ctx.org.name,
    channel: "telegram",
    customer: "לקוח לדוגמה",
    lead: { name: "דנה כהן", phone: "050-1234567", need: "בדיקת עדכונים", score: "hot", summary: "זו הודעת בדיקה: ככה ייראו העדכונים שלכם." },
    link: inboxLink(null),
  });
  const { createAdminClient } = await import("@/lib/supabase/admin");
  await createAdminClient()
    .from("notify_recipients")
    .update(res.ok ? { last_sent_at: new Date().toISOString(), last_error: null } : { last_error: (res.error ?? "failed").slice(0, 300) })
    .eq("id", r.id);
  revalidatePath(`/${input.locale}/integrations`);
  return res.ok ? { ok: true, message: "notify.testSent" } : { error: "notify.testFailed", messageParams: { detail: res.error ?? "" } };
}

/** Telegram Business: give the agent back a chat the owner took over / stop it in one chat — via inbox ai-mode (existing). */
