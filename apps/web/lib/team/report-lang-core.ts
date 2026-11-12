/**
 * Round 13 — the owner's reports in the business's language (pure, unit-tested).
 *
 * The report standard (doctrine.ts) is written in English for the model, and the model used to copy its section labels
 * verbatim into a Hebrew report: "Bottom line first:", "Key findings:", "Root causes:", "Quick wins (this week)",
 * "FACT / INFERENCE / ASSUMPTION", "impact · effort · owner". Two additive fixes:
 *   • `reportStandardFor(lang)` — the same standard plus an explicit instruction with the exact local headings and tags
 *   • `localizeReportText(text, lang)` — display-only: reports that were already saved with English labels are shown with
 *     the local labels (the database is not changed). English businesses see exactly what they saw before.
 */
import { REPORT_STANDARD } from "./doctrine";

export type Lang = "he" | "en" | "ar";

type Pair = { he: string; ar: string };

/** section headings — the longest phrases first so "Quick wins (this week)" wins over "Quick wins" */
const HEADINGS: [RegExp, Pair][] = [
  [/bottom line first|bottom line|executive summary|tl;?dr/i, { he: "בשורה התחתונה", ar: "الخلاصة" }],
  [/key findings|main findings|findings/i, { he: "ממצאים עיקריים", ar: "النتائج الرئيسية" }],
  [/root causes?/i, { he: "סיבות שורש", ar: "الأسباب الجذرية" }],
  [/quick wins \(this week\)|quick wins/i, { he: "ניצחונות מהירים (השבוע)", ar: "مكاسب سريعة (هذا الأسبوع)" }],
  [/structural fixes \(this month\)|structural fixes/i, { he: "תיקונים מבניים (החודש)", ar: "إصلاحات هيكلية (هذا الشهر)" }],
  [/recommendations|recommended actions/i, { he: "המלצות", ar: "التوصيات" }],
  [/risks and what could be wrong(?: with this analysis)?|risks/i, { he: "סיכונים ומה עלול להיות שגוי", ar: "المخاطر وما قد يكون خاطئًا" }],
  [/data we still need|missing data|what is still unknown|still unknown/i, { he: "נתונים שעוד חסרים", ar: "بيانات ما زالت ناقصة" }],
  [/confidence level|confidence/i, { he: "רמת ביטחון", ar: "مستوى الثقة" }],
  [/next steps|next actions/i, { he: "הצעדים הבאים", ar: "الخطوات التالية" }],
  [/experiment to run next|next experiment|experiment/i, { he: "ניסוי לביצוע", ar: "تجربة مقترحة" }],
];

/** inline labels inside a recommendation ("Impact: high · Effort: hours · Owner: Dana") */
const LABELS: [RegExp, Pair][] = [
  [/why it works/i, { he: "למה זה עובד", ar: "لماذا ينجح" }],
  [/how we will measure it|how to measure|measure(?:ment)?|kpi/i, { he: "איך נמדוד", ar: "كيف نقيس" }],
  [/impact/i, { he: "השפעה", ar: "الأثر" }],
  [/effort/i, { he: "מאמץ", ar: "الجهد" }],
  [/owner/i, { he: "אחראי", ar: "المسؤول" }],
  [/confidence/i, { he: "ביטחון", ar: "الثقة" }],
  [/deadline|due|when/i, { he: "מועד", ar: "الموعد" }],
  [/action/i, { he: "פעולה", ar: "الإجراء" }],
  [/hypothesis/i, { he: "השערה", ar: "الفرضية" }],
  [/metric/i, { he: "מדד", ar: "المقياس" }],
  [/duration/i, { he: "משך", ar: "المدة" }],
  [/success threshold/i, { he: "סף הצלחה", ar: "عتبة النجاح" }],
  [/evidence/i, { he: "ראיה", ar: "الدليل" }],
];

const VALUES: Record<string, Pair> = {
  high: { he: "גבוהה", ar: "مرتفع" },
  medium: { he: "בינונית", ar: "متوسط" },
  low: { he: "נמוכה", ar: "منخفض" },
  hours: { he: "שעות", ar: "ساعات" },
  days: { he: "ימים", ar: "أيام" },
  weeks: { he: "שבועות", ar: "أسابيع" },
};

const TAGS: Record<string, Pair> = {
  FACT: { he: "עובדה", ar: "حقيقة" },
  INFERENCE: { he: "הסקה", ar: "استنتاج" },
  ASSUMPTION: { he: "הנחה", ar: "افتراض" },
};

const hasLocal = (s: string) => /[֐-׿؀-ۿ]/.test(s);

/** the report standard + the exact local headings (English businesses get the standard unchanged) */
export function reportStandardFor(lang: Lang): string {
  if (lang === "en") return REPORT_STANDARD;
  const L = lang;
  const h = (i: number) => HEADINGS[i]![1][L];
  const lines = [
    REPORT_STANDARD,
    L === "he"
      ? "שפת הדוח: כתוב את כל הדוח בעברית בלבד — כולל כותרות הסעיפים, התגיות והתוויות. אל תכתוב אף אחת מהתוויות באנגלית שלמעלה."
      : "لغة التقرير: اكتب التقرير كله بالعربية فقط — بما في ذلك عناوين الأقسام والوسوم والتسميات. لا تكتب أيًا من التسميات الإنجليزية أعلاه.",
    `HEADINGS TO USE (exactly, in this order, only the ones you need): ${[0, 1, 2, 5, 3, 4, 6, 7, 8, 9].map(h).join(" · ")}`,
    `EVIDENCE TAGS: (${TAGS.FACT![L]}) / (${TAGS.INFERENCE![L]}) / (${TAGS.ASSUMPTION![L]}) — never FACT / INFERENCE / ASSUMPTION.`,
    `RECOMMENDATION LABELS: ${["action", "why it works", "impact", "effort", "owner", "how we will measure it"].map((w) => LABELS.find(([re]) => re.test(w))![1][L]).join(" · ")}; values ${VALUES.high![L]} / ${VALUES.medium![L]} / ${VALUES.low![L]}.`,
  ];
  return lines.join("\n");
}

/** a saved report shown with local headings, tags and labels (display only; English text / English businesses unchanged) */
export function localizeReportText(text: string, lang: Lang): string {
  if (lang === "en" || !text || !hasLocal(text)) return text;
  const L = lang;
  let s = text;
  // headings at the start of a line: "Key findings:", "**Root causes**", "## Recommendations", "• Quick wins (this week):"
  s = s.replace(/^([ \t]*(?:#{1,6}[ \t]*|[>*\-•·\d.)]+[ \t]*)?(?:\*\*|__)?)([A-Za-z][A-Za-z ;()'/-]{2,60}?)((?:\*\*|__)?[ \t]*(?:[:：—–-]|$))/gm, (all, pre: string, head: string, post: string) => {
    const hit = HEADINGS.find(([re]) => new RegExp(`^(?:${re.source})$`, "i").test(head.trim()));
    return hit ? `${pre}${hit[1][L]}${post}` : all;
  });
  // evidence tags (only the upper-case tags the standard asked for)
  s = s.replace(/\b(FACT|INFERENCE|ASSUMPTION)S?\b/g, (_m, tag: string) => TAGS[tag]![L]);
  // "Impact: high", "Effort: days", "Owner: Dana", "How we will measure it: …"
  s = s.replace(/(^|[\s(·|,;•*_-])([A-Za-z][A-Za-z ]{1,30}?)([ \t]*[:：][ \t]*)([A-Za-z]+)?/gm, (all, pre: string, label: string, colon: string, val: string | undefined) => {
    const hit = LABELS.find(([re]) => new RegExp(`^(?:${re.source})$`, "i").test(label.trim()));
    if (!hit) return all;
    const v = val ? (VALUES[val.toLowerCase()]?.[L] ?? val) : "";
    return `${pre}${hit[1][L]}${colon}${v}`;
  });
  // values written in parentheses after a label-less recommendation: "(impact high, effort low)"
  s = s.replace(/\b(impact|effort|confidence)[ \t]+(high|medium|low)\b/gi, (_m, label: string, val: string) => `${LABELS.find(([re]) => new RegExp(`^(?:${re.source})$`, "i").test(label))![1][L]} ${VALUES[val.toLowerCase()]![L]}`);
  return s;
}
