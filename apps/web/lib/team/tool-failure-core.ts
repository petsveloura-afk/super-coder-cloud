/**
 * Upgrade 8 / stage A — why a tool failed, and the ONE thing to do about it (pure, unit-tested).
 * "Missing connection" is NOT a failure: the task is shown as "needs a connection" with the way forward.
 */
import { classifyFailure } from "./reliability-core";
import { looksTemporaryFailure } from "./failure-wording-core";

export type Lang = "he" | "en" | "ar";
export type ToolFailureKind = "missing_connection" | "missing_data" | "temporary" | "bad_input" | "bug";

export interface ToolFailure {
  kind: ToolFailureKind;
  /** i18n code under aiTeam.health.reason.* */
  code: string;
  /** the task shows as "needs a connection" (not "failed") */
  needsConnection: boolean;
  retryable: boolean;
}

export function classifyToolFailure(error: string | null | undefined): ToolFailure {
  const e = (error ?? "").toLowerCase();
  // the AI engines themselves (busy, resting, empty answer) are a temporary problem that heals by itself — never "missing data" or "bug"
  if (/ai_not_configured|ai\.notconfigured/.test(e)) return { kind: "missing_connection", code: "tool_needs_connection", needsConnection: true, retryable: false };
  if (/ai_all_|ai_failed|ai\.failed|ai_busy|ai\.busy|empty_answer|empty answer|all engines|ai\.self_check|ai\.empty_retry/.test(e)) return { kind: "temporary", code: "tool_temporary", needsConnection: false, retryable: true };
  if (/not_connected|no_connection|not connected|channel_not|no_channel|integration|oauth|token (expired|invalid)|not_sent_guard_or_channel|permission|forbidden|unauthori[sz]ed|\b40[13]\b|missing_scope|no_pipeline_access|needs_connection/.test(e)) return { kind: "missing_connection", code: "tool_needs_connection", needsConnection: true, retryable: false };
  if (/not_found|no_pipeline|no_data|no_contact|nothing_to_change|empty|no_site|no_posts|missing_data|no_employee_with_role/.test(e)) return { kind: "missing_data", code: "tool_missing_data", needsConnection: false, retryable: false };
  if (/timeout|network|fetch failed|econn|etimedout|temporar|rate|429|5\d\d|busy|overload|deadlock|slot_taken/.test(e)) return { kind: "temporary", code: "tool_temporary", needsConnection: false, retryable: true };
  if (/invalid|bad_|too_short|validation|required|malformed|bad_channel|bad_time|unknown_tool|not_a_customer/.test(e)) return { kind: "bad_input", code: "tool_bad_input", needsConnection: false, retryable: false };
  // wave 68: AI-layer wordings that heal by themselves are a temporary problem, not an "unexpected error"
  if (looksTemporaryFailure(e)) return { kind: "temporary", code: "tool_temporary", needsConnection: false, retryable: true };
  return { kind: "bug", code: "tool_bug", needsConnection: false, retryable: true };
}

const ACTION: Record<Lang, Record<ToolFailureKind, string>> = {
  he: { missing_connection: "חברו את הערוץ או החשבון הנדרש בהגדרות החיבורים, ואז לחצו \"הפעל מחדש\".", missing_data: "חסר נתון: הוסיפו אותו (איש קשר, מוצר או אתר) ואז לחצו \"הפעל מחדש\".", temporary: "תקלה זמנית — המערכת תנסה שוב לבד; אפשר גם ללחוץ \"הפעל מחדש\".", bad_input: "הבקשה לא ברורה מספיק — דייקו את הניסוח ולחצו \"הפעל מחדש\".", bug: "שגיאה לא צפויה — לחצו \"הפעל מחדש\"; אם חוזר, דווחו לנו עם שם המשימה." },
  en: { missing_connection: "Connect the needed channel or account in the connections settings, then press \"Restart\".", missing_data: "Some data is missing: add it (a contact, product or site), then press \"Restart\".", temporary: "A temporary problem — the system retries by itself; you can also press \"Restart\".", bad_input: "The request is not clear enough — refine the wording and press \"Restart\".", bug: "Unexpected error — press \"Restart\"; if it repeats, report it with the task name." },
  ar: { missing_connection: "اربط القناة أو الحساب المطلوب في إعدادات الربط ثم اضغط \"إعادة التشغيل\".", missing_data: "هناك بيانات ناقصة: أضفها (جهة اتصال أو منتج أو موقع) ثم اضغط \"إعادة التشغيل\".", temporary: "مشكلة مؤقتة — سيعيد النظام المحاولة تلقائيًا؛ يمكنك أيضًا الضغط على \"إعادة التشغيل\".", bad_input: "الطلب غير واضح بما يكفي — وضّح الصياغة ثم اضغط \"إعادة التشغيل\".", bug: "خطأ غير متوقع — اضغط \"إعادة التشغيل\"؛ وإن تكرر أبلغنا مع اسم المهمة." },
};
const LABEL: Record<Lang, Record<ToolFailureKind, string>> = {
  he: { missing_connection: "דורש חיבור", missing_data: "חסר נתון", temporary: "תקלה זמנית", bad_input: "קלט לא תקין", bug: "שגיאה" },
  en: { missing_connection: "Needs a connection", missing_data: "Missing data", temporary: "Temporary problem", bad_input: "Invalid input", bug: "Error" },
  ar: { missing_connection: "يتطلب ربطًا", missing_data: "بيانات ناقصة", temporary: "مشكلة مؤقتة", bad_input: "مدخل غير صالح", bug: "خطأ" },
};

/** the owner-facing explanation of a tool failure: a label and exactly one action, in the business's language */
export function explainToolFailure(error: string | null | undefined, lang: Lang): { kind: ToolFailureKind; label: string; action: string; needsConnection: boolean; retryable: boolean } {
  const f = classifyToolFailure(error);
  return { kind: f.kind, label: LABEL[lang][f.kind], action: ACTION[lang][f.kind], needsConnection: f.needsConnection, retryable: f.retryable };
}

/** the task status for a tool failure: a missing connection is "requires_connection", everything else stays "failed" */
export function statusForToolFailure(error: string | null | undefined): "requires_connection" | "failed" {
  return classifyToolFailure(error).needsConnection ? "requires_connection" : "failed";
}

/** the i18n reason code for the health screen: the generic "tool" bucket is split into the five kinds above, everything else keeps its code */
export function reasonCode(error: string | null | undefined): string {
  const f = classifyFailure(error);
  return f.kind === "tool" ? classifyToolFailure(error).code : f.code;
}
