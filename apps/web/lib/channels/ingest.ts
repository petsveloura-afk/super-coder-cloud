import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { kickJobs } from "@/lib/jobs/kick";

export interface InboundMessage {
  kind: "whatsapp" | "telegram" | "sms" | "whatsapp_qr" | "email" | "telegram_user";
  token: string;
  chatId: string;
  senderName?: string | null;
  phone?: string | null;
  text: string;
  externalMessageId?: string | null;
  media?: Record<string, unknown> | null;
  /** e-mail only */
  email?: string | null;
  subject?: string | null;
  meta?: Record<string, unknown> | null;
  /** Telegram: "private" | "group" | "supergroup" | "channel" — the AI only answers private chats */
  chatType?: string | null;
  /** false = store only, never answer automatically (e.g. newsletters, bounces) */
  autoReply?: boolean;
}

/** Stores an inbound message via the SECURITY DEFINER RPC (matches/creates contact + conversation). */
export async function ingest(m: InboundMessage) {
  const admin = createAdminClient();
  const useV2 = m.kind === "whatsapp_qr" || m.kind === "email" || m.kind === "telegram_user";
  const { data, error } = useV2
    ? await admin.rpc("ingest_channel_message_v2", {
        p_token: m.token,
        p_kind: m.kind,
        p_external_chat: m.chatId,
        p_sender_name: m.senderName ?? null,
        p_phone: m.phone ?? null,
        p_email: m.email ?? null,
        p_text: m.text,
        p_external_message: m.externalMessageId ?? null,
        p_media: m.media ?? null,
        p_subject: m.subject ?? null,
        p_meta: m.meta ?? {},
      })
    : await admin.rpc("ingest_channel_message", {
        p_token: m.token,
        p_kind: m.kind,
        p_external_chat: m.chatId,
        p_sender_name: m.senderName ?? null,
        p_phone: m.phone ?? null,
        p_text: m.text,
        p_external_message: m.externalMessageId ?? null,
        p_media: m.media ?? null,
      });
  if (error) console.error(`${m.kind} ingest failed`, error.message);
  else {
    kickJobs();
    // AI autopilot: the business's agent answers the customer (when enabled for this channel)
    const r = (data ?? {}) as { ok?: boolean; duplicate?: boolean; conversation_id?: string; message_id?: string };
    const privateChat = !m.chatType || m.chatType === "private";
    if (r.ok && !r.duplicate && r.conversation_id && privateChat && m.autoReply !== false && (m.text ?? "").trim()) {
      const { scheduleAutopilot } = await import("@/lib/ai/autopilot");
      await scheduleAutopilot({ conversationId: r.conversation_id, messageId: r.message_id ?? null, debounceMs: m.kind === "email" ? 0 : 2500 });
    }
  }
  return { data, error };
}
