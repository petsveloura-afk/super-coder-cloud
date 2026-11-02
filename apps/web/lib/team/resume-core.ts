/**
 * Upgrade 5 — tasks held by the DAILY credit cap resume by themselves (pure, unit-tested).
 * Only the daily cap is time-recoverable. Per-task limits (steps, task credits, depth) are NOT resumed: they would stop again at once.
 */
export const RESUMABLE_HOLD = "daily_credit_cap";
/** headroom needed before one held task is put back (a typical task costs 10-25 credits) */
export const CREDITS_PER_RESUME = 15;
export const MAX_RESUME_PER_TICK = 3;

export function isResumableHold(status: string, error: string | null | undefined): boolean {
  return status === "blocked" && error === RESUMABLE_HOLD;
}

/** how many held tasks may be put back now, given the daily cap and what was already used (cap 0 = unlimited) */
export function resumeBudget(dayCap: number, dayUsed: number): number {
  if (!(dayCap > 0)) return MAX_RESUME_PER_TICK;
  const left = dayCap - dayUsed;
  if (left < CREDITS_PER_RESUME) return 0;
  return Math.min(MAX_RESUME_PER_TICK, Math.floor(left / CREDITS_PER_RESUME));
}

/** oldest held tasks first, never more than the budget */
export function pickResumable<T extends { id: string; status: string; error: string | null; created_at: string }>(rows: T[], n: number): T[] {
  return rows
    .filter((r) => isResumableHold(r.status, r.error))
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .slice(0, Math.max(0, n));
}
