import { createHash } from "node:crypto";

/**
 * Wave 17 — server-side conversion events to ad platforms (pure, unit-tested):
 *   Meta Conversions API, Google Analytics 4 Measurement Protocol, TikTok Events API.
 * Personal data is never sent in clear text: e-mail / phone are normalised and SHA-256
 * hashed as each platform requires. event_id = our stable reference → the platforms
 * de-duplicate retries and browser-pixel duplicates.
 */
export type ConvEvent = "Lead" | "Purchase" | "Schedule";
export interface ConvInput {
  event: ConvEvent;
  ref: string;
  at: string;
  value?: number | null;
  currency?: string | null;
  email?: string | null;
  phone?: string | null;
  contactId?: string | null;
}

export const sha256 = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

export function normEmail(e: string | null | undefined): string | null {
  const v = (e ?? "").trim().toLowerCase();
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v) ? v : null;
}

/** E.164 without "+" (Israeli 05x → 9725x). */
export function normPhoneDigits(p: string | null | undefined): string | null {
  let d = (p ?? "").replace(/[^\d+]/g, "");
  if (!d) return null;
  if (d.startsWith("+")) d = d.slice(1);
  else if (d.startsWith("00")) d = d.slice(2);
  else if (/^0\d{8,9}$/.test(d)) d = `972${d.slice(1)}`;
  d = d.replace(/\D/g, "");
  return d.length >= 8 && d.length <= 15 ? d : null;
}

const unix = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);
const money = (v: number | null | undefined) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.round(v * 100) / 100 : undefined);

export function metaBody(i: ConvInput, opts: { testCode?: string | null } = {}): Record<string, unknown> {
  const em = normEmail(i.email);
  const ph = normPhoneDigits(i.phone);
  const value = money(i.value);
  return {
    data: [
      {
        event_name: i.event,
        event_time: unix(i.at),
        event_id: i.ref,
        action_source: "system_generated",
        user_data: {
          ...(em ? { em: [sha256(em)] } : {}),
          ...(ph ? { ph: [sha256(ph)] } : {}),
          ...(i.contactId ? { external_id: [sha256(i.contactId)] } : {}),
        },
        ...(value ? { custom_data: { value, currency: (i.currency || "ILS").toUpperCase() } } : {}),
      },
    ],
    ...(opts.testCode ? { test_event_code: opts.testCode } : {}),
  };
}

const GA4_NAMES: Record<ConvEvent, string> = { Lead: "generate_lead", Purchase: "purchase", Schedule: "book_appointment" };

export function ga4Body(i: ConvInput): Record<string, unknown> {
  const em = normEmail(i.email);
  const ph = normPhoneDigits(i.phone);
  const value = money(i.value);
  const clientId = i.contactId ? `${parseInt(sha256(i.contactId).slice(0, 8), 16)}.${parseInt(sha256(i.contactId).slice(8, 16), 16)}` : `${Date.now()}.1`;
  return {
    client_id: clientId,
    ...(i.contactId ? { user_id: sha256(i.contactId).slice(0, 36) } : {}),
    timestamp_micros: unix(i.at) * 1_000_000,
    ...(em || ph ? { user_data: { ...(em ? { sha256_email_address: [sha256(em)] } : {}), ...(ph ? { sha256_phone_number: [sha256(`+${ph}`)] } : {}) } } : {}),
    events: [
      {
        name: GA4_NAMES[i.event],
        params: {
          ...(value ? { value, currency: (i.currency || "ILS").toUpperCase() } : {}),
          ...(i.event === "Purchase" ? { transaction_id: i.ref } : { event_id: i.ref }),
          engagement_time_msec: 1,
        },
      },
    ],
  };
}

const TIKTOK_NAMES: Record<ConvEvent, string> = { Lead: "SubmitForm", Purchase: "CompletePayment", Schedule: "Schedule" };

export function tiktokBody(i: ConvInput, pixel: string, opts: { testCode?: string | null } = {}): Record<string, unknown> {
  const em = normEmail(i.email);
  const ph = normPhoneDigits(i.phone);
  const value = money(i.value);
  return {
    event_source: "web",
    event_source_id: pixel,
    ...(opts.testCode ? { test_event_code: opts.testCode } : {}),
    data: [
      {
        event: TIKTOK_NAMES[i.event],
        event_time: unix(i.at),
        event_id: i.ref,
        user: {
          ...(em ? { email: sha256(em) } : {}),
          ...(ph ? { phone: sha256(`+${ph}`) } : {}),
          ...(i.contactId ? { external_id: sha256(i.contactId) } : {}),
        },
        ...(value ? { properties: { value, currency: (i.currency || "ILS").toUpperCase() } } : {}),
      },
    ],
  };
}

export const CONVERSION_PROVIDERS = ["meta_capi", "ga4", "tiktok"] as const;
export type ConversionProvider = (typeof CONVERSION_PROVIDERS)[number];
