/** Job-run helpers (pure): how many items a job handled, and whether a job is overdue. */
const COUNT_KEYS = new Set(["published", "made", "sent", "claimed", "filled", "updated", "processed", "ingested", "alerts", "actions", "count", "delivered", "created", "synced", "posted", "drafted", "added", "expired", "merged", "scored"]);

export function countItems(result: unknown, depth = 0): number {
  if (!result || typeof result !== "object" || depth > 3) return 0;
  let n = 0;
  for (const [k, v] of Object.entries(result as Record<string, unknown>)) {
    if (typeof v === "number" && Number.isFinite(v) && COUNT_KEYS.has(k)) n += Math.max(0, Math.floor(v));
    else if (v && typeof v === "object") n += countItems(v, depth + 1);
  }
  return n;
}

/** Expected cadence of each scheduled job (minutes) — used to flag a job that stopped running. */
export const JOB_CADENCE_MIN: Record<string, number> = {
  social: 5,
  "social-brain": 5,
  growth: 5,
  agents: 5,
  "meta-sync": 5,
  followups: 5,
  "billing-sweep": 5,
};

export type JobHealth = "ok" | "late" | "failing" | "never";

export function jobHealth(last: { status: string; started_at: string } | null, lastOk: string | null, cadenceMin: number, now = new Date()): JobHealth {
  if (!last) return "never";
  const sinceOk = lastOk ? (now.getTime() - new Date(lastOk).getTime()) / 60000 : Infinity;
  if (last.status === "error" && sinceOk > cadenceMin * 3) return "failing";
  const sinceRun = (now.getTime() - new Date(last.started_at).getTime()) / 60000;
  if (sinceRun > Math.max(30, cadenceMin * 6)) return "late";
  return "ok";
}
