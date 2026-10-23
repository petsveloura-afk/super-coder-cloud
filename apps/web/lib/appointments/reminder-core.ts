/**
 * Wave 17 — appointment reminders to the customer, 24 hours and 1 hour before
 * (pure text, unit-tested). Confirm / cancel are signed one-tap links.
 */
export type ReminderWindow = "24h" | "1h";
type Loc = "he" | "ar" | "en";

const L = {
  he: { h24: "📅 תזכורת: יש לך פגישה מחר", h1: "⏰ תזכורת: הפגישה שלך מתחילה בעוד כשעה", at: "מתי", where: "איפה", with: "עם", confirm: "לאישור הגעה", cancel: "לביטול", sign: "נתראה!" },
  ar: { h24: "📅 تذكير: لديك موعد غداً", h1: "⏰ تذكير: موعدك يبدأ بعد ساعة تقريباً", at: "متى", where: "أين", with: "مع", confirm: "لتأكيد الحضور", cancel: "للإلغاء", sign: "نراك قريباً!" },
  en: { h24: "📅 Reminder: you have an appointment tomorrow", h1: "⏰ Reminder: your appointment starts in about an hour", at: "When", where: "Where", with: "With", confirm: "Confirm", cancel: "Cancel", sign: "See you soon!" },
} as const;

export function apptWhen(iso: string, locale: Loc, tz: string): string {
  try {
    return new Intl.DateTimeFormat(locale === "en" ? "en-GB" : locale === "ar" ? "ar" : "he-IL", { weekday: "long", day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit", timeZone: tz }).format(new Date(iso));
  } catch {
    return new Date(iso).toISOString().slice(0, 16).replace("T", " ");
  }
}

export function appointmentReminderText(
  locale: Loc,
  window: ReminderWindow,
  a: { title: string | null; starts_at: string; location: string | null; org: string },
  tz: string,
  links?: { confirm?: string; cancel?: string },
): string {
  const l = L[locale] ?? L.he;
  return [
    window === "24h" ? l.h24 : l.h1,
    a.title ? `• ${a.title}` : "",
    `${l.at}: ${apptWhen(a.starts_at, locale, tz)}`,
    a.location ? `${l.where}: ${a.location}` : "",
    a.org ? `${l.with}: ${a.org}` : "",
    links?.confirm && window === "24h" ? `✅ ${l.confirm}: ${links.confirm}` : "",
    links?.cancel ? `❌ ${l.cancel}: ${links.cancel}` : "",
    l.sign,
  ]
    .filter(Boolean)
    .join("\n");
}

/** Preferred channel order for a reminder (the customer's own conversations first). */
export const REMINDER_CHANNELS = ["whatsapp", "whatsapp_qr", "telegram", "sms"] as const;
