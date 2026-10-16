/**
 * Payments — pure helpers (unit-tested): webhook signatures, status mapping,
 * prepaid period math, order references.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export type PayProvider = "paypal" | "lemonsqueezy" | "nowpayments" | "stripe";
export type SubStatus = "trialing" | "active" | "past_due" | "canceled" | "incomplete" | "unpaid";

function sameHex(a: string, b: string) {
  const x = Buffer.from(a.trim().toLowerCase());
  const y = Buffer.from(b.trim().toLowerCase());
  return x.length === y.length && x.length > 0 && timingSafeEqual(x, y);
}

/** Sorts object keys recursively (NOWPayments signs the sorted JSON). */
export function sortKeysDeep(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeysDeep);
  if (v && typeof v === "object") {
    return Object.fromEntries(
      Object.keys(v as Record<string, unknown>)
        .sort()
        .map((k) => [k, sortKeysDeep((v as Record<string, unknown>)[k])]),
    );
  }
  return v;
}

/** NOWPayments IPN: x-nowpayments-sig = hex(HMAC-SHA512(ipnSecret, JSON(sortedBody))). */
export function verifyNowPaymentsSignature(rawBody: string, header: string | null, secret: string): boolean {
  if (!secret || !header) return false;
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return false;
  }
  const expected = createHmac("sha512", secret).update(JSON.stringify(sortKeysDeep(parsed))).digest("hex");
  return sameHex(expected, header);
}

/** Lemon Squeezy: X-Signature = hex(HMAC-SHA256(signingSecret, rawBody)). */
export function verifyLemonSignature(rawBody: string, header: string | null, secret: string): boolean {
  if (!secret || !header) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  return sameHex(expected, header);
}

export function paypalStatus(s: string | null | undefined): SubStatus {
  switch ((s ?? "").toUpperCase()) {
    case "ACTIVE":
    case "APPROVED":
      return "active";
    case "SUSPENDED":
      return "past_due";
    case "CANCELLED":
    case "EXPIRED":
      return "canceled";
    default:
      return "incomplete";
  }
}

/** Lemon Squeezy statuses → ours. "cancelled" still runs until ends_at (cancel at period end). */
export function lemonStatus(s: string | null | undefined): { status: SubStatus; cancelAtPeriodEnd: boolean } {
  switch ((s ?? "").toLowerCase()) {
    case "on_trial":
      return { status: "trialing", cancelAtPeriodEnd: false };
    case "active":
      return { status: "active", cancelAtPeriodEnd: false };
    case "cancelled":
      return { status: "active", cancelAtPeriodEnd: true };
    case "past_due":
    case "paused":
      return { status: "past_due", cancelAtPeriodEnd: false };
    case "unpaid":
      return { status: "unpaid", cancelAtPeriodEnd: false };
    case "expired":
      return { status: "canceled", cancelAtPeriodEnd: false };
    default:
      return { status: "incomplete", cancelAtPeriodEnd: false };
  }
}

/** Prepaid period end: extends the current period when renewing early, otherwise starts now. */
export function prepaidPeriodEnd(interval: "month" | "year", currentEnd: string | null | undefined, now = new Date()): string {
  const base = currentEnd && new Date(currentEnd) > now ? new Date(currentEnd) : new Date(now);
  const d = new Date(base);
  if (interval === "year") d.setUTCFullYear(d.getUTCFullYear() + 1);
  else d.setUTCMonth(d.getUTCMonth() + 1);
  return d.toISOString();
}

/** order_id for one-off (crypto) checkouts: org:plan:interval:nonce */
export function buildOrderRef(org: string, plan: string, interval: string, nonce: string) {
  return `${org}:${plan}:${interval}:${nonce}`.slice(0, 120);
}

export function parseOrderRef(ref: string | null | undefined): { org: string; plan: string; interval: "month" | "year" } | null {
  const m = (ref ?? "").match(/^([0-9a-f-]{36}):(pro|business):(month|year):[A-Za-z0-9]{4,40}$/);
  return m ? { org: m[1]!, plan: m[2]!, interval: m[3] as "month" | "year" } : null;
}

export function moneyString(n: number) {
  return (Math.round(n * 100) / 100).toFixed(2);
}
