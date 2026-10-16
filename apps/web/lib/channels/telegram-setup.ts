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
