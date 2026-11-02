/**
 * The digital team — operations settings (pure, unit-tested): quiet hours, SLA target, digests, duplicate removal and
 * protections. Stored as one JSON object in team_settings.ops; anything missing or invalid falls back to a safe default,
 * so a business that never opens the screen (or has not run the migration) behaves exactly like before.
 */
export interface OpsSettings {
  quiet: { enabled: boolean; start: number; end: number };
  sla: { targetMin: number };
  digest: { daily: boolean; weekly: boolean };
  dedupe: boolean;
  protect: { rateLimits: boolean; anomalyFreeze: boolean; recipientCap: number };
}

export const DEFAULT_OPS: OpsSettings = {
  quiet: { enabled: false, start: 22, end: 7 },
  sla: { targetMin: 60 },
  digest: { daily: true, weekly: true },
  dedupe: true,
  protect: { rateLimits: true, anomalyFreeze: true, recipientCap: 5 },
};

const int = (v: unknown, min: number, max: number, d: number) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= min && n <= max ? n : d;
};
const bool = (v: unknown, d: boolean) => (typeof v === "boolean" ? v : d);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/** any stored value → a complete, valid settings object */
export function cleanOps(raw: unknown): OpsSettings {
  const r = obj(raw);
  const q = obj(r.quiet);
  const s = obj(r.sla);
  const d = obj(r.digest);
  const p = obj(r.protect);
  return {
    quiet: { enabled: bool(q.enabled, DEFAULT_OPS.quiet.enabled), start: int(q.start, 0, 23, DEFAULT_OPS.quiet.start), end: int(q.end, 0, 23, DEFAULT_OPS.quiet.end) },
    sla: { targetMin: int(s.targetMin, 5, 1440, DEFAULT_OPS.sla.targetMin) },
    digest: { daily: bool(d.daily, DEFAULT_OPS.digest.daily), weekly: bool(d.weekly, DEFAULT_OPS.digest.weekly) },
    dedupe: bool(r.dedupe, DEFAULT_OPS.dedupe),
    protect: { rateLimits: bool(p.rateLimits, DEFAULT_OPS.protect.rateLimits), anomalyFreeze: bool(p.anomalyFreeze, DEFAULT_OPS.protect.anomalyFreeze), recipientCap: int(p.recipientCap, 1, 50, DEFAULT_OPS.protect.recipientCap) },
  };
}

/** local calendar parts in a time zone (used for "once a day" / "Sunday" decisions) */
export function localParts(now: number, tz: string): { date: string; hour: number; weekday: number } {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23", weekday: "short" }).formatToParts(new Date(now));
    const get = (t: string) => parts.find((x) => x.type === t)?.value ?? "";
    const wd = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
    return { date: `${get("year")}-${get("month")}-${get("day")}`, hour: Number(get("hour")) % 24, weekday: wd < 0 ? 0 : wd };
  } catch {
    const d = new Date(now);
    return { date: d.toISOString().slice(0, 10), hour: d.getUTCHours(), weekday: d.getUTCDay() };
  }
}

/** which digests are due now: the morning one from 07:00, the weekly one on Sunday morning; `done` = keys already posted */
export function digestsDue(now: number, tz: string, ops: OpsSettings, done: Set<string>): { key: string; period: "day" | "week" }[] {
  const p = localParts(now, tz);
  if (p.hour < 7) return [];
  const out: { key: string; period: "day" | "week" }[] = [];
  if (ops.digest.daily && !done.has(`day:${p.date}`)) out.push({ key: `day:${p.date}`, period: "day" });
  if (ops.digest.weekly && p.weekday === 0 && !done.has(`week:${p.date}`)) out.push({ key: `week:${p.date}`, period: "week" });
  return out;
}

/** customer-facing sends wait for the owner during quiet hours (only when the owner turned quiet hours on) */
export function sendsShouldWait(isQuiet: boolean, ops: OpsSettings, customerFacing: boolean): boolean {
  return ops.quiet.enabled && isQuiet && customerFacing;
}
