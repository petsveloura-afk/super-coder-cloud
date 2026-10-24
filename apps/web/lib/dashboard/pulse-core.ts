/**
 * Wave 20 — "AI at work" band on the overview: today's figures from real rows only.
 * Pure helpers (no I/O) so they are unit-tested.
 */

/** Midnight today in the organization's time zone, as an ISO timestamp (UTC). */
export function startOfTodayIso(tz: string, now: Date = new Date()): string {
  let zone = tz;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
  } catch {
    zone = "UTC";
  }
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: zone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
      .formatToParts(now)
      .filter((p) => p.type !== "literal")
      .map((p) => [p.type, Number(p.value)]),
  ) as Record<"year" | "month" | "day" | "hour" | "minute" | "second", number>;
  // the zone's wall clock "now" as if it were UTC, minus how far into the day it is
  const wallAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  const offsetMs = wallAsUtc - Math.floor(now.getTime() / 1000) * 1000;
  const midnightWallAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, 0, 0, 0);
  return new Date(midnightWallAsUtc - offsetMs).toISOString();
}

/** Average of the per-reply timings (ms) the agent stored on its messages; null when none. */
export function averageReplyMs(metas: unknown[]): number | null {
  const vals: number[] = [];
  for (const m of metas) {
    const total = (m as { timing?: { total?: unknown } } | null)?.timing?.total;
    if (typeof total === "number" && Number.isFinite(total) && total > 0 && total < 10 * 60_000) vals.push(total);
  }
  if (!vals.length) return null;
  return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
}

/** 2400 → "2.4"; 65000 → "65" — the number shown next to the unit (seconds). */
export function secondsLabel(ms: number | null): string | null {
  if (ms === null) return null;
  const s = ms / 1000;
  return s < 10 ? s.toFixed(1) : String(Math.round(s));
}
