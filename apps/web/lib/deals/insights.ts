/**
 * Wave 24 — pipeline insights (pure, unit-tested): how old a deal is, what is stuck or late,
 * win rate, average won deal and the forecast for this month.
 */
export const STALE_DAYS = 14;
const DAY = 86_400_000;

export function dealAgeDays(updatedAt: string | null | undefined, now = Date.now()): number | null {
  const t = updatedAt ? Date.parse(updatedAt) : NaN;
  return Number.isFinite(t) ? Math.max(0, Math.floor((now - t) / DAY)) : null;
}

export const isStale = (ageDays: number | null) => ageDays !== null && ageDays > STALE_DAYS;

/** Expected close date (YYYY-MM-DD) already passed — compared by calendar day. */
export function isOverdue(expectedClose: string | null | undefined, now = new Date()): boolean {
  if (!expectedClose || !/^\d{4}-\d{2}-\d{2}/.test(expectedClose)) return false;
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  return expectedClose.slice(0, 10) < today;
}

export function inThisMonth(date: string | null | undefined, now = new Date()): boolean {
  if (!date) return false;
  const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  return date.slice(0, 7) === ym;
}

export interface InsightDeal {
  value: number;
  stage_id: string;
  expected_close_date: string | null;
  updated_at?: string | null;
}

export interface PipelineInsights {
  winRate: number | null; // % of closed deals (last 90 days) that were won
  avgWon: number | null;
  forecastMonth: number; // weighted value of open deals expected to close this month
  staleCount: number;
  overdueCount: number;
  closedWon: number;
  closedLost: number;
}

export function pipelineInsights(
  open: InsightDeal[],
  closed: { status: "won" | "lost"; value: number }[],
  probability: Map<string, number>,
  now = new Date(),
): PipelineInsights {
  const won = closed.filter((d) => d.status === "won");
  const lost = closed.length - won.length;
  const nowMs = now.getTime();
  let forecastMonth = 0, staleCount = 0, overdueCount = 0;
  for (const d of open) {
    if (inThisMonth(d.expected_close_date, now)) forecastMonth += (d.value * (probability.get(d.stage_id) ?? 0)) / 100;
    if (isStale(dealAgeDays(d.updated_at, nowMs))) staleCount++;
    if (isOverdue(d.expected_close_date, now)) overdueCount++;
  }
  return {
    winRate: closed.length ? Math.round((won.length / closed.length) * 100) : null,
    avgWon: won.length ? Math.round(won.reduce((s, d) => s + d.value, 0) / won.length) : null,
    forecastMonth: Math.round(forecastMonth),
    staleCount,
    overdueCount,
    closedWon: won.length,
    closedLost: lost,
  };
}

export const DEAL_FLAGS = ["mine", "stale", "overdue"] as const;
export type DealFlag = (typeof DEAL_FLAGS)[number];
