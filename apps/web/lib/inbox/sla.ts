/**
 * Wave 24 — "who is waiting for an answer?" (pure, unit-tested).
 * A conversation is waiting when the customer wrote last: their last message is newer than the
 * last answer from the agent, a person or an automation.
 */
export interface SlaInput {
  status?: string | null;
  last_customer_at?: string | null;
  last_human_at?: string | null;
  last_ai_at?: string | null;
  last_auto_at?: string | null;
}

const ms = (v: string | null | undefined) => (v ? Date.parse(v) : NaN);

/** Minutes the customer has been waiting, or null when nobody is waiting. */
export function waitingMinutes(c: SlaInput, now = Date.now()): number | null {
  if (c.status && c.status !== "open") return null;
  const cust = ms(c.last_customer_at);
  if (!Number.isFinite(cust)) return null;
  const answered = Math.max(...[c.last_human_at, c.last_ai_at, c.last_auto_at].map(ms).filter(Number.isFinite), -Infinity);
  if (answered >= cust) return null;
  return Math.max(0, Math.floor((now - cust) / 60_000));
}

export type SlaTone = "ok" | "warn" | "late";
/** ≤ 5 min fine, ≤ 15 min "soon", beyond that late (customers expect an answer within minutes). */
export function slaTone(minutes: number | null): SlaTone | null {
  if (minutes === null) return null;
  return minutes <= 5 ? "ok" : minutes <= 15 ? "warn" : "late";
}

/** "3 דק'", "2 ש'", "4 ימים" — compact label for the list. */
export function waitLabel(minutes: number, locale: string): string {
  const he = locale === "he", ar = locale === "ar";
  if (minutes < 60) return he ? `${minutes} דק'` : ar ? `${minutes} د` : `${minutes}m`;
  const h = Math.floor(minutes / 60);
  if (h < 24) return he ? `${h} ש'` : ar ? `${h} س` : `${h}h`;
  const d = Math.floor(h / 24);
  return he ? `${d} ימים` : ar ? `${d} أيام` : `${d}d`;
}

export const INBOX_CHANNELS = ["whatsapp", "whatsapp_qr", "telegram", "telegram_user", "instagram", "messenger", "web", "email", "sms", "voice"] as const;
export type InboxChannel = (typeof INBOX_CHANNELS)[number];
export const INBOX_FLAGS = ["waiting", "hot", "human"] as const;
export type InboxFlag = (typeof INBOX_FLAGS)[number];

/** Sanitized search text for PostgREST ilike (no wildcards or filter syntax from the user). */
export function searchTerm(q: unknown): string | null {
  if (typeof q !== "string") return null;
  const s = q.replace(/[%_*,()\\'"]/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);
  return s.length >= 2 ? s : null;
}
