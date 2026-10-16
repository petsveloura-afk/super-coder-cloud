import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadAccount } from "./accounts";
import { telegramCall } from "./providers";

/**
 * Makes every connected Telegram bot look professional automatically:
 * the "Menu" command list, the description shown before Start, and the short
 * description on the bot's profile — from the AI agent's settings.
 */
export async function configureTelegramBot(orgId: string): Promise<boolean> {
  const acc = await loadAccount(orgId, "telegram").catch(() => null);
  if (!acc?.secrets.bot_token) return false;
  const admin = createAdminClient();
  const { data: agent } = await admin
    .from("ai_agents")
    .select("name, greeting, language, profile")
    .eq("organization_id", orgId)
    .eq("enabled", true)
    .contains("autopilot_channels", ["telegram"])
    .order("created_at")
    .limit(1)
    .maybeSingle();
  const lang = agent?.language === "en" ? "en" : agent?.language === "ar" ? "ar" : "he";
  const L = {
    he: { start: "התחלה", menu: "תפריט", prices: "מחירים", book: "קביעת תור", human: "דברו עם נציג" },
    en: { start: "Start", menu: "Menu", prices: "Prices", book: "Book", human: "Talk to a person" },
    ar: { start: "ابدأ", menu: "القائمة", prices: "الأسعار", book: "حجز موعد", human: "التحدث مع موظف" },
  }[lang];
  const token = acc.secrets.bot_token;
  // wave 10: make sure Telegram sends every update type (Business messages, button taps)
  if ((acc.config ?? {}).updates_v !== TELEGRAM_UPDATES_VERSION) await registerTelegramWebhook(acc).catch(() => false);
  const commands = [
    { command: "start", description: L.start },
    { command: "menu", description: L.menu },
    { command: "prices", description: L.prices },
    { command: "book", description: L.book },
    { command: "human", description: L.human },
  ];
  const r = await telegramCall(token, "setMyCommands", { commands });
  await telegramCall(token, "setChatMenuButton", { menu_button: { type: "commands" } });
  const profile = (agent?.profile as { business?: string } | null) ?? {};
  const description = String(agent?.greeting || profile.business || "").slice(0, 512);
  if (description) await telegramCall(token, "setMyDescription", { description });
  const short = String(profile.business || agent?.name || "").slice(0, 120);
  if (short) await telegramCall(token, "setMyShortDescription", { short_description: short });
  return r.ok;
}

/* ------------------------------------------------ wave 10: full update list + self-repair */

/**
 * Every update type the platform handles. Telegram only sends the types listed here,
 * so a bot registered with the old short list never received Telegram Business
 * messages (business_message) or button taps (callback_query).
 */
export const TELEGRAM_UPDATES = [
  "message",
  "edited_message",
  "channel_post",
  "callback_query",
  "business_connection",
  "business_message",
  "edited_business_message",
  "deleted_business_messages",
] as const;
export const TELEGRAM_UPDATES_VERSION = "3";

/** (Re)registers the bot's webhook with the full update list; remembers the version on the account. */
export async function registerTelegramWebhook(acc: { id: string; webhook_token: string; secrets: Record<string, string>; config: Record<string, string> }): Promise<boolean> {
  if (!acc.secrets.bot_token) return false;
  const { publicEnv } = await import("@/lib/env");
  const url = `${publicEnv.appUrl.replace(/\/$/, "")}/api/channels/telegram/${acc.webhook_token}`;
  const r = await telegramCall(acc.secrets.bot_token, "setWebhook", { url, secret_token: acc.webhook_token, allowed_updates: [...TELEGRAM_UPDATES], drop_pending_updates: false });
  if (r.ok) {
    const admin = createAdminClient();
    await admin
      .from("channel_accounts")
      .update({ config: { ...acc.config, updates_v: TELEGRAM_UPDATES_VERSION }, updated_at: new Date().toISOString() })
      .eq("id", acc.id);
  }
  return r.ok;
}

/**
 * Self-repair (cron): bots connected before this update get the full update list
 * automatically — Telegram Business works without reconnecting anything.
 */
export async function healTelegramWebhooks(limit = 10): Promise<number> {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return 0;
  const admin = createAdminClient();
  const { data } = await admin
    .from("channel_accounts")
    .select("organization_id, config")
    .eq("kind", "telegram")
    .neq("status", "disabled")
    .limit(200);
  const stale = ((data ?? []) as { organization_id: string; config: Record<string, string> | null }[]).filter((a) => (a.config ?? {}).updates_v !== TELEGRAM_UPDATES_VERSION).slice(0, limit);
  let fixed = 0;
  for (const a of stale) {
    const acc = await loadAccount(a.organization_id, "telegram").catch(() => null);
    if (acc && (await registerTelegramWebhook(acc))) fixed++;
  }
  return fixed;
}
