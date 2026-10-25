/**
 * Wave 24 — saved replies (pure, unit-tested): placeholders and the "/" shortcut.
 *   {name} → the customer's first name, {business} → the business name.
 */
export function fillReply(body: string, vars: { name?: string | null; business?: string | null }): string {
  const first = (vars.name ?? "").trim().split(/\s+/)[0] ?? "";
  return body
    .replace(/\{name\}|\{שם\}/g, first)
    .replace(/\{business\}|\{עסק\}/g, (vars.business ?? "").trim())
    .replace(/[ \t]+([,.!?])/g, "$1")
    .replace(/ {2,}/g, " ")
    .trim();
}

export function normalizeShortcut(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim().toLowerCase().replace(/^\//, "").replace(/\s+/g, "-");
  return /^[a-z0-9֐-׿_-]{1,24}$/.test(s) ? s : null;
}

export interface SavedReply {
  id: string;
  title: string;
  body: string;
  shortcut: string | null;
  use_count: number;
}

/** Filter for the picker: by shortcut prefix ("/מחיר"), title or text. Most used first. */
export function filterReplies(list: SavedReply[], q: string): SavedReply[] {
  const s = q.trim().toLowerCase().replace(/^\//, "");
  const sorted = [...list].sort((a, b) => b.use_count - a.use_count || a.title.localeCompare(b.title));
  if (!s) return sorted;
  return sorted.filter((r) => (r.shortcut ?? "").startsWith(s) || r.title.toLowerCase().includes(s) || r.body.toLowerCase().includes(s));
}

/** Ready answers every new business starts with (can be deleted or edited). */
export const STARTER_REPLIES: { title: string; body: string; shortcut: string }[] = [
  { title: "תודה שפניתם", body: "היי {name}, תודה שפנית ל{business}! איך אפשר לעזור?", shortcut: "שלום" },
  { title: "נחזור אליך", body: "תודה {name}, קיבלנו. נחזור אליך תוך שעה לכל היותר.", shortcut: "נחזור" },
  { title: "שליחת מחירון", body: "בשמחה {name}! מצרף את המחירון. אם משהו לא ברור, אני כאן.", shortcut: "מחיר" },
  { title: "קביעת תור", body: "מעולה {name}, מתי נוח לך? יש לנו זמנים פנויים השבוע.", shortcut: "תור" },
];
