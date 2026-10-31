/**
 * Wave 59 — missed calls never become lost leads (pure, unit-tested).
 *
 * When a customer's call was not really answered (busy / no answer / failed, hung up within seconds
 * before saying anything, or the phone agent is not available), the customer gets a text within seconds
 * — WhatsApp first, SMS as the fallback — and the AI agent continues the conversation in writing.
 */

export interface CallEnd {
  direction: "in" | "out" | "alert" | string;
  status: string;
  duration: number | null;
  /** how many times the caller spoke during the call */
  callerTurns: number;
}

export const SHORT_CALL_SEC = 8;

/** Was this inbound call a missed call? */
export function isMissedCall(c: CallEnd): boolean {
  if (c.direction !== "in") return false;
  if (["busy", "no-answer", "failed", "canceled"].includes(c.status)) return true;
  if (c.status === "completed" || c.status === "in_progress") return c.callerTurns === 0 && (c.duration ?? 0) <= SHORT_CALL_SEC;
  return false;
}

/** The text-back message (the business's own text when set, else a warm default). */
export function missedCallText(locale: string, orgName: string, custom?: string | null): string {
  const own = String(custom ?? "").trim();
  if (own.length >= 4) return own.slice(0, 500);
  const name = orgName.trim();
  if (locale === "en") return `Hi! 👋 We saw you called${name ? ` ${name}` : ""} and couldn't answer right now. How can we help? Reply here and we'll take care of you right away.`;
  if (locale === "ar") return `مرحباً! 👋 رأينا أنك اتصلت${name ? ` بـ${name}` : ""} ولم نتمكن من الرد الآن. كيف يمكننا مساعدتك؟ اكتب لنا هنا وسنهتم بك فوراً.`;
  return `היי! 👋 ראינו שהתקשרת${name ? ` ל${name}` : ""} ולא הספקנו לענות. במה אפשר לעזור? אפשר לכתוב כאן ונטפל בך מיד.`;
}

/** One text-back per caller per window (no flood when someone calls three times in a row). */
export const MISSED_WINDOW_MIN = 120;
