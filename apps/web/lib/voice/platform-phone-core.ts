/**
 * Wave 57 — zero-setup phone for businesses (pure parts, unit-tested).
 * The platform owner sets ONE Twilio account (TWILIO_PLATFORM_ACCOUNT_SID + TWILIO_PLATFORM_AUTH_TOKEN);
 * businesses on the Business plan get a number for their AI agent in one click. Calls on platform numbers
 * are metered with a monthly minutes allowance per business (VOICE_PLATFORM_MINUTES, default 300).
 */
type Env = Record<string, string | undefined>;

export interface PlatformTwilio {
  sid: string;
  token: string;
  country: string;
}

export function platformTwilio(env: Env): PlatformTwilio | null {
  const sid = (env.TWILIO_PLATFORM_ACCOUNT_SID ?? "").trim();
  const token = (env.TWILIO_PLATFORM_AUTH_TOKEN ?? "").trim();
  if (!/^AC[0-9a-f]{32}$/i.test(sid) || !/^[0-9a-f]{32}$/i.test(token)) return null;
  const country = (env.TWILIO_PLATFORM_COUNTRY ?? "US").trim().toUpperCase();
  return { sid, token, country: /^[A-Z]{2}$/.test(country) ? country : "US" };
}

/** Monthly minutes included per business on platform numbers (0 = unlimited). */
export function monthlyMinutes(env: Env): number {
  const n = Number(env.VOICE_PLATFORM_MINUTES ?? 300);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : 300;
}

/** Start of the current month in UTC (ISO). */
export function monthStart(now = new Date()): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

/** Minutes used from call durations (seconds), rounded up per call like carriers do. */
export function minutesUsed(durationsSec: (number | null | undefined)[]): number {
  return durationsSec.reduce<number>((a, s) => a + (s && s > 0 ? Math.ceil(s / 60) : 0), 0);
}

export function minutesLeft(used: number, limit: number): number | null {
  return limit === 0 ? null : Math.max(0, limit - used);
}

export function validE164(v: unknown): v is string {
  return typeof v === "string" && /^\+\d{8,15}$/.test(v.trim());
}

/** "+15551234567" → "+1 555-123-4567"; Israeli "+972501234567" → "050-123-4567" (display only). */
export function displayPhone(e164: string): string {
  const d = e164.replace(/[^\d+]/g, "");
  if (/^\+972\d{8,9}$/.test(d)) {
    const local = `0${d.slice(4)}`;
    return local.length === 10 ? `${local.slice(0, 3)}-${local.slice(3, 6)}-${local.slice(6)}` : `${local.slice(0, 2)}-${local.slice(2, 5)}-${local.slice(5)}`;
  }
  if (/^\+1\d{10}$/.test(d)) return `+1 ${d.slice(2, 5)}-${d.slice(5, 8)}-${d.slice(8)}`;
  return d;
}

/** Twilio's answer when a number cannot be bought automatically (address / regulatory bundle needed). */
export function needsManualAssign(errorText: string): boolean {
  return /address|bundle|regulat|identity|end.?user|not available|no numbers|21631|21649|21650|21615/i.test(errorText ?? "");
}

/**
 * Wave 59 — minutes of a finished call that go beyond the monthly allowance (taken from purchased
 * minute packs). Counts only the part of THIS call above the limit.
 */
export function overflowMinutes(usedBefore: number, usedAfter: number, limit: number): number {
  if (limit <= 0) return 0; // unlimited plan
  return Math.max(0, Math.max(0, usedAfter - limit) - Math.max(0, usedBefore - limit));
}

/** Minutes left = what is left of the month + purchased minutes (null = unlimited). */
export function minutesLeftWithPacks(left: number | null, packBalance: number): number | null {
  if (left === null) return null;
  return left + Math.max(0, Math.round(packBalance));
}
