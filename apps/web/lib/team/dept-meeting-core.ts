/**
 * Upgrade 8 / stage B6 — department meetings, built BY CODE from the real tasks (no model, nothing invented).
 *
 * Daily (short): what is in the queue, what is blocked, what is urgent, and ONE decision for the day. Weekly: what finished, how well,
 * the goal and the agreements that touch the department. The weekly report gets a split by department as an ADDITION: the existing
 * report is not changed (see withDeptSplit); a department with no employees is left out.
 */
import { deptName, deptStats, type DeptKey, type DeptView, type Lang, type MemberLite, type TaskLite } from "./departments-core";
import { slaLevel, slaName, type SlaResult } from "./dept-sla-core";
import type { Report } from "./reports-core";

const OPEN = new Set(["pending", "in_progress", "awaiting_approval", "awaiting_input", "blocked", "requires_connection"]);
const BLOCKED = new Set(["blocked", "requires_connection"]);
const WAITING = new Set(["awaiting_approval", "awaiting_input"]);
const DAY = 86_400_000;

export interface MeetingTask extends TaskLite {
  title?: string;
  priority?: number;
}
export type DecisionCode = "unblock" | "sla" | "urgent" | "rebalance" | "continue" | "none";
export interface DailyMeeting {
  dept: DeptKey;
  name: string;
  head: string | null;
  members: number;
  queue: { count: number; top: string[] };
  blocked: { count: number; items: string[] };
  urgent: { count: number; items: string[] };
  decision: { code: DecisionCode; text: string };
  text: string;
}
export interface MeetingOpts {
  lang: Lang;
  now: number;
  /** display translation of a stored title (title-i18n-core.localizeTitle on the server); identity by default */
  localize?: (s: string) => string;
  sla?: SlaResult[];
  members?: MemberLite[];
}

const clip = (s: string, n = 70) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const tl = (i: Record<Lang, string>, l: Lang) => i[l];

/** the department's tasks (assignee in the department) */
export function deptTasks(view: Pick<DeptView, "member_ids">, tasks: MeetingTask[]): MeetingTask[] {
  const ids = new Set(view.member_ids);
  return tasks.filter((t) => t.assignee_id && ids.has(t.assignee_id));
}

const byUrgency = (a: MeetingTask, b: MeetingTask) => (a.priority ?? 2) - (b.priority ?? 2) || Date.parse(a.created_at ?? "") - Date.parse(b.created_at ?? "") || String(a.id).localeCompare(String(b.id));

/** an urgent task = priority 1 still open, or one that waits for a person more than a day */
export function isUrgent(t: MeetingTask, now: number): boolean {
  if (!OPEN.has(t.status)) return false;
  if ((t.priority ?? 2) === 1) return true;
  return WAITING.has(t.status) && now - Date.parse(t.updated_at ?? t.created_at ?? "") > DAY;
}

function slaOf(dept: DeptKey, sla: SlaResult[] | undefined): SlaResult | null {
  const bad = (sla ?? []).filter((r) => (r.def.to === dept || r.def.from === dept) && slaLevel(r) === "breach");
  // the agreement where this department is the RECEIVER is the one it can act on
  return bad.find((r) => r.def.to === dept) ?? null;
}

export function buildDailyMeeting(view: DeptView, tasks: MeetingTask[], o: MeetingOpts): DailyMeeting {
  const loc = o.localize ?? ((s: string) => s);
  const mine = deptTasks(view, tasks);
  const open = mine.filter((t) => OPEN.has(t.status));
  const queued = open.filter((t) => t.status === "pending" || t.status === "in_progress").sort(byUrgency);
  const blocked = open.filter((t) => BLOCKED.has(t.status)).sort(byUrgency);
  const urgent = open.filter((t) => isUrgent(t, o.now)).sort(byUrgency);
  const name = deptName(view.key, o.lang);
  const head = view.head_member_id ? (o.members?.find((m) => m.id === view.head_member_id)?.name ?? null) : null;
  const title = (t: MeetingTask) => clip(loc(String(t.title ?? "")) || "—");
  const sla = slaOf(view.key, o.sla);

  let decision: DailyMeeting["decision"];
  if (blocked.length) {
    const t = title(blocked[0]!);
    decision = { code: "unblock", text: tl({ he: `לשחרר קודם את "${t}" — הוא חסום`, en: `Unblock "${t}" first — it is stuck`, ar: `فك حظر "${t}" أولاً — إنها عالقة` }, o.lang) };
  } else if (sla) {
    decision = { code: "sla", text: tl({ he: `לאסוף את ההעברות שממתינות מ-${deptName(sla.def.from, "he")} (הסכם ${sla.def.minutes} דק')`, en: `Pick up the waiting handoffs from ${deptName(sla.def.from, "en")} (agreement ${sla.def.minutes} min)`, ar: `استلام عمليات التسليم المنتظرة من ${deptName(sla.def.from, "ar")} (الاتفاقية ${sla.def.minutes} د)` }, o.lang) };
  } else if (urgent.length) {
    const t = title(urgent[0]!);
    decision = { code: "urgent", text: tl({ he: `להתחיל מהדחוף: "${t}"`, en: `Start with the urgent one: "${t}"`, ar: `البدء بالعاجل: "${t}"` }, o.lang) };
  } else if (view.stats.load >= 5) {
    decision = { code: "rebalance", text: tl({ he: `עומס גבוה (${view.stats.load} משימות לעובד) — לבדוק חלוקה מחדש`, en: `High load (${view.stats.load} tasks per employee) — review the split`, ar: `حمل مرتفع (${view.stats.load} مهام لكل موظف) — راجع التوزيع` }, o.lang) };
  } else if (queued.length) {
    const t = title(queued[0]!);
    decision = { code: "continue", text: tl({ he: `להמשיך לפי התור: "${t}"`, en: `Continue by the queue: "${t}"`, ar: `المتابعة حسب الدور: "${t}"` }, o.lang) };
  } else {
    decision = { code: "none", text: tl({ he: "אין החלטה נדרשת היום", en: "No decision needed today", ar: "لا قرار مطلوب اليوم" }, o.lang) };
  }

  const L = {
    he: { head: "ישיבת בוקר", queue: "בתור", blocked: "חסום", urgent: "דחוף", decide: "החלטה", none: "—", empty: "אין עובדים במחלקה" },
    en: { head: "Morning meeting", queue: "Queue", blocked: "Blocked", urgent: "Urgent", decide: "Decision", none: "—", empty: "No employees in the department" },
    ar: { head: "اجتماع الصباح", queue: "في الدور", blocked: "عالق", urgent: "عاجل", decide: "القرار", none: "—", empty: "لا موظفين في القسم" },
  }[o.lang];
  const list = (a: MeetingTask[]) => (a.length ? a.slice(0, 3).map(title).join("; ") : L.none);
  const text = view.member_ids.length
    ? [`${L.head} — ${name}`, `${L.queue}: ${queued.length} (${list(queued)})`, `${L.blocked}: ${blocked.length} (${list(blocked)})`, `${L.urgent}: ${urgent.length} (${list(urgent)})`, `${L.decide}: ${decision.text}`].join("\n")
    : `${L.head} — ${name}\n${L.empty}`;
  return { dept: view.key, name, head, members: view.member_ids.length, queue: { count: queued.length, top: queued.slice(0, 3).map(title) }, blocked: { count: blocked.length, items: blocked.slice(0, 3).map(title) }, urgent: { count: urgent.length, items: urgent.slice(0, 3).map(title) }, decision, text };
}

/* ------------------------------------------------------------------ weekly */

export interface WeeklyMeeting {
  dept: DeptKey;
  name: string;
  members: number;
  done: number;
  failed: number;
  successPct: number | null;
  avgMinutes: number | null;
  credits: number;
  goal: string | null;
  slaLines: string[];
  carryOver: number;
  lines: string[];
  text: string;
}

/** tasks that finished or changed in the last 7 days count for the week */
export function buildWeeklyMeeting(view: DeptView, tasks: MeetingTask[], o: MeetingOpts & { slaLine?: (r: SlaResult) => string }): WeeklyMeeting {
  const mine = deptTasks(view, tasks).filter((t) => Date.parse(t.updated_at ?? t.finished_at ?? t.created_at ?? "") > o.now - 7 * DAY);
  const s = deptStats(view.member_ids, mine, o.now);
  const name = deptName(view.key, o.lang);
  const credits = mine.reduce((a, t) => a + (t.credits_used ?? 0), 0);
  const slaLines = (o.sla ?? []).filter((r) => r.def.to === view.key || r.def.from === view.key).filter((r) => r.total > 0 && slaLevel(r) !== "ok").map((r) => (o.slaLine ? o.slaLine(r) : slaName(r.def, o.lang)));
  const carry = mine.filter((t) => OPEN.has(t.status)).length;
  const successPct = s.successRate === null ? null : Math.round(s.successRate * 100);
  const L = {
    he: { done: "הושלמו", failed: "נכשלו", succ: "אחוז הצלחה", avg: "זמן ממוצע", min: "דק'", credits: "קרדיטים", goal: "יעד", carry: "עוברות לשבוע הבא", sla: "הסכמים" },
    en: { done: "Done", failed: "Failed", succ: "Success rate", avg: "Average time", min: "min", credits: "Credits", goal: "Goal", carry: "Carried over", sla: "Agreements" },
    ar: { done: "أُنجزت", failed: "فشلت", succ: "نسبة النجاح", avg: "متوسط الوقت", min: "د", credits: "الرصيد", goal: "الهدف", carry: "تنتقل للأسبوع القادم", sla: "الاتفاقيات" },
  }[o.lang];
  const lines = [`${L.done}: ${s.done30} · ${L.failed}: ${s.failed30}${successPct === null ? "" : ` · ${L.succ}: ${successPct}%`}`, ...(s.avgMinutes === null ? [] : [`${L.avg}: ${s.avgMinutes} ${L.min}`]), `${L.credits}: ${credits}`, ...(view.goal ? [`${L.goal}: ${view.goal.title}`] : []), `${L.carry}: ${carry}`, ...slaLines.map((x) => `${L.sla}: ${x}`)];
  return { dept: view.key, name, members: view.member_ids.length, done: s.done30, failed: s.failed30, successPct, avgMinutes: s.avgMinutes, credits, goal: view.goal?.title ?? null, slaLines, carryOver: carry, lines, text: [name, ...lines.map((l) => `• ${l}`)].join("\n") };
}

/* ------------------------------------------------------------------ the weekly report, split by department (an addition) */

export interface DeptSplit {
  key: string;
  heading: string;
  lines: string[];
  figures: number[];
}

/** one section per department that has employees; departments with no employee are left out */
export function deptSplitSections(views: DeptView[], tasks: MeetingTask[], o: MeetingOpts & { slaLine?: (r: SlaResult) => string }): DeptSplit[] {
  const out: DeptSplit[] = [];
  for (const v of views) {
    if (!v.member_ids.length) continue;
    const w = buildWeeklyMeeting(v, tasks, o);
    out.push({ key: `dept_${v.key}`, heading: w.name, lines: w.lines, figures: [w.done, w.failed, w.credits, w.carryOver, ...(w.successPct === null ? [] : [w.successPct]), ...(w.avgMinutes === null ? [] : [w.avgMinutes])] });
  }
  return out;
}

const SPLIT_HEAD: Record<Lang, string> = { he: "לפי מחלקה", en: "By department", ar: "حسب القسم" };

/**
 * Returns a NEW report with the department split appended after the existing sections; the original object is not touched, and with no
 * sections the same report is returned as it is. The figures list grows so the "no invented numbers" guard still knows them.
 */
export function withDeptSplit(report: Report, sections: DeptSplit[], lang: Lang): Report {
  if (!sections.length || report.text.includes(`${SPLIT_HEAD[lang]} —`)) return report; // nothing to add, or already split (idempotent)
  const added = sections.map((s) => ({ key: s.key, heading: `${SPLIT_HEAD[lang]} — ${s.heading}`, lines: s.lines }));
  const text = `${report.text}\n${added.flatMap((s) => [`\n${s.heading}`, ...s.lines.map((l) => `• ${l}`)]).join("\n")}`;
  return { ...report, sections: [...report.sections, ...added], text, figures: [...new Set([...report.figures, ...sections.flatMap((s) => s.figures)])] };
}
