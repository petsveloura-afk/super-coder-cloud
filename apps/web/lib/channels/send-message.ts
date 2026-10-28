import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadAccount, markAccountError, type Kind } from "./accounts";
import { telegramCall, twilioSendSms, whatsappSendButtons, whatsappSendImage, whatsappSendText, type ProviderResult } from "./providers";
import { toE164 } from "./secrets";

export interface SendOutcome {
  ok: boolean;
  messageId?: string;
  error?: string;
  status?: number;
  permanent?: boolean;
}

/** Optional rich parts of a message (AI agent replies): quick-reply buttons, "share phone", HTML formatting. */
export interface RichMessage {
  buttons?: string[];
  askPhone?: boolean;
  askPhoneLabel?: string;
  html?: boolean;
  /** persistent menu keyboard (Telegram), 2 buttons per row */
  menu?: string[];
}

async function providerSend(kind: Kind | "web", orgId: string, externalId: string, text: string, conversationId?: string, rich?: RichMessage): Promise<ProviderResult & { accountId?: string }> {
  // website chat: the visitor's browser reads the message from the conversation — nothing to deliver
  if (kind === "web") return { ok: true };
  const acc = await loadAccount(orgId, kind);
  if (!acc) return { ok: false, error: "channel_not_connected", permanent: true };
  let r: ProviderResult;
  if (kind === "email") {
    const { sendEmailReply } = await import("./email");
    r = await sendEmailReply(acc, externalId, text, conversationId);
  } else if (kind === "telegram_user") {
    const { tgUserSend } = await import("./tg-user");
    const { buttonsAsText } = await import("@/lib/ai/autopilot-core");
    r = await tgUserSend(acc, externalId, rich?.buttons?.length ? buttonsAsText(text, rich.buttons) : text);
  } else if (kind === "whatsapp_qr") {
    const { bridgeSend } = await import("./wa-bridge");
    const { buttonsAsText } = await import("@/lib/ai/autopilot-core");
    r = await bridgeSend(acc, externalId, rich?.buttons?.length ? buttonsAsText(text, rich.buttons) : text);
  } else if (kind === "telegram" && externalId.startsWith("biz:")) {
    // wave 10: Telegram Business chat — reply on behalf of the owner's account (business_connection_id),
    // plain human-looking text (choices as a numbered list, no bot keyboards)
    const { telegramHtml, buttonsAsText } = await import("@/lib/ai/autopilot-core");
    const connection = await businessConnectionFor(orgId, externalId, conversationId);
    if (!connection) r = { ok: false, error: "business_connection_missing", permanent: true };
    else {
      const body = rich?.buttons?.length ? buttonsAsText(text, rich.buttons) : text;
      const chat_id = externalId.slice(4);
      r = await telegramCall(acc.secrets.bot_token ?? "", "sendMessage", { business_connection_id: connection, chat_id, text: rich?.html ? telegramHtml(body) : body, ...(rich?.html ? { parse_mode: "HTML" } : {}) });
      if (!r.ok && rich?.html && /parse|entit/i.test(r.error ?? "")) r = await telegramCall(acc.secrets.bot_token ?? "", "sendMessage", { business_connection_id: connection, chat_id, text: body });
    }
  } else if (kind === "telegram") {
    if (rich) {
      const { telegramHtml } = await import("@/lib/ai/autopilot-core");
      const menuRows = (rich.menu ?? []).reduce<{ text: string }[][]>((rows, b, i) => {
        if (i % 2 === 0) rows.push([{ text: b }]);
        else rows[rows.length - 1]!.push({ text: b });
        return rows;
      }, []);
      const reply_markup = rich.askPhone
        ? { keyboard: [[{ text: rich.askPhoneLabel || "📱", request_contact: true }]], resize_keyboard: true, one_time_keyboard: true }
        : menuRows.length
          ? { keyboard: menuRows, resize_keyboard: true, is_persistent: true }
          : rich.buttons?.length
          ? { keyboard: rich.buttons.map((b) => [{ text: b }]), resize_keyboard: true, one_time_keyboard: true }
          : { remove_keyboard: true };
      r = await telegramCall(acc.secrets.bot_token ?? "", "sendMessage", { chat_id: externalId, text: rich.html ? telegramHtml(text) : text, ...(rich.html ? { parse_mode: "HTML" } : {}), reply_markup, link_preview_options: { is_disabled: false } });
      // formatting rejected (should not happen): send plain text instead of failing
      if (!r.ok && rich.html && /parse|entit/i.test(r.error ?? "")) r = await telegramCall(acc.secrets.bot_token ?? "", "sendMessage", { chat_id: externalId, text, reply_markup });
    } else {
      r = await telegramCall(acc.secrets.bot_token ?? "", "sendMessage", { chat_id: externalId, text });
    }
  } else if (kind === "messenger" || kind === "instagram") {
    // wave 19: Facebook Messenger / Instagram Direct (Page token, quick-reply buttons, split to Meta's limits)
    const { metaSendText } = await import("./meta-pages");
    r = await metaSendText(kind, acc.secrets.page_token ?? "", externalId, text, { buttons: rich?.buttons });
  } else if (kind === "whatsapp") {
    r = rich?.buttons?.length
      ? await whatsappSendButtons(acc.secrets.access_token ?? "", acc.config.phone_number_id ?? "", `+${externalId.replace(/^\+/, "")}`, text, rich.buttons)
      : await whatsappSendText(acc.secrets.access_token ?? "", acc.config.phone_number_id ?? "", `+${externalId.replace(/^\+/, "")}`, text);
  } else {
    const { buttonsAsText } = await import("@/lib/ai/autopilot-core");
    r = await twilioSendSms(acc.config.account_sid ?? "", acc.secrets.auth_token ?? "", acc.config.from_number ?? "", externalId, rich?.buttons?.length ? buttonsAsText(text, rich.buttons) : text);
  }
  if (!r.ok && (r.status === 401 || r.status === 403)) await markAccountError(acc.id, r.error ?? "unauthorized");
  return { ...r, accountId: acc.id };
}

/**
 * Sends a text into an existing conversation: stores the outgoing message
 * (queued → sent/failed) and updates the conversation preview.
 */
export async function sendToConversation(orgId: string, conversationId: string, text: string, sentBy?: string, opts?: { aiAgentId?: string | null; meta?: Record<string, unknown>; rich?: RichMessage }): Promise<SendOutcome> {
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
  const r = await providerSend(conv.channel as Kind | "web", orgId, conv.external_id as string, body, conv.id as string, opts?.rich);
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
  // Meta channels cannot start a chat: the person must have messaged the page / account first (a conversation exists above)
  if (kind === "messenger" || kind === "instagram") return { ok: false, error: "contact_has_not_messaged_first", permanent: true };
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

/** Sends an image (agent gallery) into a conversation on any channel; text link where images aren't supported. */
export async function sendMediaToConversation(orgId: string, conversationId: string, item: { title: string; url: string; caption?: string }, opts?: { aiAgentId?: string | null }): Promise<SendOutcome> {
  const admin = createAdminClient();
  const { data: conv } = await admin.from("conversations").select("id, channel, external_id").eq("id", conversationId).eq("organization_id", orgId).maybeSingle();
  if (!conv) return { ok: false, error: "not_found", permanent: true };
  const caption = [item.caption || item.title].filter(Boolean).join("").slice(0, 900);
  const body = `${caption}\n${item.url}`.trim();
  const { data: msg } = await admin
    .from("messages")
    .insert({ organization_id: orgId, conversation_id: conv.id, direction: "out", body, status: "queued", ai_agent_id: opts?.aiAgentId ?? null, meta: { media: { type: "image", url: item.url, title: item.title } } })
    .select("id")
    .single();
  let r: ProviderResult = { ok: true };
  const channel = conv.channel as string;
  if (channel !== "web") {
    const acc = await loadAccount(orgId, channel as Kind);
    if (!acc) r = { ok: false, error: "channel_not_connected", permanent: true };
    else if (channel === "telegram" && String(conv.external_id).startsWith("biz:")) {
      const connection = await businessConnectionFor(orgId, String(conv.external_id), conv.id as string);
      r = connection
        ? await telegramCall(acc.secrets.bot_token ?? "", "sendPhoto", { business_connection_id: connection, chat_id: String(conv.external_id).slice(4), photo: item.url, caption })
        : { ok: false, error: "business_connection_missing", permanent: true };
    } else if (channel === "telegram") r = await telegramCall(acc.secrets.bot_token ?? "", "sendPhoto", { chat_id: conv.external_id, photo: item.url, caption });
    else if (channel === "whatsapp") r = await whatsappSendImage(acc.secrets.access_token ?? "", acc.config.phone_number_id ?? "", `+${String(conv.external_id).replace(/^\+/, "")}`, item.url, caption);
    else if (channel === "messenger" || channel === "instagram") {
      // wave 19: a real image in Messenger / Instagram, then the caption
      const { metaSendImage, metaSendText } = await import("./meta-pages");
      r = await metaSendImage(channel, acc.secrets.page_token ?? "", String(conv.external_id), item.url);
      if (r.ok && caption) await metaSendText(channel, acc.secrets.page_token ?? "", String(conv.external_id), caption);
    } else if (channel === "whatsapp_qr") {
      const { bridgeCall } = await import("./wa-bridge");
      const x = await bridgeCall(`/sessions/${acc.id}/send`, { method: "POST", body: { to: String(conv.external_id).replace(/[^\d]/g, ""), text: caption, image: item.url } });
      r = x.ok ? { ok: true } : { ok: false, error: String(x.data.error ?? "bridge") };
    } else r = await providerSend(channel as Kind, orgId, conv.external_id as string, body, conv.id as string);
  }
  if (msg) await admin.from("messages").update({ status: r.ok ? "sent" : "failed", error: r.ok ? null : (r.error ?? "send_failed").slice(0, 500), external_id: r.externalId ?? null }).eq("id", msg.id);
  await admin.from("conversations").update({ last_message_at: new Date().toISOString(), last_message_preview: `🖼️ ${item.title}`.slice(0, 200) }).eq("id", conv.id);
  return { ok: r.ok, messageId: msg?.id as string | undefined, error: r.error };
}

/** Telegram Business: the connection id of a "biz:<chat>" conversation. */
export async function businessConnectionFor(orgId: string, externalId: string, conversationId?: string | null): Promise<string | null> {
  const admin = createAdminClient();
  const q = admin.from("conversations").select("business_connection_id").eq("organization_id", orgId);
  const { data } = conversationId ? await q.eq("id", conversationId).maybeSingle() : await q.eq("channel", "telegram").eq("external_id", externalId).maybeSingle();
  return (data?.business_connection_id as string | null | undefined) ?? null;
}
