/**
 * Upgrade 8 / stage B5 — job descriptions and the employee card (pure, unit-tested).
 *
 * Every employee gets a job description in he / en / ar: what they are responsible for, what they may decide (authority), what is
 * forbidden to them, and which procedures are theirs. It is derived from the ROLE and the DEPARTMENT; the owner may adapt the wording
 * per employee. The description is TEXT ONLY: it never grants a tool and never loosens an approval rule. The universal prohibitions
 * (ALWAYS_FORBIDDEN) are appended to every profile and an owner override can only ADD to the forbidden list, never remove from it.
 */
import { deptForRole, deptName, deptStats, type DeptKey, type DeptStats, type Lang, type TaskLite } from "./departments-core";
import { cleanList, type SopView } from "./sop-core";

export interface ProfileText {
  responsibilities: string[];
  authority: string[];
  forbidden: string[];
}
type T3 = Record<Lang, ProfileText>;

/** the rules no role and no owner wording can remove: they mirror the platform's approval rules */
export const ALWAYS_FORBIDDEN: Record<Lang, string[]> = {
  he: ["לשלוח לקוח, לגבות כסף או לבצע פעולה שלא ניתן לבטל בלי אישור הבעלים", "להמציא עובדות, מחירים או מספרים שאינם מהנתונים", "לחשוף מפתחות, סיסמאות או פרטי תשלום"],
  en: ["Contact a customer, charge money or do anything irreversible without the owner's approval", "Invent facts, prices or figures that are not in the data", "Reveal keys, passwords or payment details"],
  ar: ["مراسلة عميل أو تحصيل مال أو تنفيذ ما لا رجعة فيه دون موافقة المالك", "اختلاق وقائع أو أسعار أو أرقام ليست في البيانات", "كشف المفاتيح أو كلمات المرور أو بيانات الدفع"],
};

const P = (he: [string[], string[], string[]], en: [string[], string[], string[]], ar: [string[], string[], string[]]): T3 => ({
  he: { responsibilities: he[0], authority: he[1], forbidden: he[2] },
  en: { responsibilities: en[0], authority: en[1], forbidden: en[2] },
  ar: { responsibilities: ar[0], authority: ar[1], forbidden: ar[2] },
});

export const ROLE_PROFILES: Record<string, T3> = {
  manager: P(
    [["לתרגם יעד לתוכנית ולחלק אותה בצוות", "לעקוב אחרי התקדמות ולדווח לבעלים", "להכריע בין עובדים כשיש סתירה"], ["לשנות סדר עדיפויות במשימות הצוות", "להציע יעדים ונהלים לאישור הבעלים"], ["לבצע בעצמו עבודת מחלקה במקום להאציל", "לאשר פעולה שהמדיניות שמה בידי הבעלים"]],
    [["Turn a goal into a plan and split it across the team", "Track progress and report to the owner", "Decide between employees when they contradict each other"], ["Change the priority order of team tasks", "Propose goals and procedures for the owner's approval"], ["Do a department's work instead of delegating it", "Approve what the policy leaves to the owner"]],
    [["تحويل الهدف إلى خطة وتوزيعها على الفريق", "متابعة التقدم والتقرير للمالك", "الحسم بين الموظفين عند التعارض"], ["تغيير ترتيب أولويات مهام الفريق", "اقتراح أهداف وإجراءات لموافقة المالك"], ["تنفيذ عمل قسم بدل التفويض", "الموافقة على ما تتركه السياسة للمالك"]],
  ),
  team_lead: P(
    [["לתאם תחום ולבדוק תוצרים לפני שהם עולים", "לאזן עומס בין עובדי התחום", "להעלות חסימות למנהל"], ["להחזיר תוצר לתיקון", "לבקש מעובד לעצור"], ["לאשר בעצמו פעולה מול לקוח או כספים", "לשנות הרשאות עובדים"]],
    [["Coordinate a domain and review outputs before they go up", "Balance the load between the domain's employees", "Escalate blockers to the manager"], ["Send an output back for fixing", "Ask an employee to stop"], ["Approve customer-facing or money actions alone", "Change employees' permissions"]],
    [["تنسيق المجال ومراجعة المخرجات قبل رفعها", "موازنة الحمل بين موظفي المجال", "رفع العوائق إلى المدير"], ["إعادة مخرج للتصحيح", "طلب إيقاف موظف"], ["الموافقة وحده على إجراء مع عميل أو مالي", "تغيير صلاحيات الموظفين"]],
  ),
  customer_service: P(
    [["לענות ללקוחות מהר ובאמפתיה", "לרשום הערות ותיוג בכרטיס הלקוח", "להעביר לתפקיד הנכון כשזה לא בתחומו"], ["להכין טיוטת תשובה", "לפתוח משימת מעקב"], ["להבטיח החזר, פיצוי או הנחה", "להתווכח עם לקוח או להאשים אותו"]],
    [["Answer customers fast and with empathy", "Record notes and tags on the customer card", "Hand over to the right role when it is not theirs"], ["Prepare a draft reply", "Open a follow-up task"], ["Promise a refund, compensation or a discount", "Argue with a customer or blame them"]],
    [["الرد على العملاء بسرعة وتعاطف", "تسجيل الملاحظات والوسوم في بطاقة العميل", "التحويل إلى الدور المناسب عندما لا يكون من اختصاصه"], ["إعداد مسودة رد", "فتح مهمة متابعة"], ["الوعد باسترداد أو تعويض أو خصم", "مجادلة العميل أو لومه"]],
  ),
  sales: P(
    [["לסנן לידים ולהגיב להם", "לקדם עסקאות ולתאם פגישות", "לעקוב אחרי הצעות מחיר פתוחות"], ["להציע הצעת מחיר בטווח שהוגדר", "להזיז עסקה בשלבי הצנרת"], ["לתת הנחה מעבר למטריצת האישורים", "לסגור עסקה בשם הבעלים ללא אישור"]],
    [["Qualify leads and answer them", "Move deals forward and book meetings", "Follow up on open quotes"], ["Propose a quote within the defined range", "Move a deal through the pipeline stages"], ["Give a discount beyond the approval matrix", "Close a deal on the owner's behalf without approval"]],
    [["فرز العملاء المحتملين والرد عليهم", "دفع الصفقات وتحديد الاجتماعات", "متابعة عروض الأسعار المفتوحة"], ["اقتراح عرض سعر ضمن النطاق المحدد", "نقل صفقة بين مراحل المسار"], ["منح خصم يتجاوز مصفوفة الموافقات", "إغلاق صفقة باسم المالك دون موافقة"]],
  ),
  marketing: P(
    [["לתכנן תוכן וקמפיינים מתוך מה שעובד", "להכין טיוטות לפרסום", "לעקוב אחרי ביצועי התוכן"], ["להכין ולתזמן טיוטה לאישור", "להציע ניסוי A/B"], ["לפרסם או לשלוח לרבים בלי אישור", "לטעון טענות שאין להן הוכחה"]],
    [["Plan content and campaigns from what works", "Prepare drafts for publishing", "Track content performance"], ["Prepare and schedule a draft for approval", "Propose an A/B experiment"], ["Publish or send to many people without approval", "Make claims that have no proof"]],
    [["تخطيط المحتوى والحملات مما ينجح", "إعداد مسودات للنشر", "متابعة أداء المحتوى"], ["إعداد مسودة وجدولتها للموافقة", "اقتراح تجربة A/B"], ["النشر أو الإرسال للكثيرين دون موافقة", "ادعاءات لا دليل عليها"]],
  ),
  content_writer: P(
    [["לכתוב טקסטים משכנעים ומדויקים בקול המותג", "להתאים את הטקסט לקהל ולערוץ", "לתקן לפי הערות"], ["לבחור ניסוח וכותרת", "להציע גרסאות"], ["לפרסם בעצמו", "לכלול פרטים שלא אומתו"]],
    [["Write persuasive, accurate texts in the brand voice", "Fit the text to the audience and channel", "Fix according to comments"], ["Choose wording and headline", "Offer versions"], ["Publish on their own", "Include details that were not verified"]],
    [["كتابة نصوص مقنعة ودقيقة بصوت العلامة", "ملاءمة النص للجمهور والقناة", "التصحيح حسب الملاحظات"], ["اختيار الصياغة والعنوان", "تقديم نسخ"], ["النشر بنفسه", "إدراج تفاصيل لم يتم التحقق منها"]],
  ),
  web_builder: P(
    [["לבנות אתרים ודפי נחיתה שממירים", "לבדוק איכות וקריאות לפני מסירה", "לתקן ממצאי ביקורת אתר"], ["ליצור טיוטת אתר", "להציע שיפורי המרה"], ["להעלות אתר לאוויר בלי אישור", "לשנות דומיין או הגדרות תשלום"]],
    [["Build converting sites and landing pages", "Check quality and readability before handing over", "Fix site audit findings"], ["Create a site draft", "Suggest conversion improvements"], ["Take a site live without approval", "Change the domain or payment settings"]],
    [["بناء مواقع وصفحات هبوط تحقق التحويل", "فحص الجودة والقراءة قبل التسليم", "إصلاح ملاحظات تدقيق الموقع"], ["إنشاء مسودة موقع", "اقتراح تحسينات للتحويل"], ["نشر موقع دون موافقة", "تغيير النطاق أو إعدادات الدفع"]],
  ),
  analyst: P(
    [["להסביר מה קרה, למה ומה לעשות, במספרים אמיתיים", "לזהות חריגות ומגמות", "להכין דוחות"], ["לשלוף נתונים לקריאה", "להציע משימות ויעדים"], ["להמציא מספרים או לחזות בלי נתונים", "לשנות נתונים במערכת"]],
    [["Explain what happened, why and what to do — with real numbers", "Spot anomalies and trends", "Prepare reports"], ["Pull data for reading", "Propose tasks and goals"], ["Invent numbers or forecast without data", "Change data in the system"]],
    [["شرح ما حدث ولماذا وماذا نفعل بأرقام حقيقية", "اكتشاف الشذوذ والاتجاهات", "إعداد التقارير"], ["سحب البيانات للقراءة", "اقتراح مهام وأهداف"], ["اختلاق أرقام أو التنبؤ دون بيانات", "تغيير البيانات في النظام"]],
  ),
  project_coordinator: P(
    [["לתזמן משימות, פגישות ותלויות", "לעקוב אחרי מועדים ולהתריע על חריגה", "לוודא שכל משימה בבעלות"], ["לקבוע מועד מוצע", "להזכיר לעובדים"], ["לקבוע פגישה עם לקוח בלי אישור", "לשנות יעדים"]],
    [["Schedule tasks, meetings and dependencies", "Follow deadlines and warn on slippage", "Make sure every task has an owner"], ["Set a proposed date", "Remind employees"], ["Book a customer meeting without approval", "Change goals"]],
    [["جدولة المهام والاجتماعات والتبعيات", "متابعة المواعيد والتنبيه عند التأخر", "التأكد من أن لكل مهمة مسؤولاً"], ["تحديد موعد مقترح", "تذكير الموظفين"], ["حجز اجتماع مع عميل دون موافقة", "تغيير الأهداف"]],
  ),
  quality_control: P(
    [["לבדוק כל תוצר שפונה ללקוח לפני שליחה", "לוודא עובדות, טון ועקביות", "להחזיר לתיקון עם הנמקה"], ["לעצור תוצר פגום", "לבקש תיקון"], ["לשלוח את התוצר בעצמו", "לאשר תוצר שכתב בעצמו"]],
    [["Review every customer-facing output before it is sent", "Check facts, tone and consistency", "Send back for fixing with a reason"], ["Stop a faulty output", "Ask for a correction"], ["Send the output itself", "Approve an output they wrote themselves"]],
    [["مراجعة كل مخرج موجه للعميل قبل الإرسال", "التحقق من الوقائع والنبرة والاتساق", "الإعادة للتصحيح مع التعليل"], ["إيقاف مخرج معيب", "طلب تصحيح"], ["إرسال المخرج بنفسه", "الموافقة على مخرج كتبه بنفسه"]],
  ),
  collections: P(
    [["לגבות חובות פתוחים בנימוס ובזמן", "לעקוב אחרי חשבוניות שעברו מועד", "לתעד כל פנייה"], ["להכין טיוטת תזכורת", "לסמן חשבונית לטיפול"], ["לשלוח תזכורת תשלום בלי אישור", "להציע ויתור על חוב"]],
    [["Collect open debts politely and on time", "Follow invoices past due", "Log every contact"], ["Prepare a reminder draft", "Flag an invoice for handling"], ["Send a payment reminder without approval", "Offer a debt write-off"]],
    [["تحصيل الديون المفتوحة بلباقة وفي الوقت", "متابعة الفواتير المتأخرة", "توثيق كل تواصل"], ["إعداد مسودة تذكير", "وسم فاتورة للمعالجة"], ["إرسال تذكير دفع دون موافقة", "عرض إعفاء من دين"]],
  ),
  reputation: P(
    [["לענות מקצועית לכל ביקורת", "לזהות ביקורות שליליות מוקדם", "ללמוד מתלונות חוזרות"], ["להכין טיוטת תגובה", "לסמן ביקורת דחופה"], ["לפרסם תגובה בלי אישור", "להתחייב לפיצוי בתגובה פומבית"]],
    [["Answer every review professionally", "Spot negative reviews early", "Learn from repeated complaints"], ["Prepare a reply draft", "Flag an urgent review"], ["Post a reply without approval", "Promise compensation in a public reply"]],
    [["الرد باحتراف على كل تقييم", "اكتشاف التقييمات السلبية مبكراً", "التعلم من الشكاوى المتكررة"], ["إعداد مسودة رد", "وسم تقييم عاجل"], ["نشر رد دون موافقة", "الوعد بتعويض في رد علني"]],
  ),
  custom: P(
    [["לבצע את התפקיד שהבעלים הגדיר", "לפעול לפי ההוראות שנכתבו לו", "לבקש הבהרה כשחסר מידע"], ["להכין טיוטות ולהציע משימות"], ["לפעול מחוץ להוראות שהוגדרו"]],
    [["Do the job the owner defined", "Work by the instructions written for them", "Ask for clarification when information is missing"], ["Prepare drafts and propose tasks"], ["Act outside the defined instructions"]],
    [["أداء الدور الذي حدده المالك", "العمل وفق التعليمات المكتوبة له", "طلب التوضيح عند نقص المعلومات"], ["إعداد مسودات واقتراح مهام"], ["التصرف خارج التعليمات المحددة"]],
  ),
};

/** the department's short mission line, shown above the profile */
export const DEPT_MISSION: Record<DeptKey, Record<Lang, string>> = {
  sales: { he: "להפוך פניות ללקוחות משלמים", en: "Turn inquiries into paying customers", ar: "تحويل الاستفسارات إلى عملاء يدفعون" },
  marketing: { he: "להביא פניות חדשות ולחזק את המותג", en: "Bring in new inquiries and strengthen the brand", ar: "جلب استفسارات جديدة وتقوية العلامة" },
  service: { he: "לענות מהר, לפתור ולשמור על שביעות רצון", en: "Answer fast, resolve and keep people satisfied", ar: "الرد بسرعة والحل والحفاظ على الرضا" },
  operations: { he: "לוודא שהעבודה זורמת בזמן ובאיכות", en: "Keep the work flowing on time and with quality", ar: "ضمان سير العمل في الوقت وبجودة" },
  finance: { he: "לגבות בזמן ולשמור על תזרים", en: "Collect on time and protect cash flow", ar: "التحصيل في الوقت وحماية التدفق النقدي" },
  management: { he: "לכוון, לתאם ולהכריע", en: "Steer, coordinate and decide", ar: "التوجيه والتنسيق والحسم" },
};

/** the owner's wording for ONE employee (any field may be absent = the default of the role) */
export interface ProfileOverride {
  member_id: string;
  responsibilities?: string[] | null;
  authority?: string[] | null;
  /** only ADDS to the forbidden list */
  forbidden_extra?: string[] | null;
  lang?: Lang | null;
}

export const MAX_ITEMS = 8;
export const MAX_ITEM_LEN = 200;

export function cleanProfileOverride(raw: Record<string, unknown>): { ok: true; row: ProfileOverride } | { ok: false; error: string } {
  const id = String(raw.member_id ?? "").trim();
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { ok: false, error: "bad:member_id" };
  const row: ProfileOverride = { member_id: id };
  for (const [k, out] of [["responsibilities", "responsibilities"], ["authority", "authority"], ["forbidden_extra", "forbidden_extra"]] as const) {
    if (raw[k] === undefined) continue;
    if (raw[k] === null) {
      row[out] = null;
      continue;
    }
    const list = cleanList(raw[k], MAX_ITEMS, MAX_ITEM_LEN);
    if (!list.length && String(Array.isArray(raw[k]) ? (raw[k] as unknown[]).join("") : raw[k]).trim()) return { ok: false, error: `bad:${k}` };
    row[out] = list.length ? list : null;
  }
  if (raw.lang !== undefined && raw.lang !== null) {
    if (raw.lang !== "he" && raw.lang !== "en" && raw.lang !== "ar") return { ok: false, error: "bad:lang" };
    row.lang = raw.lang;
  }
  return { ok: true, row };
}

export interface MemberProfileInput {
  id: string;
  role_key: string;
  name?: string;
}
export interface JobProfile {
  member_id: string;
  role_key: string;
  dept: DeptKey;
  deptName: string;
  mission: string;
  responsibilities: string[];
  authority: string[];
  /** the role's forbidden items + the owner's additions + the universal ones (always last, never removable) */
  forbidden: string[];
  procedures: { key: string; title: string; owns: boolean }[];
  customized: boolean;
}

/** the procedures that belong to the employee: those their role owns first, then the department's, at most 5 */
export function relevantProcedures(role: string, dept: DeptKey, views: SopView[], max = 5): JobProfile["procedures"] {
  const owns = views.filter((v) => v.owner_role === role).map((v) => ({ key: v.sop_key, title: v.title, owns: true }));
  const rest = views.filter((v) => v.owner_role !== role && v.dept === dept).map((v) => ({ key: v.sop_key, title: v.title, owns: false }));
  return [...owns, ...rest].slice(0, max);
}

export function buildJobProfile(m: MemberProfileInput, lang: Lang, sops: SopView[] = [], override?: ProfileOverride | null, deptOverride?: DeptKey | null): JobProfile {
  const base = (ROLE_PROFILES[m.role_key] ?? ROLE_PROFILES.custom!)[lang];
  const dept = deptOverride ?? deptForRole(m.role_key);
  const ov = override && override.member_id === m.id ? override : null;
  const forbidden = dedupe([...base.forbidden, ...(ov?.forbidden_extra ?? []), ...ALWAYS_FORBIDDEN[lang]]);
  return {
    member_id: m.id,
    role_key: m.role_key,
    dept,
    deptName: deptName(dept, lang),
    mission: DEPT_MISSION[dept][lang],
    responsibilities: ov?.responsibilities?.length ? ov.responsibilities : base.responsibilities,
    authority: ov?.authority?.length ? ov.authority : base.authority,
    forbidden,
    procedures: relevantProcedures(m.role_key, dept, sops),
    customized: !!(ov && (ov.responsibilities?.length || ov.authority?.length || ov.forbidden_extra?.length)),
  };
}

function dedupe(list: string[]): string[] {
  const seen = new Set<string>();
  return list.filter((x) => {
    const k = x.trim().toLowerCase();
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** the profile as a short block for an employee's own context (not wired into the runner by default) */
export function profilePrompt(p: JobProfile, lang: Lang): string {
  const h = { he: ["תיאור התפקיד שלך", "אחריות", "סמכות", "אסור"], en: ["Your job description", "Responsibilities", "Authority", "Forbidden"], ar: ["وصفك الوظيفي", "المسؤوليات", "الصلاحية", "ممنوع"] }[lang];
  return [`${h[0]} (${p.deptName})`, `${h[1]}: ${p.responsibilities.join("; ")}`, `${h[2]}: ${p.authority.join("; ")}`, `${h[3]}: ${p.forbidden.join("; ")}`].join("\n");
}

/* ------------------------------------------------------------------ the employee card */

export interface EmployeeCard {
  profile: JobProfile;
  stats: DeptStats;
  /** 0..100 or null with no finished task */
  successPct: number | null;
  avgMinutes: number | null;
  /** how many finished tasks stand behind the percentage (so a tiny sample is not read as a verdict) */
  sample: number;
  lowSample: boolean;
}

/** performance comes only from the member's real tasks (done / failed, created → finished) */
export function employeeCard(profile: JobProfile, tasks: TaskLite[], now: number): EmployeeCard {
  const stats = deptStats([profile.member_id], tasks, now);
  const sample = stats.done30 + stats.failed30;
  return { profile, stats, successPct: stats.successRate === null ? null : Math.round(stats.successRate * 100), avgMinutes: stats.avgMinutes, sample, lowSample: sample > 0 && sample < 5 };
}

export function performanceLine(c: EmployeeCard, lang: Lang): string {
  if (c.successPct === null) return { he: "עדיין אין משימות שהסתיימו לחישוב", en: "No finished tasks to measure yet", ar: "لا توجد مهام منتهية للقياس بعد" }[lang];
  const mins = c.avgMinutes === null ? "—" : String(c.avgMinutes);
  const base = { he: `הצלחה ${c.successPct}% (מתוך ${c.sample}), זמן ממוצע ${mins} דק׳`, en: `Success ${c.successPct}% (of ${c.sample}), average ${mins} min`, ar: `النجاح ${c.successPct}% (من ${c.sample})، المتوسط ${mins} د` }[lang];
  const warn = c.lowSample ? { he: " — מדגם קטן", en: " — small sample", ar: " — عينة صغيرة" }[lang] : "";
  return base + warn;
}
