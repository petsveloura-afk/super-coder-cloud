/**
 * Wave 50 — tasks "focus" band, pure logic (unit-tested). Buckets open tasks by due date in the
 * business time zone, like the "Today / Upcoming" views of the big task tools.
 */

export type FocusBucket = "overdue" | "today" | "tomorrow" | "week" | "later" | "nodate";
export const FOCUS_BUCKETS: FocusBucket[] = ["overdue", "today", "tomorrow", "week", "later", "nodate"];

export interface FocusTask {
  status: string;
  due_at: string | null;
}

/** YYYY-MM-DD of an instant in a time zone. */
export function dayIn(iso: string | Date, timeZone: string): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

function addDays(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Which bucket an open task belongs to (null for done / canceled). */
export function bucketOf(task: FocusTask, now: Date, timeZone: string): FocusBucket | null {
  if (task.status === "done" || task.status === "canceled") return null;
  if (!task.due_at) return "nodate";
  if (new Date(task.due_at).getTime() < now.getTime()) return "overdue";
  const today = dayIn(now, timeZone);
  const due = dayIn(task.due_at, timeZone);
  if (due === today) return "today";
  if (due === addDays(today, 1)) return "tomorrow";
  if (due <= addDays(today, 7)) return "week";
  return "later";
}

export function focusCounts(tasks: FocusTask[], now: Date, timeZone: string): Record<FocusBucket, number> {
  const out: Record<FocusBucket, number> = { overdue: 0, today: 0, tomorrow: 0, week: 0, later: 0, nodate: 0 };
  for (const t of tasks) {
    const b = bucketOf(t, now, timeZone);
    if (b) out[b]++;
  }
  return out;
}

/** Weekly completion rate: done in the last 7 days vs (done + still open and due in that window). */
export function weeklyProgress(doneLast7: number, openDueLast7: number): number | null {
  const total = doneLast7 + openDueLast7;
  if (total <= 0) return null;
  return Math.round((doneLast7 / total) * 100);
}

/** One-line headline for the band (an i18n key + vars). */
export function focusHeadline(c: Record<FocusBucket, number>): { key: "clear" | "overdue" | "today" | "upcoming"; n: number } {
  if (c.overdue > 0) return { key: "overdue", n: c.overdue };
  if (c.today > 0) return { key: "today", n: c.today };
  const upcoming = c.tomorrow + c.week;
  if (upcoming > 0) return { key: "upcoming", n: upcoming };
  return { key: "clear", n: 0 };
}
