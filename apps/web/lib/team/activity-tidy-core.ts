/**
 * Activity text tidy-up (additive, pure, DISPLAY only — the stored log is not changed).
 *
 * The team's log lines are written for the engine and the audit: they carry database ids ("(id 9dfc…)", "contact a19f…"),
 * validation codes ("(bad:contact_id)"), raw timestamps ("2026-11-01T02:39"), list indexes ("[2]") and the planner's
 * "(ASSUMPTION)" markers. The owner reads the same lines on the team screen — this turns them into clean, readable text in the
 * business language without losing meaning.
 */
type Lang = "he" | "en" | "ar";

const ASSUMPTION: Record<Lang, string> = { he: "(הנחה)", en: "(assumption)", ar: "(افتراض)" };

export function tidyActivityText(text: string, lang: Lang = "he"): string {
  let s = String(text ?? "");
  if (!s) return s;
  // ids in their usual wrappers first, then any id left
  s = s.replace(/\s*\((?:id|ID)\s*[:=]?\s*[0-9a-f-]{36}\)/g, "");
  s = s.replace(/,?\s*\b(?:id|ID)\s*[:=]?\s*[0-9a-f]{8}-[0-9a-f-]{27}/g, "");
  s = s.replace(/\bcontact(?:_id)?\s*[:=]?\s*[0-9a-f]{8}-[0-9a-f-]{27}/gi, "");
  s = s.replace(/`?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}`?/gi, "");
  // validation codes in brackets — the sentence around them already says what is wrong
  s = s.replace(/\s*\((?:bad|missing):[a-z_]+\)/gi, "");
  s = s.replace(/\b(?:bad|missing):([a-z_]+)/gi, (_m, f: string) => f.replace(/_/g, " "));
  // raw timestamps → day/month hour:minute
  s = s.replace(/\b(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?/g, (_m, _y, mo, d, h, mi) => `${d}/${mo} ${h}:${mi}`);
  s = s.replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g, (_m, y, mo, d) => `${d}/${mo}/${y}`);
  // list indexes "[0]" and the planner's markers
  s = s.replace(/\s*\[\d{1,2}\]\s*/g, " ");
  s = s.replace(/\(\s*ASSUMPTION\s*\)/g, ASSUMPTION[lang]);
  // left-over punctuation from removed parts: "( , )", ", ,", "( )"
  s = s.replace(/\(\s*[,·]?\s*\)/g, "").replace(/\(\s*,\s*/g, "(").replace(/,\s*\)/g, ")");
  s = s.replace(/\s+,/g, ",").replace(/,\s*,/g, ",").replace(/·\s*·/g, "·");
  s = s.replace(/\s{2,}/g, " ").replace(/\s+([.;:)])/g, "$1").trim();
  return s;
}
