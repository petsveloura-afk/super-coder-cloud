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
  // additive: the business-radar titles
  { re: /^(\d+) hot lead\(s\) are waiting for a person \(longest (\d+)h\)$/i, he: (m) => `${m[1]} לידים חמים מחכים לאדם (הכי ותיק: ${m[2]} שעות)`, ar: (m) => `${m[1]} عملاء محتملون مهتمون ينتظرون شخصًا (الأقدم: ${m[2]} ساعات)` },
  { re: /^(\d+) overdue payment\(s\) — (.+) \(up to (\d+) days late\)$/i, he: (m) => `${m[1]} תשלומים באיחור — ${m[2]} (עד ${m[3]} ימי איחור)`, ar: (m) => `${m[1]} مدفوعات متأخرة — ${m[2]} (حتى ${m[3]} يومًا تأخيرًا)` },
  { re: /^(\d+) dormant deal\(s\) worth (.+)$/i, he: (m) => `${m[1]} עסקאות רדומות בשווי ${m[2]}`, ar: (m) => `${m[1]} صفقات خاملة بقيمة ${m[2]}` },
  { re: /^(\d+) customer\(s\) waited over 4 hours \(longest (\d+)h\)$/i, he: (m) => `${m[1]} לקוחות חיכו יותר מ-4 שעות (הכי ארוך: ${m[2]} שעות)`, ar: (m) => `${m[1]} عملاء انتظروا أكثر من 4 ساعات (الأطول: ${m[2]} ساعات)` },
  { re: /^Leads dropped: (\d+) yesterday vs ([\d.]+) on average$/i, he: (m) => `ירידה בלידים: ${m[1]} אתמול לעומת ${m[2]} בממוצע`, ar: (m) => `انخفاض العملاء المحتملين: ${m[1]} أمس مقابل ${m[2]} في المتوسط` },
  { re: /^Lead surge: (\d+) yesterday vs ([\d.]+) on average$/i, he: (m) => `זינוק בלידים: ${m[1]} אתמול לעומת ${m[2]} בממוצע`, ar: (m) => `قفزة في العملاء المحتملين: ${m[1]} أمس مقابل ${m[2]} في المتوسط` },
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

/* additive: more of the lines the team writes (they were shown in English to Hebrew / Arabic businesses) */
const RULES_MORE: Rule[] = [
  { re: /^Employee hired: (.*) \(([a-z_]+)\)$/i, he: (m) => `עובד/ת חדש/ה בצוות: ${m[1]}`, ar: (m) => `انضم موظف جديد للفريق: ${m[1]}` },
  { re: /^Employee updated: (.*) \(([a-z_]+)\)$/i, he: (m) => `פרטי העובד/ת עודכנו: ${m[1]}`, ar: (m) => `تم تحديث بيانات الموظف: ${m[1]}` },
  { re: /^Employee duplicated: (.*)$/i, he: (m) => `העובד/ת שוכפל/ה: ${m[1]}`, ar: (m) => `تم نسخ الموظف: ${m[1]}` },
  { re: /^Team turned on\.?$/i, he: () => "הצוות הופעל.", ar: () => "تم تشغيل الفريق." },
  { re: /^Team turned off\.?$/i, he: () => "הצוות כובה.", ar: () => "تم إيقاف الفريق." },
  { re: /^The team is turned off\.?$/i, he: () => "הצוות כבוי.", ar: () => "الفريق متوقف." },
  { re: /^EMERGENCY STOP — the team is frozen\.?$/i, he: () => "עצירת חירום — כל הצוות הוקפא.", ar: () => "إيقاف طارئ — تم تجميد الفريق." },
  { re: /^Emergency stop is on — the team is frozen\.?$/i, he: () => "עצירת חירום פעילה — הצוות מוקפא.", ar: () => "الإيقاف الطارئ مفعّل — الفريق مجمّد." },
  { re: /^Emergency stop released\.?$/i, he: () => "עצירת החירום בוטלה.", ar: () => "تم إلغاء الإيقاف الطارئ." },
  { re: /^Team settings saved\.?$/i, he: () => "הגדרות הצוות נשמרו.", ar: () => "تم حفظ إعدادات الفريق." },
  { re: /^Team operations settings saved\.?$/i, he: () => "הגדרות התפעול של הצוות נשמרו.", ar: () => "تم حفظ إعدادات تشغيل الفريق." },
  { re: /^Owner answered an employee's question\.?$/i, he: () => "הבעלים ענו על שאלה של עובד/ת.", ar: () => "أجاب المالك عن سؤال موظف." },
  { re: /^Playbook additions saved: (.*)$/i, he: (m) => `נשמרו תוספות לספר התפקיד: ${m[1]!.replace(/_/g, " ")}`, ar: (m) => `تم حفظ إضافات دليل الدور: ${m[1]!.replace(/_/g, " ")}` },
  { re: /^Task canceled \((\d+)\)$/i, he: (m) => `המשימה בוטלה (${m[1]})`, ar: (m) => `أُلغيت المهمة (${m[1]})` },
  { re: /^Memory (confirm|revoke|delete|edit|add|reset)$/i, he: (m) => ({ confirm: "זיכרון אושר", revoke: "זיכרון בוטל", delete: "זיכרון נמחק", edit: "זיכרון נערך", add: "זיכרון נוסף", reset: "הזיכרון אופס" })[m[1]!.toLowerCase() as "add"], ar: (m) => ({ confirm: "تم تأكيد ذاكرة", revoke: "تم إلغاء ذاكرة", delete: "تم حذف ذاكرة", edit: "تم تعديل ذاكرة", add: "تمت إضافة ذاكرة", reset: "تمت إعادة ضبط الذاكرة" })[m[1]!.toLowerCase() as "add"] },
  { re: /^Fact: (.*)$/i, he: (m) => `עובדה: ${m[1]}`, ar: (m) => `حقيقة: ${m[1]}` },
  { re: /^Self-check passed\.?$/i, he: () => "הבדיקה העצמית עברה.", ar: () => "اجتاز الفحص الذاتي." },
  { re: /^Still (\d+) issue\(s\) after the fix — the owner will decide\.?$/i, he: (m) => `נשארו ${m[1]} ליקויים אחרי התיקון — ההחלטה אצל הבעלים.`, ar: (m) => `بقيت ${m[1]} ملاحظات بعد التصحيح — القرار للمالك.` },
  { re: /^(\d+) steps · deliverable: ([a-z_]+)(.*)$/i, he: (m) => `${m[1]} צעדים · תוצר: ${({ none: "ללא", text: "טקסט", report: "דוח", message: "הודעה", review_reply: "תגובה לביקורת", reminder: "תזכורת" } as Record<string, string>)[m[2]!] ?? m[2]}${(m[3] ?? "").replace(/est\. (\d+) credits/i, "הערכה $1 קרדיטים").replace(/customer-facing/i, "מול לקוח")}`, ar: (m) => `${m[1]} خطوات · المخرج: ${m[2]}${(m[3] ?? "").replace(/est\. (\d+) credits/i, "التقدير $1 رصيد")}` },
  { re: /^Decision \((fast|deep)(?:: ([^)]*))?\) — (.*?) · confidence (\d+)%(?: · audit: (approve|revise|escalate))?$/i, he: (m) => `החלטה (${m[1] === "deep" ? "מסלול זהיר" : "מסלול מהיר"}) — ${m[3]} · ביטחון ${m[4]}%${m[5] ? ` · ביקורת: ${({ approve: "אושר", revise: "נדרש תיקון", escalate: "הועבר לבעלים" } as Record<string, string>)[m[5]]}` : ""}`, ar: (m) => `قرار (${m[1] === "deep" ? "مسار حذر" : "مسار سريع"}) — ${m[3]} · الثقة ${m[4]}%${m[5] ? ` · التدقيق: ${({ approve: "موافق", revise: "يحتاج تصحيحًا", escalate: "أُحيل للمالك" } as Record<string, string>)[m[5]]}` : ""}` },
  { re: /^Held for the owner: ([a-z_.]+) — (.*)$/i, he: (m) => `הוחזק לאישור הבעלים: ${m[1]} — בדיקת ההחלטה לא אישרה אותו.`, ar: (m) => `محتجز لموافقة المالك: ${m[1]} — لم توافق مراجعة القرار عليه.` },
  { re: /^Cannot send: (.*)\.$/i, he: (m) => `לא ניתן לשלוח: ${m[1]}.`, ar: (m) => `لا يمكن الإرسال: ${m[1]}.` },
  { re: /^The output is ready but cannot be sent \((.*)\) — kept for the owner\.?$/i, he: (m) => `התוצר מוכן אבל לא נשלח (${m[1]}) — נשמר עבור הבעלים.`, ar: (m) => `المخرج جاهز لكن لم يُرسل (${m[1]}) — محفوظ للمالك.` },
  { re: /^([a-z_.]+): invalid arguments \((.*)\)\.?$/i, he: (m) => `${m[1]}: פרטים חסרים או שגויים (${m[2]}).`, ar: (m) => `${m[1]}: بيانات ناقصة أو خاطئة (${m[2]}).` },
  { re: /^Blocked: "([^"]+)" is not a platform tool\.?$/i, he: (m) => `נחסם: "${m[1]}" אינו כלי של הפלטפורמה.`, ar: (m) => `محظور: "${m[1]}" ليست أداة في المنصة.` },
  { re: /^Handoff to ([a-z_]+) prevented \(loop \/ depth limit\)\.?$/i, he: (m) => `ההעברה ל-${m[1]!.replace(/_/g, " ")} נמנעה (מגבלת לולאה / עומק).`, ar: (m) => `تم منع التحويل إلى ${m[1]!.replace(/_/g, " ")} (حد التكرار / العمق).` },
  { re: /^Held back: ([a-z_.]+) \((.*)\)\.?$/i, he: (m) => `הושהה: ${m[1]} (${m[2]}).`, ar: (m) => `تم التعليق: ${m[1]} (${m[2]}).` },
  { re: /^Not allowed: ([a-z_.]+) \((.*)\)\.?$/i, he: (m) => `לא מורשה: ${m[1]} (${m[2]}).`, ar: (m) => `غير مسموح: ${m[1]} (${m[2]}).` },
  { re: /^Stopped the remaining steps: (.*)\.$/i, he: (m) => `שאר הצעדים נעצרו: ${m[1]}.`, ar: (m) => `توقفت بقية الخطوات: ${m[1]}.` },
  { re: /^Unusual behaviour \((.*)\) — write actions are paused until a person looks\.?$/i, he: (m) => `התנהגות חריגה (${m[1]}) — פעולות כתיבה מושהות עד שאדם יבדוק.`, ar: (m) => `سلوك غير عادي (${m[1]}) — أُوقفت إجراءات الكتابة حتى يتحقق شخص.` },
  { re: /^First confirmation \(([a-z_]+)\) — a second confirmation is needed before it runs\.?$/i, he: () => "אישור ראשון התקבל — נדרש אישור שני לפני הביצוע.", ar: () => "تم التأكيد الأول — يلزم تأكيد ثانٍ قبل التنفيذ." },
  { re: /^Memory upkeep started\.?$/i, he: () => "תחזוקת הזיכרון התחילה.", ar: () => "بدأت صيانة الذاكرة." },
  { re: /^Memory upkeep: (\d+) merged, (\d+) conflicts settled, (\d+) faded \(kept, marked expired\)\.?$/i, he: (m) => `תחזוקת זיכרון: ${m[1]} אוחדו, ${m[2]} סתירות נפתרו, ${m[3]} סומנו כפגי תוקף (נשמרו).`, ar: (m) => `صيانة الذاكرة: دُمجت ${m[1]}، حُسمت ${m[2]} تعارضات، ${m[3]} انتهت صلاحيتها (محفوظة).` },
  { re: /^The AI did not answer \(all engines busy\) — the task will be retried\.?$/i, he: () => "מנועי ה-AI לא ענו (כולם עמוסים) — המשימה תנוסה שוב לבד.", ar: () => "لم تُجب محركات الذكاء الاصطناعي (كلها مشغولة) — ستُعاد المحاولة تلقائيًا." },
  // resilience upgrade (additive): lines that stayed in English
  { re: /^The first answer was unreadable — the second attempt worked\.?$/i, he: () => "התשובה הראשונה לא הייתה קריאה — הניסיון השני הצליח.", ar: () => "الإجابة الأولى لم تكن مقروءة — المحاولة الثانية نجحت." },
  { re: /^The first answer was unreadable and the second attempt failed too\.?$/i, he: () => "התשובה הראשונה לא הייתה קריאה וגם הניסיון השני נכשל — ננסה שוב בקרוב.", ar: () => "الإجابة الأولى لم تكن مقروءة وفشلت المحاولة الثانية أيضًا — سنحاول مجددًا قريبًا." },
  { re: /^Could not write the output \(AI busy\)\.?$/i, he: () => "לא הצלחתי לכתוב את התוצר (מנועי ה-AI עמוסים) — ננסה שוב לבד.", ar: () => "تعذّرت كتابة الناتج (محركات الذكاء الاصطناعي مشغولة) — ستُعاد المحاولة تلقائيًا." },
  { re: /^goal: (.+)$/i, he: (m) => `מטרה: ${m[1]}`, ar: (m) => `الهدف: ${m[1]}` },
  { re: /^([^:]{1,60}): (approve|revise)(.*)$/i, he: (m) => `${m[1]}: ${m[2]!.toLowerCase() === "approve" ? "אישר/ה" : "ביקש/ה תיקון"}${m[3] ?? ""}`, ar: (m) => `${m[1]}: ${m[2]!.toLowerCase() === "approve" ? "وافق" : "طلب تصحيحًا"}${m[3] ?? ""}` },
];

/** the line starts in English (a Hebrew name inside it — "Employee hired: ולדימיר" — must not stop the translation) */
const startsLatin = (s: string) => {
  const first = s.trim().match(/[A-Za-z\u0590-\u05FF\u0600-\u06FF]/);
  return Boolean(first && /[A-Za-z]/.test(first[0]));
};

/** a display text for an activity-log line / error in the business's language (unchanged when not recognized) */
export function localizeLog(text: string, lang: Lang): string {
  if (lang === "en" || !text) return text;
  if (hasLocal(text) && !startsLatin(text)) return text;
  const s = text.trim();
  for (const r of [...RULES, ...RULES_MORE]) {
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

/* ------------------------------------------------------------------ tool lines in the team log ("goals.list: no goals recorded") */
type Pair2 = { he: string; ar: string };
const TOOL_SUMMARY: Record<string, Pair2> = {
  "no contacts found": { he: "לא נמצאו אנשי קשר", ar: "لم يتم العثور على جهات اتصال" },
  "no customer is waiting": { he: "אף לקוח לא ממתין", ar: "لا يوجد عميل ينتظر" },
  "no experiments recorded": { he: "אין ניסויים רשומים", ar: "لا توجد تجارب مسجلة" },
  "no open tasks": { he: "אין משימות פתוחות", ar: "لا توجد مهام مفتوحة" },
  "no overdue invoices": { he: "אין חשבוניות באיחור", ar: "لا توجد فواتير متأخرة" },
  "no recent reviews": { he: "אין ביקורות אחרונות", ar: "لا توجد مراجعات حديثة" },
  "no stored report yet": { he: "עוד אין דוח שמור", ar: "لا يوجد تقرير محفوظ بعد" },
  "no websites yet": { he: "עוד אין אתרים", ar: "لا توجد مواقع بعد" },
  "the board is empty": { he: "הלוח ריק", ar: "اللوحة فارغة" },
  "no goals recorded": { he: "אין יעדים רשומים", ar: "لا توجد أهداف مسجلة" },
  "no deals quiet for 7+ days": { he: "אין עסקאות שקטות מעל 7 ימים", ar: "لا توجد صفقات خاملة منذ 7 أيام أو أكثر" },
  "note added": { he: "נוספה הערה", ar: "تمت إضافة ملاحظة" },
  "remembered about the customer": { he: "נשמר בזיכרון על הלקוח", ar: "تم الحفظ في ذاكرة العميل" },
  "posted on the board": { he: "פורסם בלוח הצוות", ar: "نُشر على لوحة الفريق" },
  "message sent to the customer": { he: "ההודעה נשלחה ללקוח", ar: "أُرسلت الرسالة إلى العميل" },
  "reply draft saved on the review": { he: "טיוטת תגובה נשמרה על הביקורת", ar: "حُفظت مسودة رد على المراجعة" },
  "experiment proposed — waiting for the owner to start it": { he: "הוצע ניסוי — ממתין שהבעלים יפעילו אותו", ar: "تم اقتراح تجربة — بانتظار تشغيلها من المالك" },
};
const TOOL_SUMMARY_RULES: { re: RegExp; he: (m: RegExpMatchArray) => string; ar: (m: RegExpMatchArray) => string }[] = [
  { re: /^(\d+) posts in 30 days\. Top: (.*)$/i, he: (m) => `${m[1]} פוסטים ב-30 ימים. המובילים: ${m[2] === "—." || m[2] === "—" ? "—" : m[2]}`, ar: (m) => `${m[1]} منشورات خلال 30 يومًا. الأفضل: ${m[2]}` },
  { re: /^tagged #(.*)$/i, he: (m) => `סומן בתגית #${m[1]}`, ar: (m) => `وُسم بـ #${m[1]}` },
  { re: /^deal opened: (.*)$/i, he: (m) => `נפתחה עסקה: ${m[1]}`, ar: (m) => `فُتحت صفقة: ${m[1]}` },
  { re: /^deal updated: (.*)$/i, he: (m) => `העסקה עודכנה: ${m[1]}`, ar: (m) => `تم تحديث الصفقة: ${m[1]}` },
  { re: /^task created: (.*)$/i, he: (m) => `נוצרה משימה: ${m[1]}`, ar: (m) => `أُنشئت مهمة: ${m[1]}` },
  { re: /^campaign draft saved: (.*)$/i, he: (m) => `טיוטת קמפיין נשמרה: ${m[1]}`, ar: (m) => `حُفظت مسودة حملة: ${m[1]}` },
  { re: /^meeting booked (.*)$/i, he: (m) => `נקבעה פגישה ${m[1]!.replace("T", " ")}`, ar: (m) => `تم حجز اجتماع ${m[1]!.replace("T", " ")}` },
  { re: /^post scheduled for (.*)$/i, he: (m) => `הפוסט תוזמן ל-${m[1]!.replace("T", " ")}`, ar: (m) => `جُدول المنشور في ${m[1]!.replace("T", " ")}` },
  { re: /^(\d+) post drafts planned(.*)$/i, he: (m) => `תוכננו ${m[1]} טיוטות פוסטים`, ar: (m) => `تم تخطيط ${m[1]} مسودات منشورات` },
  { re: /^([a-z_]+) agent ran: (\d+) (action|reminder)\(s\)$/i, he: (m) => `הסוכן רץ: ${m[2]} פעולות`, ar: (m) => `تم تشغيل الوكيل: ${m[2]} إجراءات` },
  { re: /^post draft created \((.*)\) id (.*)$/i, he: () => "נוצרה טיוטת פוסט", ar: () => "أُنشئت مسودة منشور" },
  { re: /^(\d+) procedure\(s\)$/i, he: (m) => `${m[1]} נהלים`, ar: (m) => `${m[1]} إجراءات` },
];

/** "tool.key: summary" lines: the tool's name from the screen's dictionary (when given) and the summary in the business language */
export function localizeToolLine(text: string, lang: Lang, toolLabel?: (key: string) => string | null): string {
  if (lang === "en" || !text) return text;
  const m = /^([a-z_]+\.[a-z_]+): (.*)$/s.exec(text.trim());
  if (!m) return text;
  const label = (toolLabel?.(m[1]!) ?? null) || m[1]!;
  const sum = m[2]!.trim();
  if (hasLocal(sum) && !/^[A-Za-z]/.test(sum)) return `${label}: ${sum}`;
  const p = TOOL_SUMMARY[sum.replace(/[.\s]+$/, "").toLowerCase()];
  if (p) return `${label}: ${p[lang]}`;
  for (const r of TOOL_SUMMARY_RULES) {
    const x = sum.match(r.re);
    if (x) return `${label}: ${r[lang](x)}`;
  }
  return `${label}: ${sum}`;
}
