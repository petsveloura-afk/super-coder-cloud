/**
 * Business opening hours — pure helpers (unit-tested).
 * The business sets a weekly schedule (one or two ranges per day), closed dates
 * (holidays) and what the agent does after hours. The agent always knows the
 * current local time, whether the place is open, and the next opening — so it
 * books only real opening times and, when closed, says so politely and still
 * tries to close the deal for the next opening.
 */

export const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
export type Day = (typeof DAYS)[number];

export interface TimeRange {
  open: string; // "09:00"
  close: string; // "18:00" ("24:00" = midnight; close < open = past midnight)
}

export type AfterHours = "book_next" | "closed_message" | "answer_normally";

export interface BusinessSchedule {
  enabled?: boolean;
  tz?: string;
  days?: Partial<Record<Day, TimeRange[]>>;
  /** "2026-10-20" — closed all day (holidays, vacations) */
  closed_dates?: string[];
  after_hours?: AfterHours;
  /** optional custom text for the closed message */
  closed_note?: string;
}

const HM = /^([01]\d|2[0-4]):([0-5]\d)$/;
const toMin = (hm: string) => {
  const m = HM.exec(hm);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

/** Validates & normalises a schedule coming from the UI. Returns null when disabled / empty. */
export function normalizeSchedule(s: BusinessSchedule | null | undefined): BusinessSchedule | null {
  if (!s || s.enabled === false) return null;
  const days: Partial<Record<Day, TimeRange[]>> = {};
  for (const d of DAYS) {
    const ranges = (s.days?.[d] ?? [])
      .filter((r) => toMin(r.open) !== null && toMin(r.close) !== null && r.open !== r.close)
      .slice(0, 2);
    if (ranges.length) days[d] = ranges;
  }
  const closed = [...new Set((s.closed_dates ?? []).filter((x) => /^\d{4}-\d{2}-\d{2}$/.test(x)))].sort().slice(0, 60);
  return {
    enabled: true,
    tz: validTz(s.tz) ? s.tz : "Asia/Jerusalem",
    days,
    closed_dates: closed,
    after_hours: s.after_hours === "closed_message" || s.after_hours === "answer_normally" ? s.after_hours : "book_next",
    ...(s.closed_note ? { closed_note: String(s.closed_note).slice(0, 300) } : {}),
  };
}

export function validTz(tz: string | undefined | null): tz is string {
  if (!tz) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Local wall-clock parts in a time zone. */
export function localParts(now: Date, tz: string): { date: string; day: Day; minutes: number; hm: string } {
  const f = new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const p = Object.fromEntries(f.formatToParts(now).map((x) => [x.type, x.value])) as Record<string, string>;
  const day = (p.weekday ?? "Sun").slice(0, 3).toLowerCase() as Day;
  const h = Number(p.hour ?? 0) % 24;
  const m = Number(p.minute ?? 0);
  return { date: `${p.year}-${p.month}-${p.day}`, day, minutes: h * 60 + m, hm: `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}` };
}

function addDays(date: string, n: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const dayOf = (date: string): Day => DAYS[new Date(`${date}T12:00:00Z`).getUTCDay()]!;

export interface ScheduleStatus {
  open: boolean;
  localTime: string; // "Fri 23:40"
  localDate: string;
  /** today's hours for the prompt, e.g. "09:00–18:00" or "closed" */
  today: string;
  /** next opening when closed: { date, day, time } */
  nextOpen: { date: string; day: Day; time: string; inDays: number } | null;
  /** until when open (when open) */
  closesAt: string | null;
}

/**
 * Is the business open now? Handles ranges past midnight (e.g. 18:00–02:00 from the
 * previous day), closed dates and finds the next opening within 14 days.
 */
export function scheduleStatus(s: BusinessSchedule, now = new Date()): ScheduleStatus {
  const tz = validTz(s.tz) ? s.tz! : "Asia/Jerusalem";
  const lp = localParts(now, tz);
  const closedDates = new Set(s.closed_dates ?? []);
  const rangesOn = (date: string) => (closedDates.has(date) ? [] : (s.days?.[dayOf(date)] ?? []));
  let open = false;
  let closesAt: string | null = null;
  for (const r of rangesOn(lp.date)) {
    const o = toMin(r.open)!;
    const c = toMin(r.close)!;
    if (c > o ? lp.minutes >= o && lp.minutes < c : lp.minutes >= o) {
      open = true;
      closesAt = r.close === "24:00" ? "24:00" : r.close;
    }
  }
  // yesterday's range that runs past midnight
  if (!open) {
    for (const r of rangesOn(addDays(lp.date, -1))) {
      const o = toMin(r.open)!;
      const c = toMin(r.close)!;
      if (c < o && lp.minutes < c) {
        open = true;
        closesAt = r.close;
      }
    }
  }
  let nextOpen: ScheduleStatus["nextOpen"] = null;
  if (!open) {
    for (let i = 0; i <= 14 && !nextOpen; i++) {
      const date = addDays(lp.date, i);
      const starts = rangesOn(date)
        .map((r) => r.open)
        .filter((o) => i > 0 || toMin(o)! > lp.minutes)
        .sort();
      if (starts.length) nextOpen = { date, day: dayOf(date), time: starts[0]!, inDays: i };
    }
  }
  const todays = rangesOn(lp.date);
  return {
    open,
    localTime: `${lp.day.charAt(0).toUpperCase()}${lp.day.slice(1)} ${lp.hm}`,
    localDate: lp.date,
    today: todays.length ? todays.map((r) => `${r.open}–${r.close}`).join(", ") : "closed",
    nextOpen,
    closesAt,
  };
}

const DAY_HE: Record<Day, string> = { sun: "ראשון", mon: "שני", tue: "שלישי", wed: "רביעי", thu: "חמישי", fri: "שישי", sat: "שבת" };
const DAY_EN: Record<Day, string> = { sun: "Sunday", mon: "Monday", tue: "Tuesday", wed: "Wednesday", thu: "Thursday", fri: "Friday", sat: "Saturday" };

/** Weekly hours as one readable line per day (for the prompt / customer). */
export function weeklyText(s: BusinessSchedule, locale = "he"): string {
  const names = locale === "en" ? DAY_EN : DAY_HE;
  const closed = locale === "en" ? "closed" : "סגור";
  return DAYS.map((d) => `${names[d]}: ${(s.days?.[d] ?? []).map((r) => `${r.open}–${r.close}`).join(", ") || closed}`).join("\n");
}

/** "יום ראשון ב-09:00" / "מחר ב-09:00" / "היום ב-16:00" */
export function nextOpenText(st: ScheduleStatus, locale = "he"): string {
  if (!st.nextOpen) return "";
  const n = st.nextOpen;
  if (locale === "en") return n.inDays === 0 ? `today at ${n.time}` : n.inDays === 1 ? `tomorrow at ${n.time}` : `${DAY_EN[n.day]} at ${n.time}`;
  return n.inDays === 0 ? `היום ב-${n.time}` : n.inDays === 1 ? `מחר ב-${n.time}` : `ביום ${DAY_HE[n.day]} ב-${n.time}`;
}

/** System-prompt section: local time, open/closed, weekly hours and the after-hours behaviour. */
export function scheduleInstructions(s: BusinessSchedule | null | undefined, now = new Date(), locale = "he"): string {
  const sch = normalizeSchedule(s);
  if (!sch) return "";
  const st = scheduleStatus(sch, now);
  const holidays = (sch.closed_dates ?? []).filter((d) => d >= st.localDate).slice(0, 10);
  const lines = [
    `OPENING HOURS (time zone ${sch.tz}). Local time now: ${st.localTime} (${st.localDate}).`,
    `Weekly hours:\n${weeklyText(sch, "en")}`,
    holidays.length ? `Closed dates (holidays): ${holidays.join(", ")}` : "",
    st.open
      ? `The business is OPEN now${st.closesAt ? ` (until ${st.closesAt})` : ""}.`
      : `The business is CLOSED now. Next opening: ${st.nextOpen ? `${st.nextOpen.date} (${DAY_EN[st.nextOpen.day]}) at ${st.nextOpen.time}` : "unknown"}.`,
    "Only offer / confirm appointments, deliveries or call-backs INSIDE the opening hours above (never on closed days or holidays). If the customer asks for a closed time, explain kindly and offer the nearest open slots.",
  ];
  if (!st.open) {
    if (sch.after_hours === "book_next")
      lines.push(
        `After-hours behaviour: answer and help fully as usual, mention briefly and warmly that the place is closed right now (opens ${nextOpenText(st, locale)}), and try to close the deal for the next opening — collect the details and record the LEAD so the team confirms when it opens.`,
      );
    else if (sch.after_hours === "closed_message")
      lines.push(
        `After-hours behaviour: tell the customer the place is closed now and opens ${nextOpenText(st, locale)}${sch.closed_note ? ` (business note: ${sch.closed_note})` : ""}; offer to leave name + phone and what they need so the team gets back first thing, record the LEAD, and keep answers short. If they still want to book, offer the next open slot.`,
      );
    else lines.push("After-hours behaviour: answer normally; mention the opening hours only if relevant.");
  }
  return lines.filter(Boolean).join("\n");
}
