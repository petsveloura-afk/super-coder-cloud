import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadAccount, markAccountError, type Kind } from "./accounts";
import { telegramCall, twilioSendSms, whatsappSendText, type ProviderResult } from "./providers";
import { toE164 } from "./secrets";

export interface SendOutcome {
  ok: boolean;
  messageId?: string;
  error?: string;
  status?: number;
  permanent?: boolean;
}

async function providerSend(kind: Kind | "web", orgId: string, externalId: string, text: string, conversationId?: string): Promise<ProviderResult & { accountId?: string }> {
  // website chat: the visitor's browser reads the message from the conversation — nothing to deliver
  if (kind === "web") return { ok: true };
  const acc = await loadAccount(orgId, kind);
  if (!acc) return { ok: false, error: "channel_not_connected", permanent: true };
  let r: ProviderResult;
  if (kind === "email") {
    const { sendEmailReply } = await import("./email");
    r = await sendEmailReply(acc, externalId, text, conversationId);
  } else if (kind === "whatsapp_qr") {
    const { bridgeSend } = await import("./wa-bridge");
    r = await bridgeSend(acc, externalId, text);
  } else if (kind === "telegram") {
    r = await telegramCall(acc.secrets.bot_token ?? "", "sendMessage", { chat_id: externalId, text });
  } else if (kind === "whatsapp") {
    r = await whatsappSendText(acc.secrets.access_token ?? "", acc.config.phone_number_id ?? "", `+${externalId.replace(/^\+/, "")}`, text);
  } else {
    r = await twilioSendSms(acc.config.account_sid ?? "", acc.secrets.auth_token ?? "", acc.config.from_number ?? "", externalId, text);
  }
  if (!r.ok && (r.status === 401 || r.status === 403)) await markAccountError(acc.id, r.error ?? "unauthorized");
  return { ...r, accountId: acc.id };
}

/**
 * Sends a text into an existing conversation: stores the outgoing message
 * (queued → sent/failed) and updates the conversation preview.
 */
export async function sendToConversation(orgId: string, conversationId: string, text: string, sentBy?: string, opts?: { aiAgentId?: string | null; meta?: Record<string, unknown> }): Promise<SendOutcome> {
  const admin = createAdminClient();
  const { data: conv } = await admin.from("conversations").select("id, channel, external_id").eq("id", conversationId).eq("organization_id", orgId).maybeSingle();
  if (!conv) return { ok: false, error: "not_found", permanent: true };
  const body = text.slice(0, 4000);
  const { data: msg, error } = await admin
    .from("messages")
    .insert({
      organization_id: orgId,
      conversation_id: conv.id,
      direction: "out",
      body,
      status: "queued",
      sent_by: sentBy ?? null,
      ...(opts?.aiAgentId ? { ai_agent_id: opts.aiAgentId } : {}),
      ...(opts?.meta ? { meta: opts.meta } : {}),
    })
    .select("id")
    .single();
  if (error || !msg) return { ok: false, error: "store_failed" };
  const r = await providerSend(conv.channel as Kind | "web", orgId, conv.external_id as string, body, conv.id as string);
  await admin
    .from("messages")
    .update({ status: r.ok ? "sent" : "failed", external_id: r.externalId ?? null, error: r.ok ? null : (r.error ?? "send_failed").slice(0, 500) })
    .eq("id", msg.id);
  await admin
    .from("conversations")
    .update({ last_message_at: new Date().toISOString(), last_message_preview: body.slice(0, 200) })
    .eq("id", conv.id);
  return { ok: r.ok, messageId: msg.id as string, error: r.error, status: r.status, permanent: r.permanent };
}

/** Automations: reach a contact on a channel, opening the conversation when needed. */
export async function sendToContact(kind: Kind, orgId: string, contactId: string, text: string): Promise<SendOutcome> {
  const admin = createAdminClient();
  const { data: existing } = await admin
    .from("conversations")
    .select("id")
    .eq("organization_id", orgId)
    .eq("contact_id", contactId)
    .eq("channel", kind)
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();
  if (existing) return sendToConversation(orgId, existing.id as string, text);

  const { data: contact } = await admin.from("contacts").select("id, first_name, last_name, phone, email, custom_fields").eq("id", contactId).eq("organization_id", orgId).maybeSingle();
  if (!contact) return { ok: false, error: "contact_not_found", permanent: true };
  let externalId: string | null = null;
  if (kind === "telegram") externalId = ((contact.custom_fields as Record<string, string> | null)?.telegram_id as string | undefined) ?? null;
  else if (kind === "email") externalId = ((contact.email as string | null) ?? "").toLowerCase() || null;
  else {
    const e164 = toE164(contact.phone as string | null);
    externalId = e164 ? (kind === "whatsapp" || kind === "whatsapp_qr" ? e164.slice(1) : e164) : null;
  }
  if (!externalId) return { ok: false, error: kind === "telegram" ? "contact_has_no_telegram_chat" : kind === "email" ? "contact_has_no_email" : "contact_has_no_phone", permanent: true };
  const { data: conv, error } = await admin
    .from("conversations")
    .upsert(
      { organization_id: orgId, channel: kind, external_id: externalId, contact_id: contactId, title: `${contact.first_name} ${contact.last_name}`.trim() },
      { onConflict: "organization_id,channel,external_id" },
    )
    .select("id")
    .single();
  if (error || !conv) return { ok: false, error: "conversation_failed" };
  return sendToConversation(orgId, conv.id as string, text);
}
