import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { kickJobs } from "@/lib/jobs/kick";

export interface InboundMessage {
  kind: "whatsapp" | "telegram" | "sms" | "whatsapp_qr" | "email" | "telegram_user" | "messenger" | "instagram";
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
  // wave 16: file bytes (voice notes / images from the bridge) are never stored in the database
  const { mediaForStorage } = await import("@/lib/ai/inbound-media");
  const mediaRef = m.media ?? null;
  m = { ...m, media: mediaForStorage(m.media) };
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
    // conversation guard: STOP / START words — confirm once, never answer them with the AI
    if (r.ok && !r.duplicate && r.conversation_id && privateChat) {
      const { isOptInText, isOptOutText } = await import("@/lib/conversations/guard-core");
      if (r.message_id && (isOptOutText(m.text) || isOptInText(m.text))) {
        const { confirmOptChange } = await import("@/lib/conversations/scheduler");
        const handled = await confirmOptChange(r.conversation_id, r.message_id).catch((e) => {
          console.error("opt confirmation failed", (e as Error).message);
          return false;
        });
        if (handled) return { data, error };
      }
    }
    // wave 16: a voice note / picture → transcript / description first, then the agent answers it
    const { mediaUnderstandable } = await import("@/lib/ai/inbound-media");
    if (r.ok && !r.duplicate && r.conversation_id && r.message_id && mediaRef && mediaUnderstandable(mediaRef as never)) {
      const job = async () => {
        const { understandInboundMedia } = await import("@/lib/ai/inbound-media");
        const text = await understandInboundMedia({ kind: m.kind, token: m.token, conversationId: r.conversation_id!, messageId: r.message_id!, media: mediaRef as never, caption: m.text ?? "" });
        // wave 22: could not hear / open it → a marker, and the agent still answers (asks to type)
        const answerable = Boolean(text || (m.text ?? "").trim()) || (privateChat && m.autoReply !== false && (await import("@/lib/ai/inbound-media").then((x) => x.markUnreadableMedia(r.conversation_id!, r.message_id!, (mediaRef as { type?: string }).type))));
        if (answerable && privateChat && m.autoReply !== false) {
          const { handleInboundWithAI, forwardAfterAutopilot } = await import("@/lib/ai/autopilot");
          const res = await handleInboundWithAI({ conversationId: r.conversation_id!, messageId: r.message_id ?? null, debounceMs: 1500 });
          await forwardAfterAutopilot(r.conversation_id!, res);
        }
      };
      try {
        const { after } = await import("next/server");
        after(() => job().catch((e) => console.error("media job failed", (e as Error).message)));
      } catch {
        await job().catch((e) => console.error("media job failed", (e as Error).message));
      }
      return { data, error };
    }
    // wave 22: a voice note / picture whose file never arrived (too big, download failed) → the agent still answers
    if (r.ok && !r.duplicate && r.conversation_id && r.message_id && privateChat && m.autoReply !== false && !(m.text ?? "").trim() && mediaRef) {
      const t = (mediaRef as { type?: string }).type;
      const { isAudio, isImage, markUnreadableMedia } = await import("@/lib/ai/inbound-media");
      if ((isAudio(t) || isImage(t) || t === "document") && (await markUnreadableMedia(r.conversation_id, r.message_id, t))) {
        const { scheduleAutopilot } = await import("@/lib/ai/autopilot");
        await scheduleAutopilot({ conversationId: r.conversation_id, messageId: r.message_id, debounceMs: 2500 });
      }
      return { data, error };
    }
    if (r.ok && !r.duplicate && r.conversation_id && privateChat && m.autoReply !== false && (m.text ?? "").trim()) {
      const { scheduleAutopilot } = await import("@/lib/ai/autopilot");
      await scheduleAutopilot({ conversationId: r.conversation_id, messageId: r.message_id ?? null, debounceMs: m.kind === "email" ? 0 : 2500 });
    }
  }
  return { data, error };
}
