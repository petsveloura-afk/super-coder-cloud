/**
 * Upgrade 8 / stage A — "restart with one click" rules and the list of old blocked tasks to cancel in one go (pure, unit-tested).
 * Nothing is deleted: a restart puts the task back in the queue; a bulk cancel marks old dead items "canceled" with a reason.
 */
export type Lang = "he" | "en" | "ar";

export interface RestartableTask {
  id: string;
  status: string;
  error?: string | null;
  attempts?: number | null;
  depends_on?: string[] | null;
  updated_at?: string | number | null;
  created_at?: string | number | null;
}

export type RestartVerdict = { ok: true } | { ok: false; reason: "not_restartable" | "emergency_stop" | "dependency_failed" | "needs_connection" | "budget" | "too_many_attempts" };

const RESTARTABLE = new Set(["failed", "blocked", "requires_connection", "canceled"]);
const ts = (v: string | number | null | undefined) => (v == null ? 0 : typeof v === "number" ? v : Date.parse(v) || 0);

/** may this task be restarted now, and if not — the reason (shown to the owner) */
export function canRestart(t: RestartableTask, ctx: { emergencyStop: boolean; dependencyStatus?: Record<string, string>; connectionReady?: boolean; creditsLeft?: number }): RestartVerdict {
  if (!RESTARTABLE.has(t.status)) return { ok: false, reason: "not_restartable" };
  if (ctx.emergencyStop) return { ok: false, reason: "emergency_stop" };
  if (t.status === "requires_connection" && ctx.connectionReady === false) return { ok: false, reason: "needs_connection" };
  const failedDep = (t.depends_on ?? []).some((d) => ["failed", "canceled", "merged"].includes(ctx.dependencyStatus?.[d] ?? ""));
  if (failedDep) return { ok: false, reason: "dependency_failed" };
  if ((t.error ?? "") === "daily_credit_cap" && (ctx.creditsLeft ?? 1) <= 0) return { ok: false, reason: "budget" };
  if ((t.attempts ?? 0) >= 12) return { ok: false, reason: "too_many_attempts" };
  return { ok: true };
}

/** the row patch of a restart (a fresh start: error cleared, back to pending) */
export function restartPatch(now: number): { status: "pending"; error: null; finished_at: null; updated_at: string } {
  return { status: "pending", error: null, finished_at: null, updated_at: new Date(now).toISOString() };
}

export const STALE_BLOCKED_DAYS = 3;

/** blocked / failed-dependency items older than N days: the bulk "cancel old blocked" list (never deletes, never touches fresh items) */
export function staleBlocked<T extends RestartableTask>(tasks: T[], now: number, days = STALE_BLOCKED_DAYS): T[] {
  const cutoff = now - days * 86_400_000;
  return tasks.filter((t) => (t.status === "blocked" || t.status === "requires_connection") && (ts(t.updated_at) || ts(t.created_at)) < cutoff);
}

/**
 * A task blocked ONLY because a dependency had failed comes back when none of its dependencies is failed / canceled / blocked
 * any more (the dependency was retried, or finished).
 */
export function revivable<T extends RestartableTask>(tasks: T[], statusById: Record<string, string>): T[] {
  return tasks.filter((t) => {
    if (t.status !== "blocked" || t.error !== "dependency_failed") return false;
    const deps = t.depends_on ?? [];
    if (!deps.length) return false;
    return !deps.some((d) => ["failed", "canceled", "blocked", "merged"].includes(statusById[d] ?? ""));
  });
}

const WHY: Record<Lang, Record<string, string>> = {
  he: { not_restartable: "אפשר להפעיל מחדש רק משימה שנכשלה או נחסמה.", emergency_stop: "עצירת החירום פעילה — שחררו אותה קודם.", dependency_failed: "משימה שהיא תלויה בה נכשלה — הפעילו מחדש קודם אותה.", needs_connection: "עדיין חסר חיבור — חברו אותו ואז נסו שוב.", budget: "הגעתם למכסת הקרדיטים היומית — המשימה תחזור לבד כשתתפנה מכסה.", too_many_attempts: "המשימה נוסתה יותר מדי פעמים — עדכנו את הניסוח שלה." },
  en: { not_restartable: "Only a failed or blocked task can be restarted.", emergency_stop: "The emergency stop is on — release it first.", dependency_failed: "A task it depends on failed — restart that one first.", needs_connection: "A connection is still missing — connect it, then try again.", budget: "The daily credit cap was reached — the task returns by itself when credits are available.", too_many_attempts: "The task was tried too many times — update its wording." },
  ar: { not_restartable: "يمكن إعادة تشغيل المهمة الفاشلة أو المحظورة فقط.", emergency_stop: "الإيقاف الطارئ مفعّل — ألغِه أولًا.", dependency_failed: "فشلت مهمة تعتمد عليها — أعد تشغيل تلك أولًا.", needs_connection: "ما زال الربط ناقصًا — اربطه ثم حاول مجددًا.", budget: "بلغت الحد اليومي للرصيد — ستعود المهمة تلقائيًا عند توفر رصيد.", too_many_attempts: "جرّبت المهمة مرات كثيرة — عدّل صياغتها." },
};
export const restartReason = (code: string, lang: Lang): string => WHY[lang][code] ?? WHY[lang].not_restartable!;
