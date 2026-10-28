/**
 * Appointments — pure helpers (no I/O, safe on server and client).
 * Everything here is additive: calendar grid math in the organisation's time zone,
 * meeting statistics (show rate, busiest hours, trends), join-link detection and .ics export.
 */

export type ApptStatus = "scheduled" | "confirmed" | "canceled" | "completed" | "no_show";

export interface ApptRow {
  id: string;
  title: string;
  starts_at: string;
  ends_at: string;
  status: ApptStatus | string;
  location?: string | null;
  notes?: string | null;
  contact_id?: string | null;
  host_id?: string | null;
  type_id?: string | null;
  created_at?: string | null;
}

/* ------------------------------------------------------------------ time zone */
export interface ZonedParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  weekday: number; // 0 = Sunday … 6 = Saturday
}

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
const fmtCache = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(timeZone: string) {
  let f = fmtCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short" });
    fmtCache.set(timeZone, f);
  }
  return f;
}

export function safeZone(tz: string | null | undefined): string {
  const z = tz || "Asia/Jerusalem";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: z });
    return z;
  } catch {
    return "Asia/Jerusalem";
  }
}

export function zonedParts(value: Date | string, timeZone: string): ZonedParts {
  const out: Record<string, string> = {};
  for (const p of partsFormatter(timeZone).formatToParts(new Date(value))) out[p.type] = p.value;
  return {
    year: Number(out.year),
    month: Number(out.month),
    day: Number(out.day),
    hour: Number(out.hour) % 24,
    minute: Number(out.minute),
    weekday: WEEKDAYS[out.weekday ?? "Sun"] ?? 0,
  };
}

const pad = (n: number) => String(n).padStart(2, "0");
export const dayKey = (p: Pick<ZonedParts, "year" | "month" | "day">) => `${p.year}-${pad(p.month)}-${pad(p.day)}`;
export const dayKeyOf = (value: Date | string, timeZone: string) => dayKey(zonedParts(value, timeZone));

/** Calendar arithmetic on a YYYY-MM-DD key (tz independent). */
export function addDays(key: string, days: number): string {
  const [y, m, d] = key.split("-").map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}
export function weekdayOfKey(key: string): number {
  const [y, m, d] = key.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}
export function startOfWeekKey(key: string): string {
  return addDays(key, -weekdayOfKey(key)); // weeks start on Sunday (Israel)
}
export function monthOfKey(key: string): string {
  return key.slice(0, 7);
}
export function addMonths(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const t = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}`;
}
export function daysInMonth(month: string): number {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}
export const isDayKey = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));
export const isMonthKey = (v: unknown): v is string => typeof v === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(v);

/** A UTC range that safely contains the local days [from, to] (padded by a day on each side). */
export function paddedRange(fromKey: string, toKey: string) {
  return { from: new Date(`${addDays(fromKey, -1)}T00:00:00Z`).toISOString(), to: new Date(`${addDays(toKey, 2)}T00:00:00Z`).toISOString() };
}

/** Month grid as weeks of day keys (Sunday first), including leading/trailing days of neighbouring months. */
export function monthGrid(month: string): string[][] {
  const first = `${month}-01`;
  let cursor = startOfWeekKey(first);
  const last = `${month}-${pad(daysInMonth(month))}`;
  const weeks: string[][] = [];
  while (cursor <= last) {
    weeks.push(Array.from({ length: 7 }, (_, i) => addDays(cursor, i)));
    cursor = addDays(cursor, 7);
  }
  return weeks;
}

export const minutesOfDay = (p: Pick<ZonedParts, "hour" | "minute">) => p.hour * 60 + p.minute;

/** Greedy column layout for overlapping events in one day (Google-Calendar style). */
export function layoutDay<T extends { start: number; end: number }>(events: T[]): (T & { col: number; cols: number })[] {
  const sorted = [...events].sort((a, b) => a.start - b.start || b.end - a.end);
  const placed: (T & { col: number; cols: number })[] = [];
  let cluster: (T & { col: number; cols: number })[] = [];
  let clusterEnd = -1;
  const flush = () => {
    const cols = Math.max(1, ...cluster.map((c) => c.col + 1));
    for (const c of cluster) c.cols = cols;
    placed.push(...cluster);
    cluster = [];
  };
  for (const ev of sorted) {
    if (cluster.length && ev.start >= clusterEnd) flush();
    const used = new Set(cluster.filter((c) => c.end > ev.start).map((c) => c.col));
    let col = 0;
    while (used.has(col)) col++;
    cluster.push({ ...ev, col, cols: 1 });
    clusterEnd = Math.max(clusterEnd, ev.end);
  }
  if (cluster.length) flush();
  return placed;
}

/* ----------------------------------------------------------------- join links */
const JOIN_PATTERNS: { id: "zoom" | "meet" | "teams" | "webex" | "link"; re: RegExp }[] = [
  { id: "zoom", re: /https?:\/\/[\w.-]*zoom\.(us|com)\/[^\s]+/i },
  { id: "meet", re: /https?:\/\/meet\.google\.com\/[^\s]+/i },
  { id: "teams", re: /https?:\/\/teams\.(microsoft|live)\.com\/[^\s]+/i },
  { id: "webex", re: /https?:\/\/[\w.-]*webex\.com\/[^\s]+/i },
];

/** Finds a video-call link in free text (location / notes). Only http(s) URLs are ever returned. */
export function detectJoinLink(...texts: (string | null | undefined)[]): { url: string; provider: "zoom" | "meet" | "teams" | "webex" | "link" } | null {
  const hay = texts.filter(Boolean).join(" ");
  if (!hay) return null;
  for (const p of JOIN_PATTERNS) {
    const m = hay.match(p.re);
    if (m) return { url: m[0].replace(/[).,;]+$/, ""), provider: p.id };
  }
  const generic = hay.match(/https?:\/\/[^\s]+/i);
  return generic ? { url: generic[0].replace(/[).,;]+$/, ""), provider: "link" } : null;
}

/* ------------------------------------------------------------------------ ICS */
const icsEscape = (s: string) => s.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
const icsDate = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

/** RFC 5545 single-event calendar file (works with Google / Apple / Outlook). */
export function buildIcs(a: Pick<ApptRow, "id" | "title" | "starts_at" | "ends_at" | "location" | "notes">): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Super Coder Cloud//Appointments//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${a.id}@supercoder.cloud`,
    `DTSTAMP:${icsDate(new Date())}`,
    `DTSTART:${icsDate(new Date(a.starts_at))}`,
    `DTEND:${icsDate(new Date(a.ends_at))}`,
    `SUMMARY:${icsEscape(a.title)}`,
    ...(a.location ? [`LOCATION:${icsEscape(a.location)}`] : []),
    ...(a.notes ? [`DESCRIPTION:${icsEscape(a.notes)}`] : []),
    "BEGIN:VALARM",
    "TRIGGER:-PT15M",
    "ACTION:DISPLAY",
    "DESCRIPTION:Reminder",
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.join("\r\n");
}

/** Prefilled "add to Google Calendar" link. */
export function googleCalendarUrl(a: Pick<ApptRow, "title" | "starts_at" | "ends_at" | "location" | "notes">): string {
  const p = new URLSearchParams({ action: "TEMPLATE", text: a.title, dates: `${icsDate(new Date(a.starts_at))}/${icsDate(new Date(a.ends_at))}` });
  if (a.location) p.set("location", a.location);
  if (a.notes) p.set("details", a.notes);
  return `https://calendar.google.com/calendar/render?${p.toString()}`;
}

/* ----------------------------------------------------------------- statistics */
export interface ApptStats {
  total: number;
  active: number; // scheduled + confirmed
  completed: number;
  noShow: number;
  canceled: number;
  /** completed / (completed + no_show) — null when nothing has been resolved yet */
  showRate: number | null;
  noShowRate: number | null;
  cancelRate: number | null;
  /** completed / (everything that was due: completed + no_show + canceled) */
  completionRate: number | null;
  bookedHours: number;
  avgMinutes: number | null;
  avgLeadDays: number | null;
  byStatus: { status: string; count: number }[];
  byHost: { host: string | null; count: number; completed: number; noShow: number }[];
  byType: { type: string | null; count: number }[];
  /** 7×24 matrix, [weekday 0=Sun][hour] = appointments started at that hour */
  heat: number[][];
  heatMax: number;
  /** meetings per local week (key = Sunday date) */
  weekly: { week: string; total: number; completed: number; noShow: number; canceled: number }[];
  busiest: { weekday: number; hour: number; count: number } | null;
}

export function computeApptStats(rows: ApptRow[], timeZone: string, now = new Date()): ApptStats {
  const heat = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0));
  const byStatus = new Map<string, number>();
  const byHost = new Map<string | null, { count: number; completed: number; noShow: number }>();
  const byType = new Map<string | null, number>();
  const weekly = new Map<string, { total: number; completed: number; noShow: number; canceled: number }>();
  let completed = 0, noShow = 0, canceled = 0, active = 0, minutes = 0, minutesN = 0, leadDays = 0, leadN = 0, bookedMin = 0;

  for (const r of rows) {
    const s = new Date(r.starts_at);
    const e = new Date(r.ends_at);
    const status = String(r.status);
    byStatus.set(status, (byStatus.get(status) ?? 0) + 1);
    const host = byHost.get(r.host_id ?? null) ?? { count: 0, completed: 0, noShow: 0 };
    host.count++;
    if (status === "completed") host.completed++;
    if (status === "no_show") host.noShow++;
    byHost.set(r.host_id ?? null, host);
    byType.set(r.type_id ?? null, (byType.get(r.type_id ?? null) ?? 0) + 1);

    if (status === "completed") completed++;
    else if (status === "no_show") noShow++;
    else if (status === "canceled") canceled++;
    else active++;

    const p = zonedParts(s, timeZone);
    const wk = startOfWeekKey(dayKey(p));
    const w = weekly.get(wk) ?? { total: 0, completed: 0, noShow: 0, canceled: 0 };
    w.total++;
    if (status === "completed") w.completed++;
    if (status === "no_show") w.noShow++;
    if (status === "canceled") w.canceled++;
    weekly.set(wk, w);

    if (status !== "canceled") {
      heat[p.weekday]![p.hour]!++;
      const dur = (e.getTime() - s.getTime()) / 60_000;
      if (dur > 0) {
        minutes += dur;
        minutesN++;
        if (status === "completed" || status === "confirmed" || status === "scheduled") bookedMin += dur;
      }
    }
    if (r.created_at) {
      const lead = (s.getTime() - new Date(r.created_at).getTime()) / 86_400_000;
      if (lead >= 0 && Number.isFinite(lead)) {
        leadDays += lead;
        leadN++;
      }
    }
  }
  void now;
  let busiest: ApptStats["busiest"] = null;
  let heatMax = 0;
  heat.forEach((hours, weekday) =>
    hours.forEach((count, hour) => {
      if (count > heatMax) heatMax = count;
      if (count > 0 && (!busiest || count > busiest.count)) busiest = { weekday, hour, count };
    }),
  );
  const resolved = completed + noShow;
  const due = resolved + canceled;
  return {
    total: rows.length,
    active,
    completed,
    noShow,
    canceled,
    showRate: resolved ? completed / resolved : null,
    noShowRate: resolved ? noShow / resolved : null,
    cancelRate: rows.length ? canceled / rows.length : null,
    completionRate: due ? completed / due : null,
    bookedHours: Math.round((bookedMin / 60) * 10) / 10,
    avgMinutes: minutesN ? Math.round(minutes / minutesN) : null,
    avgLeadDays: leadN ? Math.round((leadDays / leadN) * 10) / 10 : null,
    byStatus: [...byStatus.entries()].map(([status, count]) => ({ status, count })).sort((a, b) => b.count - a.count),
    byHost: [...byHost.entries()].map(([host, v]) => ({ host, ...v })).sort((a, b) => b.count - a.count),
    byType: [...byType.entries()].map(([type, count]) => ({ type, count })).sort((a, b) => b.count - a.count),
    heat,
    heatMax,
    weekly: [...weekly.entries()].map(([week, v]) => ({ week, ...v })).sort((a, b) => a.week.localeCompare(b.week)),
    busiest,
  };
}

/* -------------------------------------------------------------- relative time */
/** "in 2 hours" / "3 days ago" using Intl.RelativeTimeFormat. */
export function relativeTime(target: Date | string, intl: string, now = new Date()): string {
  const diffMs = new Date(target).getTime() - now.getTime();
  const rtf = new Intl.RelativeTimeFormat(intl, { numeric: "auto" });
  const abs = Math.abs(diffMs);
  if (abs < 60_000) return rtf.format(0, "minute");
  if (abs < 3_600_000) return rtf.format(Math.round(diffMs / 60_000), "minute");
  if (abs < 86_400_000) return rtf.format(Math.round(diffMs / 3_600_000), "hour");
  return rtf.format(Math.round(diffMs / 86_400_000), "day");
}

/** Short colour token per status — shared by list, calendar and legend. */
export const STATUS_COLOR: Record<string, string> = {
  scheduled: "var(--accent)",
  confirmed: "var(--success)",
  completed: "var(--text-subtle)",
  canceled: "var(--danger)",
  no_show: "var(--warning)",
};
