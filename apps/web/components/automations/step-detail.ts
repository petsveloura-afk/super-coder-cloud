import type { TFunction } from "@/lib/i18n/translate";

/** Machine reason codes of automation steps (no_contact, no_deal…) → a clear sentence in the UI language. */
const KNOWN = new Set([
  "automation_disabled",
  "bad_url",
  "empty",
  "no_consent",
  "no_contact",
  "no_deal",
  "no_email",
  "no_record",
  "no_tag",
  "not_a_member",
  "channel_not_connected",
  "contact_has_no_phone",
  "contact_has_no_telegram_chat",
  "contact_has_no_email",
]);

export function stepDetailLabel(t: TFunction, detail: string): string {
  const code = detail.trim();
  if (KNOWN.has(code)) return t(`automations.stepDetail.${code}`);
  if (/^delay_min/.test(code)) return t("automations.stepDetail.delayed");
  return code;
}
