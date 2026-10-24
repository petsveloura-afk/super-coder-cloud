import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadAccountByToken } from "./accounts";
import { telegramCall } from "./providers";
import { isStopUpdates, parseNotifyStart } from "@/lib/notify/format";

/**
 * Telegram Business — the business owner adds the bot as a chatbot to his own
 * Telegram account (Settings → Telegram Business → Chatbots). Customers who write
 * to the owner arrive as `business_message` with a `business_connection_id`;
 * every reply must carry that id (otherwise it would go from the bot itself).
 *   • business_connection → saved (owner, rights, enabled) and shown in the hub
 *   • customer message → conversation "biz:<chat>" → the AI agent answers
 *   • a message the owner typed himself → recorded, and the agent steps back in that chat
 *   • messages the bot sent (sender_business_bot) and deletions are ignored
 */

interface TgUser {
  id: number;
  is_bot?: boolean;
  first_name?: string;
  last_name?: string;
  username?: string;
}
export interface TgBusinessConnection {
  id: string;
  user: TgUser;
  user_chat_id?: number;
  date?: number;
  is_enabled?: boolean;
  can_reply?: boolean;
  rights?: { can_reply?: boolean; can_read_messages?: boolean; [k: string]: unknown };
}
export interface TgBusinessMessage {
  message_id: number;
  business_connection_id?: string;
  chat: { id: number; type: string; first_name?: string; last_name?: string; username?: string };
  from?: TgUser;
  sender_business_bot?: TgUser;
  text?: string;
  caption?: string;
  photo?: { file_id?: string; file_size?: number }[];
  document?: { file_name?: string; file_id?: string; mime_type?: string };
  voice?: { file_id?: string; mime_type?: string; duration?: number };
  /** wave 22: music / audio files */
  audio?: { file_id?: string; mime_type?: string; file_name?: string };
  sticker?: { emoji?: string };
  contact?: { phone_number?: string };
  location?: { latitude: number; longitude: number };
}

const fullName = (u?: { first_name?: string; last_name?: string; username?: string } | null) => [u?.first_name, u?.last_name].filter(Boolean).join(" ") || u?.username || null;

export async function handleTelegramBusiness(
  token: string,
  update: { business_connection?: TgBusinessConnection; business_message?: TgBusinessMessage; edited_business_message?: TgBusinessMessage; deleted_business_messages?: unknown },
): Promise<void> {
  const admin = createAdminClient();
  const bc = update.business_connection;
  if (bc) {
    const canReply = Boolean(bc.rights ? bc.rights.can_reply : bc.can_reply);
    const { data } = await admin.rpc("upsert_telegram_business_connection", {
      p_token: token,
      p_id: bc.id,
      p_owner_id: bc.user.id,
      p_owner_chat: bc.user_chat_id ?? bc.user.id,
      p_owner_name: fullName(bc.user),
      p_owner_username: bc.user.username ?? null,
      p_can_reply: canReply,
      p_enabled: bc.is_enabled !== false,
      p_rights: bc.rights ?? (bc.can_reply !== undefined ? { can_reply: bc.can_reply } : {}),
    });
    // tell the owner, in his chat with the bot, that it works (or what's missing)
    const acc = await loadAccountByToken("telegram", token);
    if (acc?.secrets.bot_token && (bc.user_chat_id ?? bc.user.id)) {
      const text =
        bc.is_enabled === false
          ? "🔌 הבוט נותק מחשבון הטלגרם העסקי שלך. כדי לחבר מחדש: הגדרות ← Telegram Business ← צ׳אטבוטים."
          : canReply
            ? "✅ הסוכן מחובר לחשבון הטלגרם שלך ועונה ללקוחות בשמך.\nכשתכתוב בעצמך בצ׳אט, הסוכן יעצור באותה שיחה. אפשר להחזיר אותו מתיבת ההודעות במערכת."
            : "⚠️ הבוט מחובר, אבל אין לו הרשאה להשיב. בטלגרם: הגדרות ← Telegram Business ← צ׳אטבוטים ← סמנו 'ניהול הודעות' / 'Reply to messages'.";
      if ((data as { new?: boolean } | null)?.new !== false || bc.is_enabled === false) await telegramCall(acc.secrets.bot_token, "sendMessage", { chat_id: bc.user_chat_id ?? bc.user.id, text }).catch(() => undefined);
    }
    return;
  }

  const m = update.business_message;
  if (!m || !m.business_connection_id) return; // edits / deletions: acknowledged, nothing to answer
  if (m.sender_business_bot) return; // our own replies echoed back
  if (m.chat.type !== "private") return;

  const { data: conn } = await admin.from("telegram_business_connections").select("owner_user_id, is_enabled, can_reply").eq("id", m.business_connection_id).maybeSingle();
  const fromOwner = Boolean(conn && m.from && Number(conn.owner_user_id) === m.from.id);

  let text = m.text ?? m.caption ?? "";
  let media: Record<string, unknown> | null = null;
  if (!text && m.contact?.phone_number) text = `📞 ${m.contact.phone_number}`;
  if (!text && m.sticker?.emoji) text = m.sticker.emoji;
  // wave 22: keep Telegram's file id so the agent can hear voice notes and see pictures / documents
  if (m.photo) media = { type: "photo", ...(m.photo.at(-1)?.file_id ? { file_id: m.photo.at(-1)!.file_id } : {}) };
  else if (m.document) media = { type: "document", name: m.document.file_name, ...(m.document.file_id ? { file_id: m.document.file_id } : {}), ...(m.document.mime_type ? { mime: m.document.mime_type } : {}) };
  else if (m.voice) media = { type: "voice", ...(m.voice.file_id ? { file_id: m.voice.file_id } : {}), mime: m.voice.mime_type ?? "audio/ogg" };
  else if (m.audio) media = { type: "audio", name: m.audio.file_name, ...(m.audio.file_id ? { file_id: m.audio.file_id } : {}), mime: m.audio.mime_type ?? "audio/mpeg" };
  else if (m.location) {
    media = { type: "location", lat: m.location.latitude, lng: m.location.longitude };
    text ||= `📍 ${m.location.latitude},${m.location.longitude}`;
  }

  const { data, error } = await admin.rpc("ingest_telegram_business", {
    p_token: token,
    p_connection: m.business_connection_id,
    p_chat: m.chat.id,
    p_sender_name: fromOwner ? null : fullName(m.from ?? m.chat),
    p_text: text,
    p_message: `b${m.message_id}`,
    p_media: media,
    p_from_owner: fromOwner,
  });
  if (error) {
    console.error("telegram business ingest failed", error.message);
    return;
  }
  const r = (data ?? {}) as { ok?: boolean; duplicate?: boolean; conversation_id?: string; message_id?: string; owner?: boolean; can_reply?: boolean };
  // wave 22: a voice note / picture / PDF from the customer → transcript / description first, then the agent answers
  if (r.ok && !r.duplicate && !r.owner && r.conversation_id && r.message_id && media && !(conn && (!conn.is_enabled || !conn.can_reply))) {
    const { mediaUnderstandable } = await import("@/lib/ai/inbound-media");
    if (mediaUnderstandable(media as never)) {
      const { understandInboundMedia } = await import("@/lib/ai/inbound-media");
      const heard = await understandInboundMedia({ kind: "telegram", token, conversationId: r.conversation_id, messageId: r.message_id, media: media as never, caption: text });
      // wave 22: could not hear / open it → a marker, and the agent still answers (asks to type)
      const answerable = Boolean(heard || text.trim()) || (await import("@/lib/ai/inbound-media").then((x) => x.markUnreadableMedia(r.conversation_id!, r.message_id!, (media as { type?: string }).type)));
      if (answerable) {
        const { scheduleAutopilot } = await import("@/lib/ai/autopilot");
        await scheduleAutopilot({ conversationId: r.conversation_id, messageId: r.message_id, debounceMs: 1500 });
      }
      return;
    }
  }
  if (!r.ok || r.duplicate || r.owner || !r.conversation_id || !text.trim()) return;
  if (conn && (!conn.is_enabled || !conn.can_reply)) return; // no permission to answer — kept in the inbox for the team
  const { scheduleAutopilot } = await import("@/lib/ai/autopilot");
  await scheduleAutopilot({ conversationId: r.conversation_id, messageId: r.message_id ?? null, debounceMs: 2500 });
}

/** Team-update invites (/start n_<code>) and /stop_updates in the business's bot. Returns true when handled. */
export async function handleTelegramSpecial(token: string, msg: { chat: { id: number; type: string }; from?: TgUser; text?: string }): Promise<boolean> {
  if (msg.chat.type !== "private") return false;
  const code = parseNotifyStart(msg.text);
  const stop = isStopUpdates(msg.text);
  if (!code && !stop) return false;
  const admin = createAdminClient();
  const acc = await loadAccountByToken("telegram", token);
  if (!acc?.secrets.bot_token) return false;
  if (code) {
    const { data } = await admin.rpc("link_notify_recipient", { p_token: token, p_code: code, p_chat: String(msg.chat.id), p_name: fullName(msg.from) });
    const r = (data ?? {}) as { ok?: boolean; org_name?: string };
    await telegramCall(acc.secrets.bot_token, "sendMessage", {
      chat_id: msg.chat.id,
      text: r.ok
        ? `✅ מחובר! מעכשיו יגיעו לכאן העדכונים של ${r.org_name ?? "העסק"}: לידים חדשים, שיחות שהסוכן מנהל ובקשות לנציג.\nכדי להפסיק: /stop_updates`
        : "⚠️ הקישור לא תקף או שכבר נוצל. בקשו קישור חדש ממנהל המערכת.",
    });
    return true;
  }
  const { data: n } = await admin.rpc("unlink_notify_recipient", { p_token: token, p_chat: String(msg.chat.id) });
  await telegramCall(acc.secrets.bot_token, "sendMessage", { chat_id: msg.chat.id, text: Number(n ?? 0) > 0 ? "🔕 העדכונים הופסקו." : "לא נמצאו עדכונים פעילים לצ׳אט הזה." });
  return true;
}
