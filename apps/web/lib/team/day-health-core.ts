/**
 * Wave 68 — "today's health" card for the business owner (pure, unit-tested): how many team tasks succeeded and failed in
 * the last 24 hours, why the failures happened (by the existing reason codes) and which AI provider is healthy.
 */
export interface DayTaskRow {
  status: string;
  error: string | null;
  finished_at: string | null;
}
export interface DayProviderRow {
  provider: string;
  calls: number;
  successRate: number | null;
  status: "healthy" | "neutral" | "shaky" | "degraded";
}
export interface DayHealth {
  windowHours: number;
  done: number;
  failed: number;
  reasons: { code: string; count: number }[];
  providers: { provider: string; calls: number; successPct: number | null; status: DayProviderRow["status"] }[];
}

export function summarizeDay(rows: DayTaskRow[], now: number, reasonOf: (error: string | null) => string, providers: DayProviderRow[] = [], windowHours = 24): DayHealth {
  const since = now - windowHours * 3_600_000;
  let done = 0;
  let failed = 0;
  const by = new Map<string, number>();
  for (const r of rows) {
    const t = r.finished_at ? Date.parse(r.finished_at) : Number.NaN;
    if (!Number.isFinite(t) || t < since || t > now + 60_000) continue;
    if (r.status === "done") done++;
    else if (r.status === "failed") {
      failed++;
      let code = "unknown";
      try {
        code = reasonOf(r.error) || "unknown";
      } catch {
        /* an unreadable error is "unknown" */
      }
      by.set(code, (by.get(code) ?? 0) + 1);
    }
  }
  const reasons = [...by.entries()].map(([code, count]) => ({ code, count })).sort((a, b) => b.count - a.count || a.code.localeCompare(b.code)).slice(0, 5);
  const order = { healthy: 0, neutral: 1, shaky: 2, degraded: 3 } as const;
  const prov = providers
    .filter((p) => p && typeof p.provider === "string" && p.provider)
    .map((p) => ({ provider: p.provider, calls: p.calls, successPct: p.successRate == null ? null : Math.round(p.successRate * 100), status: p.status }))
    .sort((a, b) => order[a.status] - order[b.status] || b.calls - a.calls)
    .slice(0, 8);
  return { windowHours, done, failed, reasons, providers: prov };
}
