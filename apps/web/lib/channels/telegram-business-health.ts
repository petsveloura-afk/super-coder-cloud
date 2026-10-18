import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadAccount } from "./accounts";
import { telegramCall } from "./providers";
import { businessOwnerMessage, businessVerdict } from "./telegram-business-core";

let lastRun = 0;

/**
 * Cron: asks Telegram (getBusinessConnection) whether every saved business connection is still
 * alive, keeps our records in sync, and tells the owner — once, with exact steps — when the
 * connection was lost, lost its reply right, or came back. Never silent, never spams.
 */
export async function checkTelegramBusinessHealth(limit = 10): Promise<{ checked: number; changed: number }> {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return { checked: 0, changed: 0 };
  if (Date.now() - lastRun < 5 * 60_000) return { checked: 0, changed: 0 };
  lastRun = Date.now();
  const admin = createAdminClient();
  const { data } = await admin
    .from("telegram_business_connections")
    .select("id, organization_id, owner_user_id, owner_chat_id, can_reply, is_enabled")
    .order("updated_at", { ascending: true })
    .limit(limit);
  const rows = (data ?? []) as { id: string; organization_id: string; owner_user_id: number; owner_chat_id: number | null; can_reply: boolean; is_enabled: boolean }[];
  let changed = 0;
  for (const c of rows) {
    const acc = await loadAccount(c.organization_id, "telegram").catch(() => null);
    const token = acc?.secrets.bot_token;
    if (!token) continue;
    const r = await telegramCall(token, "getBusinessConnection", { business_connection_id: c.id });
    const d = (r.data ?? {}) as { is_enabled?: boolean; can_reply?: boolean; rights?: { can_reply?: boolean } };
    const canReply = d.rights ? d.rights.can_reply : d.can_reply;
    const verdict = businessVerdict({ is_enabled: c.is_enabled, can_reply: c.can_reply }, { reachable: r.ok, is_enabled: d.is_enabled, can_reply: canReply, error: r.error });
    const now = new Date().toISOString();
    if (verdict === "unknown" || verdict === "ok") {
      await admin.from("telegram_business_connections").update({ updated_at: now }).eq("id", c.id);
      continue;
    }
    changed++;
    await admin
      .from("telegram_business_connections")
      .update({ is_enabled: verdict === "lost" ? false : true, can_reply: verdict === "restored" ? true : verdict === "no_reply_right" ? false : c.can_reply, updated_at: now })
      .eq("id", c.id);
    const text = businessOwnerMessage(verdict);
    const chat = c.owner_chat_id ?? c.owner_user_id;
    if (text && chat) await telegramCall(token, "sendMessage", { chat_id: chat, text }).catch(() => undefined);
  }
  return { checked: rows.length, changed };
}
