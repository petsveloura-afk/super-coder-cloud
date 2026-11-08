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
const ASSUMPTION_LABEL: Record<Lang, string> = { he: "הנחה:", en: "Assumption:", ar: "افتراض:" };

/** the English phrases the team's tools write into the log → Hebrew / Arabic (display only) */
const PHRASES: [RegExp, string, string][] = [
  [/\((\d+) automated sender\(s\) ignored — not customers\)/g, "($1 שולחים אוטומטיים סוננו — לא לקוחות)", "(تم تجاهل $1 مرسلين آليين — ليسوا عملاء)"],
  [/\bwaiting since\b/g, "ממתין מאז", "ينتظر منذ"],
  [/\bquiet since\b/g, "שקט מאז", "هادئ منذ"],
  [/\bon (email|whatsapp|telegram|sms|messenger|instagram|webchat)\b/gi, "ב-$1", "عبر $1"],
  [/\bno customer is waiting\b/gi, "אין לקוחות שממתינים", "لا يوجد عملاء بانتظار الرد"],
  [/\byesterday:/gi, "אתמול:", "أمس:"],
  [/\b(\d+) leads\b/g, "$1 לידים", "$1 عملاء محتملين"],
  [/\b(\d+) conversations\b/g, "$1 שיחות", "$1 محادثات"],
  [/\b(\d+) AI replies\b/g, "$1 תשובות AI", "$1 ردود ذكاء اصطناعي"],
  [/\bwon (\d+) deals worth\b/g, "נסגרו $1 עסקאות בשווי", "أُغلقت $1 صفقات بقيمة"],
  [/\brevenue\b/g, "הכנסות", "الإيرادات"],
  [/\bavg\b/g, "ממוצע", "متوسط"],
  [/\bdue (\d{2}\/\d{2}\/\d{4})/g, "יעד $1", "موعد $1"],
  [/,\s*OVERDUE\b/g, ", באיחור", "، متأخر"],
  [/\bOVERDUE\b/g, "באיחור", "متأخر"],
  [/\[proposed\]/g, "[מוצע]", "[مقترح]"],
  [/\[stopped\]/g, "[נעצר]", "[متوقف]"],
  [/\[running\]/g, "[פעיל]", "[قيد التشغيل]"],
  [/\bscheduled (\d{2}\/\d{2})/g, "מתוזמן $1", "مجدول $1"],
  [/\bdraft (\d{2}\/\d{2})/g, "טיוטה $1", "مسودة $1"],
  [/\bno open tasks\b/gi, "אין משימות פתוחות", "لا توجد مهام مفتوحة"],
  [/\bno contacts found\b/gi, "לא נמצאו אנשי קשר", "لم يتم العثور على جهات اتصال"],
  [/\bno recent reviews\b/gi, "אין ביקורות חדשות", "لا توجد مراجعات حديثة"],
  [/\bposts in (\d+) days\b/g, "פוסטים ב-$1 ימים", "منشورات خلال $1 يومًا"],
  [/\bTop:/g, "המובילים:", "الأفضل:"],
];

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
  // an id cut in the middle by the log's length limit ("facebook id 92ed4233-cd66-4888-a183-1859…")
  s = s.replace(/,?\s*\b(?:id|ID)\s*[:=]?\s*[0-9a-f]{8}-[0-9a-f-]{4,35}…?/g, "");
  s = s.replace(/\bcontact\s*[:=]?\s*[0-9a-f]{8}-[0-9a-f-]{4,35}…?/gi, "");
  s = s.replace(/\(contact\s*—\s*,\s*/gi, "(");
  // long decimals ("avg 1.2857142857142858") → one decimal
  s = s.replace(/\b(\d+)\.(\d{3,})\b/g, (_m, a: string, b: string) => `${a}.${b[0]}`);
  // list indexes "[0]" and the planner's markers
  s = s.replace(/\s*\[\d{1,2}\]\s*/g, " ");
  s = s.replace(/\(\s*ASSUMPTION\s*\)/g, ASSUMPTION[lang]);
  s = s.replace(/\bASSUMPTION\s*:/g, ASSUMPTION_LABEL[lang]);
  // the tools' English wording → the business language
  if (lang !== "en") for (const [re, he, ar] of PHRASES) s = s.replace(re, lang === "he" ? he : ar);
  // left-over punctuation from removed parts: "( , )", ", ,", "( )"
  s = s.replace(/\(\s*[,·]?\s*\)/g, "").replace(/\(\s*,\s*/g, "(").replace(/,\s*\)/g, ")");
  s = s.replace(/\s+,/g, ",").replace(/,\s*,/g, ",").replace(/·\s*·/g, "·");
  s = s.replace(/\s{2,}/g, " ").replace(/\s+([.;:)])/g, "$1").trim();
  return s;
}
