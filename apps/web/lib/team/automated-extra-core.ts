/**
 * Wave 67 — more automated senders that are NOT customers (pure, unit-tested): the Telegram service-notification account
 * and one-time login / verification code messages. Used only by the team's own queue (automatedContactIds); it can only
 * ever remove a robot from "waiting customers", it never adds anything and never touches the inbox itself.
 */
const TG_NAME = /^(telegram|טלגרם)(\s+(notifications?|service|support|התראות))?$/i;

/** the Telegram service account ("Telegram", phone +42777 / 777000) */
export function isTelegramServiceContact(i: { name?: string | null; phone?: string | null; company?: string | null }): boolean {
  const name = (i.name ?? "").replace(/\s+/g, " ").trim();
  const company = (i.company ?? "").replace(/\s+/g, " ").trim();
  if (TG_NAME.test(name) || TG_NAME.test(company)) return true;
  const digits = (i.phone ?? "").replace(/\D/g, "");
  return /^42777\d{0,2}$/.test(digits) || digits === "777000";
}

const CODE_WORDS =
  /((login|log-?in|sign-?in|verification|verify|confirmation|security|one-?time|otp|2fa|authentication)[^\n]{0,24}\bcode\b|\bcode\b[^\n]{0,24}(login|verification)|קוד (ה)?(התחברות|אימות|אישור|כניסה|חד[- ]?פעמי)|(رمز|كود) (ال)?(تحقق|دخول|تأكيد))/i;
const CODE_DIGITS = /(?<!\d)(\d{4,8}|\d{3}[ -]\d{3})(?!\d)/;

/** a short automated "your login code is 12345" message; a question or a long text is a person */
export function looksLikeLoginCode(text: unknown): boolean {
  if (typeof text !== "string") return false;
  const t = text.trim();
  if (!t || t.length > 220) return false;
  if (/[?؟]/.test(t)) return false;
  return CODE_WORDS.test(t) && CODE_DIGITS.test(t);
}

/** contacts whose EVERY conversation ends (latest inbound message) with a code message; a contact with no text at all is not flagged */
export function contactsWithOnlyCodeMessages(convs: { id: string; contact_id: string | null }[], lastInbound: Map<string, string>): Set<string> {
  const flags = new Map<string, boolean[]>();
  for (const c of convs) {
    if (!c.contact_id) continue;
    const body = lastInbound.get(c.id);
    if (body === undefined) continue;
    const list = flags.get(c.contact_id) ?? [];
    list.push(looksLikeLoginCode(body));
    flags.set(c.contact_id, list);
  }
  const out = new Set<string>();
  for (const [id, list] of flags) if (list.length && list.every(Boolean)) out.add(id);
  return out;
}
