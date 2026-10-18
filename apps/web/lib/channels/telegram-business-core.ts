/**
 * Telegram Business connection health (pure, unit-tested).
 * The banner "Agent — bot paused / Start" inside the owner's chats exists only while the
 * business connection between the owner's Telegram account and the bot is alive. Telegram
 * ends it when the owner removes the bot, when Telegram Premium lapses, when the bot token
 * is revoked, or when the chat is excluded in Settings → Telegram Business → Chatbots.
 * Nothing in the platform can remove it — but the platform must never be silent about it.
 */
export interface BusinessLive {
  /** the Bot API answered */
  reachable: boolean;
  is_enabled?: boolean;
  can_reply?: boolean;
  /** Telegram description when the call failed, e.g. BUSINESS_CONNECTION_INVALID */
  error?: string;
}
export interface BusinessStored {
  is_enabled: boolean;
  can_reply: boolean;
}
export type BusinessVerdict = "ok" | "lost" | "no_reply_right" | "restored" | "unknown";

export function businessVerdict(stored: BusinessStored, live: BusinessLive): BusinessVerdict {
  if (!live.reachable) {
    // Telegram says the connection does not exist (any more)
    if (live.error && /BUSINESS_CONNECTION_INVALID|connection.*(not found|invalid)|BOT_ACCESS_FORBIDDEN/i.test(live.error)) return "lost";
    return "unknown"; // network / rate limit — never conclude anything from it
  }
  if (live.is_enabled === false) return stored.is_enabled ? "lost" : "ok";
  if (live.can_reply === false) return stored.can_reply ? "no_reply_right" : "ok";
  if (!stored.is_enabled || !stored.can_reply) return "restored";
  return "ok";
}

export function businessOwnerMessage(v: BusinessVerdict): string | null {
  if (v === "lost")
    return "🔌 החיבור של הסוכן לחשבון הטלגרם העסקי שלך נותק, ולכן הבאנר של הבוט נעלם מהשיחות.\nהסיבות הנפוצות: הבוט הוסר או הוחרג, מנוי Telegram Premium פג, או שהטוקן של הבוט הוחלף.\nלחיבור מחדש (כ-20 שניות): הגדרות ← Telegram Business ← צ׳אטבוטים ← בחר את הבוט ← \"ניהול הודעות\" ← כל הצ׳אטים הפרטיים.";
  if (v === "no_reply_right") return "⚠️ לבוט כבר אין הרשאה להשיב בשמך. הגדרות ← Telegram Business ← צ׳אטבוטים ← סמן \"ניהול הודעות\" (Reply to messages).";
  if (v === "restored") return "✅ החיבור חזר לפעול: הסוכן עונה ללקוחות בשמך.";
  return null;
}
