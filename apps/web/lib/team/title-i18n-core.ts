/**
 * Upgrade 8 / stage A — display translation of old English task titles and activity-log lines into the business's language
 * (pure, unit-tested). The database is NOT changed: this only changes what the screen shows. New titles are created in the
 * business's language by `titleInstruction`, which is added to the planning prompt.
 */
export type Lang = "he" | "en" | "ar";

const hasLocal = (s: string) => /[\u0590-\u05FF\u0600-\u06FF]/.test(s);
const hasLatin = (s: string) => /[A-Za-z]{3,}/.test(s);

type Pair = { he: string; ar: string };
/** whole-title phrases (case-insensitive, trailing punctuation ignored) */
const PHRASES: Record<string, Pair> = {
  "publish posts": { he: "פרסום פוסטים", ar: "نشر المنشورات" },
  "define post content & cta": { he: "הגדרת תוכן הפוסט וקריאה לפעולה", ar: "تحديد محتوى المنشور ودعوة لاتخاذ إجراء" },
  "define post content and cta": { he: "הגדרת תוכן הפוסט וקריאה לפעולה", ar: "تحديد محتوى المنشور ودعوة لاتخاذ إجراء" },
  "weekly team meeting": { he: "ישיבת צוות שבועית", ar: "اجتماع الفريق الأسبوعي" },
  "plan weekly content": { he: "תכנון תוכן שבועי", ar: "تخطيط المحتوى الأسبوعي" },
  "follow up with leads": { he: "מעקב אחרי לידים", ar: "متابعة العملاء المحتملين" },
  "reply to customers": { he: "מענה ללקוחות", ar: "الرد على العملاء" },
  "review campaign results": { he: "בדיקת תוצאות הקמפיין", ar: "مراجعة نتائج الحملة" },
  "leads dropped sharply — find out why": { he: "ירידה חדה בלידים — לברר למה", ar: "انخفاض حاد في العملاء المحتملين — معرفة السبب" },
};

/** word lexicon for titles made of known words only */
const WORDS: Record<string, Pair> = {
  publish: { he: "פרסום", ar: "نشر" }, posts: { he: "פוסטים", ar: "المنشورات" }, post: { he: "פוסט", ar: "منشور" }, plan: { he: "תכנון", ar: "تخطيط" }, write: { he: "כתיבת", ar: "كتابة" }, draft: { he: "טיוטת", ar: "مسودة" }, review: { he: "בדיקת", ar: "مراجعة" }, report: { he: "דוח", ar: "تقرير" }, weekly: { he: "שבועי", ar: "أسبوعي" }, monthly: { he: "חודשי", ar: "شهري" }, daily: { he: "יומי", ar: "يومي" }, content: { he: "תוכן", ar: "المحتوى" }, campaign: { he: "קמפיין", ar: "الحملة" }, leads: { he: "לידים", ar: "العملاء المحتملين" }, lead: { he: "ליד", ar: "عميل محتمل" }, customers: { he: "לקוחות", ar: "العملاء" }, customer: { he: "לקוח", ar: "العميل" }, invoices: { he: "חשבוניות", ar: "الفواتير" }, overdue: { he: "באיחור", ar: "المتأخرة" }, reviews: { he: "ביקורות", ar: "المراجعات" }, website: { he: "אתר", ar: "الموقع" }, site: { he: "אתר", ar: "الموقع" }, schedule: { he: "תזמון", ar: "جدولة" }, send: { he: "שליחת", ar: "إرسال" }, follow: { he: "מעקב", ar: "متابعة" }, up: { he: "", ar: "" }, analyze: { he: "ניתוח", ar: "تحليل" }, summary: { he: "סיכום", ar: "ملخص" }, offer: { he: "הצעה", ar: "عرض" }, proposal: { he: "הצעת מחיר", ar: "عرض سعر" },
};

const norm = (s: string) => s.trim().replace(/[.!:;\s]+$/g, "").replace(/\s+/g, " ").toLowerCase();

/** a display title in the business's language (unchanged when already in it, or when not recognized) */
/** wave 64+: the daily initiative titles that carry a number (they are created by the insight rules in English) */
const TITLE_RULES: { re: RegExp; he: (m: RegExpMatchArray) => string; ar: (m: RegExpMatchArray) => string }[] = [
  { re: /^Reach (\d+) new lead\(s\) that got no reply$/i, he: (m) => `לפנות ל-${m[1]} לידים חדשים שלא קיבלו מענה`, ar: (m) => `التواصل مع ${m[1]} عملاء محتملين جدد لم يتلقوا ردًا` },
  { re: /^Answer (\d+) negative review\(s\)$/i, he: (m) => `לענות על ${m[1]} ביקורות שליליות`, ar: (m) => `الرد على ${m[1]} مراجعات سلبية` },
  { re: /^(\d+) conversation\(s\) waiting for an answer$/i, he: (m) => `${m[1]} שיחות שממתינות למענה`, ar: (m) => `${m[1]} محادثات بانتظار الرد` },
  { re: /^Revive (\d+) stuck deal\(s\)$/i, he: (m) => `להחיות ${m[1]} עסקאות תקועות`, ar: (m) => `إحياء ${m[1]} صفقات متعثرة` },
  { re: /^(\d+) overdue invoice\(s\)$/i, he: (m) => `${m[1]} חשבוניות באיחור`, ar: (m) => `${m[1]} فواتير متأخرة` },
  { re: /^No post for (\d+) days$/i, he: (m) => `אין פוסט כבר ${m[1]} ימים`, ar: (m) => `لا يوجد منشور منذ ${m[1]} أيام` },
];

export function localizeTitle(title: string, lang: Lang): string {
  if (lang === "en" || !title || hasLocal(title) || !hasLatin(title)) return title;
  const p = PHRASES[norm(title)];
  if (p) return p[lang];
  for (const r of TITLE_RULES) {
    const m = title.trim().match(r.re);
    if (m) return r[lang](m);
  }
  const words = norm(title).replace(/[&,]/g, " ").split(" ").filter(Boolean);
  if (words.length && words.length <= 6 && words.every((w) => w in WORDS)) {
    const t = words.map((w) => WORDS[w]![lang]).filter(Boolean).join(" ");
    return t || title;
  }
  return title;
}

type Rule = { re: RegExp; he: (m: RegExpMatchArray) => string; ar: (m: RegExpMatchArray) => string };
const RULES: Rule[] = [
  { re: /^Loaded the business profile, (\d+) memories and the (.+?) playbook\.?$/i, he: (m) => `נטענו פרופיל העסק, ${m[1]} זיכרונות ונוהל העבודה של "${m[2]!.replace(/_/g, " ")}".`, ar: (m) => `تم تحميل ملف النشاط و${m[1]} ذكريات ودليل عمل "${m[2]!.replace(/_/g, " ")}".` },
  { re: /^The plan could not be read\.?$/i, he: () => "לא הצלחתי לקרוא את התוכנית — ננסה שוב.", ar: () => "تعذّرت قراءة الخطة — ستتم إعادة المحاولة." },
  { re: /^Model fallback used (\d+)×(.*)$/i, he: (m) => `הופעל מנוע חלופי ${m[1]} פעמים${m[2] ?? ""}`, ar: (m) => `تم استخدام محرّك بديل ${m[1]} مرات${m[2] ?? ""}` },
  { re: /^Weekly team meeting summary is ready\.?$/i, he: () => "סיכום ישיבת הצוות השבועית מוכן.", ar: () => "ملخص اجتماع الفريق الأسبوعي جاهز." },
  { re: /^Plan approved — (\d+) tasks on the board\.?$/i, he: (m) => `התוכנית אושרה — ${m[1]} משימות עלו ללוח.`, ar: (m) => `تمت الموافقة على الخطة — ${m[1]} مهام على اللوحة.` },
  { re: /^Goal finished: (\d+)\/(\d+) tasks done\.?$/i, he: (m) => `היעד הסתיים: ${m[1]} מתוך ${m[2]} משימות הושלמו.`, ar: (m) => `انتهى الهدف: اكتملت ${m[1]} من ${m[2]} مهام.` },
  { re: /^Plan for "(.*)": (\d+) tasks, est\. (\d+) credits\.?$/i, he: (m) => `תוכנית ל"${m[1]}": ${m[2]} משימות, הערכה ${m[3]} קרדיטים.`, ar: (m) => `خطة لـ"${m[1]}": ${m[2]} مهام، التقدير ${m[3]} رصيدًا.` },
  { re: /^Asked the owner(?: one question)?: (.*)$/i, he: (m) => `נשאלה שאלה לבעלים: ${m[1]}`, ar: (m) => `تم سؤال المالك: ${m[1]}` },
  { re: /^Waiting for approval: (.*)$/i, he: (m) => `ממתין לאישור: ${m[1]}`, ar: (m) => `بانتظار الموافقة: ${m[1]}` },
  { re: /^Rejected by the owner(.*)$/i, he: (m) => `נדחה על ידי הבעלים${m[1] ?? ""}`, ar: (m) => `رفضه المالك${m[1] ?? ""}` },
  { re: /^Approved(?: \(edited\))? and done: (.*)$/i, he: (m) => `אושר ובוצע: ${m[1]}`, ar: (m) => `تمت الموافقة والتنفيذ: ${m[1]}` },
  { re: /^Approved but failed: (.*)$/i, he: (m) => `אושר אך נכשל: ${m[1]}`, ar: (m) => `تمت الموافقة لكن فشل: ${m[1]}` },
  { re: /^Self-check found (\d+) issue\(s\) — fixing\.?$/i, he: (m) => `בדיקה עצמית מצאה ${m[1]} ליקויים — מתקן.`, ar: (m) => `وجد الفحص الذاتي ${m[1]} ملاحظات — جارٍ التصحيح.` },
  { re: /^Stopped: (.*)\.$/i, he: (m) => `נעצר: ${m[1]!.replace(/_/g, " ")}.`, ar: (m) => `توقف: ${m[1]!.replace(/_/g, " ")}.` },
  { re: /^Needs a person: (.*)\.$/i, he: (m) => `נדרש אדם: ${m[1]}.`, ar: (m) => `يتطلب تدخل شخص: ${m[1]}.` },
  { re: /^Report ready\.?$/i, he: () => "הדוח מוכן.", ar: () => "التقرير جاهز." },
  { re: /^Output ready\.?$/i, he: () => "התוצר מוכן.", ar: () => "المخرج جاهز." },
  { re: /^(.+) noticed: (.*)$/i, he: (m) => `${m[1]} שם לב: ${localizeTitle(m[2]!, "he")}`, ar: (m) => `${m[1]} لاحظ: ${localizeTitle(m[2]!, "ar")}` },
];

/** a display text for an activity-log line / error in the business's language (unchanged when not recognized) */
export function localizeLog(text: string, lang: Lang): string {
  if (lang === "en" || !text || hasLocal(text)) return text;
  const s = text.trim();
  for (const r of RULES) {
    const m = s.match(r.re);
    if (m) return r[lang](m);
  }
  return text;
}

/** added to the planning prompt so NEW goals / tasks are written in the business's language */
export function titleInstruction(lang: Lang): string {
  const name = lang === "he" ? "Hebrew" : lang === "ar" ? "Arabic" : "English";
  return `Write every task title and brief in ${name} (the business's language) — short, starting with a verb. Do not write titles in English unless that is the business's language.`;
}
