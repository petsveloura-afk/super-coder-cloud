/**
 * Wave 24 — subscription helpers (pure, unit-tested): usage %, a plan advisor, yearly savings and
 * the renewal countdown. The advisor only *suggests*; it never changes a plan by itself.
 */
export const PLAN_ORDER = ["free", "pro", "business", "enterprise"] as const;
export type PlanKey = (typeof PLAN_ORDER)[number];

export function usagePct(used: number, limit: number | null): number | null {
  if (limit === null || !Number.isFinite(limit)) return null; // unlimited
  if (limit <= 0) return used > 0 ? 100 : 0;
  return Math.min(999, Math.round((used / limit) * 100));
}

export interface Meter { key: string; used: number; limit: number | null }
export interface PlanAdvice {
  level: "ok" | "near" | "over";
  hot: { key: string; pct: number }[]; // meters at ≥ 80 %, highest first
  suggest: PlanKey | null; // the next plan up that has room
}

export function planAdvice(meters: Meter[], current: string, plans: { key: string; limits: Record<string, number | null | undefined> }[]): PlanAdvice {
  const hot = meters
    .map((m) => ({ key: m.key, pct: usagePct(m.used, m.limit) }))
    .filter((m): m is { key: string; pct: number } => m.pct !== null && m.pct >= 80)
    .sort((a, b) => b.pct - a.pct);
  const level: PlanAdvice["level"] = hot.some((h) => h.pct >= 100) ? "over" : hot.length ? "near" : "ok";
  if (!hot.length) return { level, hot, suggest: null };
  const idx = PLAN_ORDER.indexOf(current as PlanKey);
  const used = new Map(meters.map((m) => [m.key, m.used]));
  for (const key of PLAN_ORDER.slice(Math.max(0, idx + 1))) {
    const p = plans.find((x) => x.key === key);
    if (!p) continue;
    const fits = hot.every((h) => {
      const l = p.limits?.[h.key];
      return l === null || l === undefined || (used.get(h.key) ?? 0) < Number(l) * 0.8;
    });
    if (fits) return { level, hot, suggest: key };
  }
  return { level, hot, suggest: idx < PLAN_ORDER.length - 1 ? "enterprise" : null };
}

/** Yearly vs. 12 × monthly: how much is saved and the monthly equivalent. */
export function yearlySavings(monthly: number, yearly: number) {
  if (!(monthly > 0) || !(yearly > 0)) return null;
  const full = monthly * 12;
  const saved = Math.max(0, full - yearly);
  return { saved: Math.round(saved), pct: Math.round((saved / full) * 100), perMonth: Math.round((yearly / 12) * 100) / 100 };
}

/** Whole days until the period ends (0 = today, negative = passed). */
export function daysLeft(periodEnd: string | null | undefined, now = Date.now()): number | null {
  const t = periodEnd ? Date.parse(periodEnd) : NaN;
  return Number.isFinite(t) ? Math.ceil((t - now) / 86_400_000) : null;
}
