/**
 * Wave 68 — transparency: one clear reason in the business language instead of "unexpected error" (pure, unit-tested).
 * Adds to classifyFailure / classifyToolFailure, never replaces them: `looksTemporaryFailure` catches the AI-layer wordings
 * that used to fall through to the generic "bug" bucket, and `ownerFailure` gives ONE sentence plus ONE action per failure.
 */
import { classifyFailure } from "./reliability-core";
import { classifyToolFailure, explainToolFailure } from "./tool-failure-core";
import { looksTemporaryFailure } from "./failure-wording-core";

export { looksTemporaryFailure };

export type Lang = "he" | "en" | "ar";

export interface OwnerFailure {
  /** the reason code of the health screen (aiTeam.health.reason.*) */
  code: string;
  text: string;
  action: string;
  retryable: boolean;
  needsConnection: boolean;
}

const BUSY: Record<Lang, { text: string; action: string }> = {
  he: { text: "מנועי ה-AI עמוסים, ינסה שוב בעוד כמה דקות", action: "אין צורך לעשות כלום — המערכת תנסה שוב לבד. אפשר גם ללחוץ \"הפעל מחדש\"." },
  en: { text: "The AI engines are busy — it will try again in a few minutes", action: "Nothing to do — the system retries by itself. You can also press \"Restart\"." },
  ar: { text: "محركات الذكاء الاصطناعي مشغولة، ستتم إعادة المحاولة بعد بضع دقائق", action: "لا حاجة لفعل شيء — يعيد النظام المحاولة تلقائيًا. يمكنك أيضًا الضغط على \"إعادة التشغيل\"." },
};
const NETWORK: Record<Lang, { text: string; action: string }> = {
  he: { text: "תקלת רשת זמנית", action: "המערכת תנסה שוב לבד. אפשר גם ללחוץ \"הפעל מחדש\"." },
  en: { text: "A temporary network problem", action: "The system retries by itself. You can also press \"Restart\"." },
  ar: { text: "مشكلة شبكة مؤقتة", action: "يعيد النظام المحاولة تلقائيًا. يمكنك أيضًا الضغط على \"إعادة التشغيل\"." },
};
const BUDGET: Record<Lang, { text: string; action: string }> = {
  he: { text: "הצוות הגיע לתקרת העבודה או הקרדיטים", action: "העלו את התקרה בהגדרות הצוות, או המתינו ליום הבא." },
  en: { text: "The team reached its work or credit limit", action: "Raise the limit in the team settings, or wait for tomorrow." },
  ar: { text: "وصل الفريق إلى حد العمل أو الرصيد", action: "ارفعوا الحد في إعدادات الفريق أو انتظروا حتى الغد." },
};
const POLICY: Record<Lang, { text: string; action: string }> = {
  he: { text: "הפעולה נעצרה לפי הכללים שהוגדרו לצוות", action: "בדקו את הגדרות הצוות ואת האישורים הממתינים." },
  en: { text: "The action was stopped by the rules set for the team", action: "Check the team settings and the pending approvals." },
  ar: { text: "أُوقف الإجراء وفق القواعد المحددة للفريق", action: "تحققوا من إعدادات الفريق والموافقات المعلقة." },
};
const BUG: Record<Lang, { text: string; action: string }> = {
  he: { text: "משהו השתבש בכלי ולא זוהתה סיבה ברורה", action: "לחצו \"הפעל מחדש\". אם זה חוזר, פנו לתמיכה — הפרטים נשמרו ביומן." },
  en: { text: "Something went wrong in the tool and no clear reason was found", action: "Press \"Restart\". If it repeats, contact support — the details are in the log." },
  ar: { text: "حدث خلل في الأداة ولم يُعثر على سبب واضح", action: "اضغطوا \"إعادة التشغيل\". إذا تكرر ذلك فتواصلوا مع الدعم — التفاصيل محفوظة في السجل." },
};

const TOO_LONG: Record<Lang, { text: string; action: string }> = {
  he: { text: "העבודה נקטעה כי לקחה יותר מדי זמן (המנועים היו איטיים)", action: "לחצו \"נסה שוב עכשיו\" — הריצה החדשה מוגבלת בזמן ומסתיימת כמו שצריך." },
  en: { text: "The work was cut off because it took too long (the engines were slow)", action: "Press \"Try again now\" — the new run is time-limited and ends properly." },
  ar: { text: "انقطع العمل لأنه استغرق وقتًا طويلًا (كانت المحركات بطيئة)", action: "اضغطوا \"أعد المحاولة الآن\" — التشغيل الجديد محدود بالوقت وينتهي كما يجب." },
};

/** ONE reason (a sentence in the business language) and ONE action; never a technical code */
export function ownerFailure(error: string | null | undefined, lang: Lang): OwnerFailure {
  const L: Lang = lang === "en" || lang === "ar" ? lang : "he";
  // additive: a run that the server cut off (left "in progress", recovered several times) is a time problem, not a bug
  if (/^(stuck_too_often|recovered_stuck)$/.test(error ?? "")) return { code: "too_long", text: TOO_LONG[L].text, action: TOO_LONG[L].action, retryable: true, needsConnection: false };
  try {
    const f = classifyFailure(error);
    const pick = (o: Record<Lang, { text: string; action: string }>, code: string, retryable: boolean): OwnerFailure => ({ code, text: o[L].text, action: o[L].action, retryable, needsConnection: false });
    if (f.kind === "ai_busy" || f.kind === "ai_unreadable") return pick(BUSY, f.code, true);
    if (f.kind === "network") return pick(NETWORK, f.code, true);
    if (f.kind === "budget") return pick(BUDGET, f.code, false);
    if (f.kind === "policy") return pick(POLICY, f.code, false);
    const t = classifyToolFailure(error);
    if (t.kind === "temporary" && looksTemporaryFailure(error)) return pick(BUSY, t.code, true);
    if (t.kind === "bug") return pick(BUG, t.code, true);
    const e = explainToolFailure(error, L);
    return { code: t.code, text: e.label, action: e.action, retryable: e.retryable, needsConnection: e.needsConnection };
  } catch {
    return { code: "unknown", text: BUG[L].text, action: BUG[L].action, retryable: true, needsConnection: false };
  }
}
