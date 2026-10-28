/**
 * Analytics — pure helpers (no I/O). Period-over-period deltas, funnel conversion,
 * rule-based highlights ("what stands out") and CSV export rows. Additive to the RPC data.
 */
import { csvCell } from "@/lib/format";

export interface Delta {
  /** current − previous */
  abs: number;
  /** (current − previous) / previous — null when there is no baseline */
  pct: number | null;
  dir: "up" | "down" | "flat";
}

export function delta(current: number, previous: number): Delta {
  const abs = current - previous;
  const pct = previous > 0 ? abs / previous : null;
  const dir = abs > 0 ? "up" : abs < 0 ? "down" : "flat";
  return { abs, pct, dir };
}

/**
 * The RPC only reports period metrics for "the last N days". Calling it with 2N and subtracting the
 * N-day result yields the previous N-day window — exactly, for additive metrics (counts and sums).
 */
export function previousWindow(current: number, doubled: number): number {
  return Math.max(0, doubled - current);
}

/** Last N month values as a plain number series for a sparkline. */
export function sparkSeries(months: { month: string; value: number }[], take = 12): number[] {
  return months.slice(-take).map((m) => Number(m.value) || 0);
}

export interface FunnelStep {
  name: string;
  value: number;
  deals: number;
  /** share of the first step still present */
  ofFirst: number | null;
  /** share of the previous step that reached this one (value based, capped at 100%) */
  fromPrev: number | null;
  /** drop-off vs. previous step (0..1) */
  drop: number | null;
}

/** Open-pipeline value per stage → conversion/drop-off between consecutive stages. */
export function funnelSteps(stages: { name: string; value: number; deals: number }[]): FunnelStep[] {
  const first = stages[0]?.value ?? 0;
  return stages.map((s, i) => {
    const prev = i > 0 ? stages[i - 1]!.value : null;
    const fromPrev = prev && prev > 0 ? Math.min(1, s.value / prev) : null;
    return {
      name: s.name,
      value: s.value,
      deals: s.deals,
      ofFirst: first > 0 ? Math.min(1, s.value / first) : null,
      fromPrev,
      drop: fromPrev === null ? null : 1 - fromPrev,
    };
  });
}

export interface Highlight {
  id: string;
  tone: "success" | "warning" | "accent" | "danger";
  /** i18n key under analytics.pro.hl.* */
  key: string;
  params: Record<string, string | number>;
}

export interface HighlightInput {
  winRate: number | null;
  closed: number;
  wonValue: number;
  prevWonValue: number;
  contactsNew: number;
  prevContactsNew: number;
  tasksOverdue: number;
  openDeals: number;
  openValue: number;
  weightedValue: number;
  bestSource: { source: string; count: number } | null;
  topSeller: { name: string; value: number } | null;
  bestRoasSource: { source: string; roas: number } | null;
  worstRoasSource: { source: string; roas: number } | null;
  ltvCac: number | null;
  biggestDrop: { name: string; drop: number } | null;
  meetings?: { showRate: number | null; noShowRate: number | null; upcoming: number } | null;
}

/** Rule-based observations — deterministic, no AI, only what the numbers say. */
export function buildHighlights(i: HighlightInput, fmt: { pct: (v: number) => string; money: (v: number) => string }): Highlight[] {
  const out: Highlight[] = [];
  const rev = delta(i.wonValue, i.prevWonValue);
  if (i.prevWonValue > 0 && rev.pct !== null) {
    out.push(
      rev.dir === "up"
        ? { id: "rev-up", tone: "success", key: "revUp", params: { pct: fmt.pct(Math.abs(rev.pct)) } }
        : rev.dir === "down"
          ? { id: "rev-down", tone: "warning", key: "revDown", params: { pct: fmt.pct(Math.abs(rev.pct)) } }
          : { id: "rev-flat", tone: "accent", key: "revFlat", params: {} },
    );
  } else if (i.wonValue > 0) {
    out.push({ id: "rev-first", tone: "success", key: "revFirst", params: { value: fmt.money(i.wonValue) } });
  }
  if (i.winRate !== null && i.closed >= 5) {
    out.push(i.winRate >= 0.5 ? { id: "win-good", tone: "success", key: "winGood", params: { rate: fmt.pct(i.winRate) } } : i.winRate < 0.25 ? { id: "win-low", tone: "warning", key: "winLow", params: { rate: fmt.pct(i.winRate) } } : { id: "win-mid", tone: "accent", key: "winMid", params: { rate: fmt.pct(i.winRate) } });
  }
  const leads = delta(i.contactsNew, i.prevContactsNew);
  if (i.prevContactsNew >= 5 && leads.pct !== null && Math.abs(leads.pct) >= 0.2) {
    out.push(leads.dir === "up" ? { id: "leads-up", tone: "success", key: "leadsUp", params: { pct: fmt.pct(Math.abs(leads.pct)) } } : { id: "leads-down", tone: "warning", key: "leadsDown", params: { pct: fmt.pct(Math.abs(leads.pct)) } });
  }
  if (i.bestSource && i.bestSource.count > 0) out.push({ id: "best-source", tone: "accent", key: "bestSource", params: { source: i.bestSource.source, count: i.bestSource.count } });
  if (i.bestRoasSource && i.bestRoasSource.roas >= 1) out.push({ id: "best-roas", tone: "success", key: "bestRoas", params: { source: i.bestRoasSource.source, roas: i.bestRoasSource.roas.toFixed(1) } });
  if (i.worstRoasSource && i.worstRoasSource.roas < 1 && i.worstRoasSource.source !== i.bestRoasSource?.source) out.push({ id: "worst-roas", tone: "danger", key: "worstRoas", params: { source: i.worstRoasSource.source, roas: i.worstRoasSource.roas.toFixed(1) } });
  if (i.ltvCac !== null) out.push(i.ltvCac >= 3 ? { id: "ltv-good", tone: "success", key: "ltvGood", params: { ratio: i.ltvCac.toFixed(1) } } : { id: "ltv-low", tone: "warning", key: "ltvLow", params: { ratio: i.ltvCac.toFixed(1) } });
  if (i.tasksOverdue > 0) out.push({ id: "overdue", tone: i.tasksOverdue >= 5 ? "danger" : "warning", key: "overdue", params: { count: i.tasksOverdue } });
  if (i.biggestDrop && i.biggestDrop.drop >= 0.4) out.push({ id: "drop", tone: "warning", key: "funnelDrop", params: { stage: i.biggestDrop.name, pct: fmt.pct(i.biggestDrop.drop) } });
  if (i.topSeller && i.topSeller.value > 0) out.push({ id: "top-seller", tone: "accent", key: "topSeller", params: { name: i.topSeller.name, value: fmt.money(i.topSeller.value) } });
  if (i.meetings) {
    if (i.meetings.noShowRate !== null && i.meetings.noShowRate > 0.2) out.push({ id: "m-noshow", tone: "warning", key: "meetingNoShow", params: { rate: fmt.pct(i.meetings.noShowRate) } });
    else if (i.meetings.showRate !== null && i.meetings.showRate >= 0.85) out.push({ id: "m-show", tone: "success", key: "meetingShow", params: { rate: fmt.pct(i.meetings.showRate) } });
  }
  if (i.openDeals > 0 && i.openValue > 0 && i.weightedValue / i.openValue < 0.2) out.push({ id: "pipe-weak", tone: "warning", key: "pipelineWeak", params: { pct: fmt.pct(i.weightedValue / i.openValue) } });
  return out.slice(0, 8);
}

/** Rows for the "download as CSV" button. Values are neutralised against formula injection by csvCell. */
export function analyticsCsv(rows: (string | number | null)[][]): string {
  return "\uFEFF" + rows.map((r) => r.map((c) => csvCell(c)).join(",")).join("\r\n");
}

/** Cumulative series (running total) for the revenue trend. */
export function cumulative(values: number[]): number[] {
  let sum = 0;
  return values.map((v) => (sum += Number(v) || 0));
}

/** Simple 3-point moving average used as a smooth trend line. */
export function movingAverage(values: number[], window = 3): number[] {
  return values.map((_, i) => {
    const from = Math.max(0, i - window + 1);
    const slice = values.slice(from, i + 1);
    return slice.reduce((a, b) => a + b, 0) / slice.length;
  });
}
