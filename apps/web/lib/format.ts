import { LOCALE_META, type Locale } from "./i18n/config";

/**
 * Formatting helpers. Values that must stay LTR inside RTL text (phones,
 * emails, currency, IDs) are rendered inside <bdi dir="ltr"> by the <Ltr>
 * component — these helpers only produce the strings.
 */

export function formatNumber(locale: Locale, value: number) {
  return new Intl.NumberFormat(LOCALE_META[locale].intl).format(value);
}

export function formatCurrency(locale: Locale, value: number, currency = "ILS") {
  return new Intl.NumberFormat(LOCALE_META[locale].intl, {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(value);
}

export function formatPercent(locale: Locale, ratio: number) {
  return new Intl.NumberFormat(LOCALE_META[locale].intl, { style: "percent", maximumFractionDigits: 1 }).format(ratio);
}

export function formatDate(locale: Locale, value: string | Date, timeZone?: string) {
  return new Intl.DateTimeFormat(LOCALE_META[locale].intl, { dateStyle: "medium", timeZone }).format(new Date(value));
}

export function formatDateTime(locale: Locale, value: string | Date, timeZone?: string) {
  return new Intl.DateTimeFormat(LOCALE_META[locale].intl, { dateStyle: "medium", timeStyle: "short", timeZone }).format(
    new Date(value),
  );
}

/** Pretty-print E.164-ish phone numbers without changing digits. */
export function formatPhone(phone: string | null | undefined) {
  if (!phone) return "";
  const m = phone.match(/^\+972(\d{2})(\d{3})(\d{4})$/);
  if (m) return `+972-${m[1]}-${m[2]}-${m[3]}`;
  return phone;
}

/** Neutralise CSV/formula injection (=, +, -, @ prefixes) and quote safely. */
export function csvCell(value: unknown): string {
  let s = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}
