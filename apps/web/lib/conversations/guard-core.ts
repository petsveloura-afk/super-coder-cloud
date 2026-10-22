/**
 * Conversation guard — pure helpers (mirror of the SQL is_opt_out_text / is_opt_in_text,
 * unit-tested) and the reasons shown in the inbox.
 */
const OPT_OUT = new Set([
  "stop", "stop all", "stopall", "unsubscribe", "cancel", "end", "quit", "opt out", "optout", "remove me",
  "הסר", "הסרה", "להסיר", "הסירו", "הסירו אותי", "תסירו", "תסירו אותי", "הסר אותי", "די", "עצור", "תפסיקו", "הפסיקו", "לא לשלוח", "ביטול הרשמה",
  "إلغاء", "الغاء", "توقف", "أوقف", "الغاء الاشتراك", "إلغاء الاشتراك", "stop please",
]);
const OPT_IN = new Set(["start", "unstop", "subscribe", "resume", "חזרה", "הצטרף", "הצטרפות", "להצטרף", "הרשמה", "اشتراك", "اشترك", "ابدأ"]);

const norm = (t: string | null | undefined, extra = "") =>
  (t ?? "")
    .trim()
    .replace(new RegExp(`[\\s.!?${extra}]+$`, "u"), "")
    .toLowerCase();

export function isOptOutText(text: string | null | undefined): boolean {
  return OPT_OUT.has(norm(text, "״\"'׳"));
}
export function isOptInText(text: string | null | undefined): boolean {
  return OPT_IN.has(norm(text));
}

export const GUARD_REASONS = [
  "ok", "opted_out", "no_consent", "human_owns", "human_answered", "customer_replied", "max_attempts", "never_wrote",
  "too_soon", "daily_cap", "outside_24h", "quiet_hours", "not_found", "replanned", "canceled_by_team", "human_replied", "human_took_over",
] as const;

/** Reasons worth trying again later (the item stays in the queue). */
export function isRetryReason(reason: string): boolean {
  return reason === "too_soon" || reason === "quiet_hours";
}

export function optOutConfirmation(locale: string): string {
  if (locale === "en") return "You're unsubscribed — we won't send you automatic messages. Write START to get them again.";
  if (locale === "ar") return "تم إلغاء الاشتراك — لن نرسل لك رسائل تلقائية. اكتب «اشتراك» للعودة.";
  return "הוסרת ✓ לא נשלח לך יותר הודעות אוטומטיות. כדי לחזור, כתבו ״חזרה״.";
}
export function optInConfirmation(locale: string): string {
  if (locale === "en") return "Welcome back ✓ you'll get our messages again.";
  if (locale === "ar") return "أهلاً بعودتك ✓ ستصلك رسائلنا مجدداً.";
  return "חזרת ✓ נשמח לעדכן אותך שוב.";
}
