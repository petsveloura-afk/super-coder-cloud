/**
 * Wave 38 — the pipeline brain (pure, dependency-free, unit-tested).
 *
 * Everything here is computed from data the app already has plus the stage history
 * (deal_stage_history). Nothing is invented: every score is explained by a list of
 * reason keys the UI translates, so a salesperson can always see *why*.
 *
 *  - dealHealth      0-100 score + level + reasons (freshness, close date, ownership, contact, time in stage)
 *  - adaptiveWinChance  the stage probability corrected by the deal's health
 *  - nextBestAction  the single most useful thing to do with a deal right now
 *  - stageFlow       per-stage time-in-stage, conversion to next stage and drop-off from history
 *  - bottleneck      the stage that slows the pipeline the most
 *  - forecast        commit / expected / best-case + a 6-month outlook
 *  - salesVelocity   classic velocity: open deals x win rate x avg deal / avg cycle
 *  - ownerBoard      per-owner load, weighted value, risk and win rate
 *  - focusList       the deals that deserve attention first
 */
const DAY = 86_400_000;

export type HealthLevel = "hot" | "healthy" | "cooling" | "risk";
export type HealthReason =
  | "fresh"
  | "stale"
  | "veryStale"
  | "overdue"
  | "closesSoon"
  | "noDate"
  | "noOwner"
  | "noContact"
  | "slowInStage"
  | "highValue"
  | "lateStage";

export interface BrainDeal {
  id: string;
  title: string;
  value: number;
  stage_id: string;
  expected_close_date: string | null;
  owner_id: string | null;
  contact_id: string | null;
  updated_at?: string | null;
  created_at?: string | null;
  /** when the deal entered its current stage (from stage history); falls back to updated_at */
  stage_entered_at?: string | null;
}

export interface BrainStage {
  id: string;
  probability: number;
  position?: number;
}

export interface HealthResult {
  score: number;
  level: HealthLevel;
  reasons: HealthReason[];
  ageDays: number | null;
  daysInStage: number | null;
  daysToClose: number | null;
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const ts = (s: string | null | undefined) => {
  const t = s ? Date.parse(s) : NaN;
  return Number.isFinite(t) ? t : null;
};
/** calendar-day difference between a YYYY-MM-DD date and "now" (positive = in the future) */
export function daysUntil(date: string | null | undefined, now = new Date()): number | null {
  if (!date || !/^\d{4}-\d{2}-\d{2}/.test(date)) return null;
  const [y, m, d] = date.slice(0, 10).split("-").map(Number);
  const target = Date.UTC(y!, m! - 1, d!);
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((target - today) / DAY);
}

export interface HealthContext {
  now?: Date;
  /** average days won deals stay in a stage (median-ish benchmark) — optional */
  stageBenchmarkDays?: Map<string, number>;
  /** average open deal value — used to flag big deals */
  avgValue?: number;
  /** rank of the stage among all stages, 0..1 (0 first stage, 1 last) */
  stageProgress?: Map<string, number>;
}

export function dealHealth(d: BrainDeal, ctx: HealthContext = {}): HealthResult {
  const now = ctx.now ?? new Date();
  const nowMs = now.getTime();
  const upd = ts(d.updated_at);
  const ageDays = upd === null ? null : Math.max(0, Math.floor((nowMs - upd) / DAY));
  const entered = ts(d.stage_entered_at) ?? upd;
  const daysInStage = entered === null ? null : Math.max(0, Math.floor((nowMs - entered) / DAY));
  const daysToClose = daysUntil(d.expected_close_date, now);
  const reasons: HealthReason[] = [];
  let score = 70;

  // freshness — the strongest signal: a deal nobody touches is a dying deal
  if (ageDays !== null) {
    if (ageDays <= 3) {
      score += 14;
      reasons.push("fresh");
    } else if (ageDays > 30) {
      score -= 34;
      reasons.push("veryStale");
    } else if (ageDays > 14) {
      score -= 20;
      reasons.push("stale");
    } else if (ageDays > 7) score -= 8;
  }

  // close date
  if (daysToClose === null) {
    score -= 10;
    reasons.push("noDate");
  } else if (daysToClose < 0) {
    score -= clamp(14 + Math.abs(daysToClose) * 0.6, 14, 30);
    reasons.push("overdue");
  } else if (daysToClose <= 7) {
    score += 6;
    reasons.push("closesSoon");
  }

  // ownership & contact
  if (!d.owner_id) {
    score -= 10;
    reasons.push("noOwner");
  }
  if (!d.contact_id) {
    score -= 7;
    reasons.push("noContact");
  }

  // time in the current stage versus what is normal for it
  const bench = ctx.stageBenchmarkDays?.get(d.stage_id);
  if (daysInStage !== null && bench && bench > 0 && daysInStage > Math.max(5, bench * 2)) {
    score -= 10;
    reasons.push("slowInStage");
  }

  // progress through the pipeline is good news
  const progress = ctx.stageProgress?.get(d.stage_id);
  if (progress !== undefined && progress >= 0.66) {
    score += 6;
    reasons.push("lateStage");
  }
  if (ctx.avgValue && ctx.avgValue > 0 && d.value >= ctx.avgValue * 2) reasons.push("highValue");

  score = Math.round(clamp(score, 0, 100));
  const level: HealthLevel = score >= 82 ? "hot" : score >= 62 ? "healthy" : score >= 40 ? "cooling" : "risk";
  return { score, level, reasons, ageDays, daysInStage, daysToClose };
}

/** The stage's own probability corrected by how healthy the deal is (never 0 or 100 — nothing is certain). */
export function adaptiveWinChance(stageProbability: number, health: number): number {
  const factor = 0.55 + (clamp(health, 0, 100) / 100) * 0.9; // 0.55 .. 1.45
  return Math.round(clamp(stageProbability * factor, 1, 99));
}

export type NextActionKey =
  | "setCloseDate"
  | "assignOwner"
  | "attachContact"
  | "rescheduleClose"
  | "reviveNow"
  | "followUp"
  | "pushToClose"
  | "unblockStage"
  | "keepGoing";

export interface NextAction {
  key: NextActionKey;
  urgency: 1 | 2 | 3; // 3 = do it now
}

export function nextBestAction(d: BrainDeal, h: HealthResult): NextAction {
  if (h.reasons.includes("overdue")) return { key: "rescheduleClose", urgency: 3 };
  if (h.reasons.includes("veryStale")) return { key: "reviveNow", urgency: 3 };
  if (!d.owner_id) return { key: "assignOwner", urgency: 3 };
  if (h.reasons.includes("stale")) return { key: "followUp", urgency: 2 };
  if (h.reasons.includes("slowInStage")) return { key: "unblockStage", urgency: 2 };
  if (!d.contact_id) return { key: "attachContact", urgency: 2 };
  if (h.reasons.includes("noDate")) return { key: "setCloseDate", urgency: 1 };
  if (h.daysToClose !== null && h.daysToClose <= 7 && h.level !== "risk") return { key: "pushToClose", urgency: 2 };
  return { key: "keepGoing", urgency: 1 };
}

/* ------------------------------------------------------------ stage flow --- */

export interface StageHistoryRow {
  deal_id: string;
  from_stage_id: string | null;
  to_stage_id: string;
  entered_at: string;
}

export interface StageFlow {
  stageId: string;
  /** deals that ever entered this stage */
  entered: number;
  /** deals that went on to a later stage (or were won) */
  advanced: number;
  /** % of entered deals that advanced (null while there is no data) */
  conversion: number | null;
  /** average days deals spent in the stage once they left it */
  avgDays: number | null;
  /** deals sitting in the stage right now */
  current: number;
}

/**
 * stages must be in pipeline order. history = rows from deal_stage_history for the pipeline's deals.
 * wonDealIds: deals that were won — they count as having advanced through every stage they reached.
 */
export function stageFlow(stages: { id: string }[], history: StageHistoryRow[], currentStage: Map<string, string>, wonDealIds: Set<string> = new Set()): StageFlow[] {
  const order = new Map(stages.map((s, i) => [s.id, i]));
  const byDeal = new Map<string, StageHistoryRow[]>();
  for (const r of history) {
    if (!order.has(r.to_stage_id)) continue;
    const list = byDeal.get(r.deal_id) ?? [];
    list.push(r);
    byDeal.set(r.deal_id, list);
  }
  const enteredSet = new Map<string, Set<string>>();
  const advancedSet = new Map<string, Set<string>>();
  const durations = new Map<string, number[]>();
  for (const s of stages) {
    enteredSet.set(s.id, new Set());
    advancedSet.set(s.id, new Set());
    durations.set(s.id, []);
  }
  for (const [dealId, rows] of byDeal) {
    rows.sort((a, b) => Date.parse(a.entered_at) - Date.parse(b.entered_at));
    let furthest = -1;
    rows.forEach((r, i) => {
      const idx = order.get(r.to_stage_id)!;
      enteredSet.get(r.to_stage_id)!.add(dealId);
      furthest = Math.max(furthest, idx);
      const next = rows[i + 1];
      if (next) {
        const spent = (Date.parse(next.entered_at) - Date.parse(r.entered_at)) / DAY;
        if (Number.isFinite(spent) && spent >= 0) durations.get(r.to_stage_id)!.push(spent);
      }
    });
    // every stage strictly before the furthest one reached was passed; a won deal passed its last stage too
    const lastIdx = order.get(rows[rows.length - 1]!.to_stage_id)!;
    for (const r of rows) {
      const idx = order.get(r.to_stage_id)!;
      if (idx < furthest || (wonDealIds.has(dealId) && idx === lastIdx)) advancedSet.get(r.to_stage_id)!.add(dealId);
    }
  }
  const currentCount = new Map<string, number>();
  for (const sid of currentStage.values()) currentCount.set(sid, (currentCount.get(sid) ?? 0) + 1);
  return stages.map((s) => {
    const entered = enteredSet.get(s.id)!.size;
    const advanced = advancedSet.get(s.id)!.size;
    const d = durations.get(s.id)!;
    return {
      stageId: s.id,
      entered,
      advanced,
      conversion: entered ? Math.round((advanced / entered) * 100) : null,
      avgDays: d.length ? Math.round((d.reduce((a, b) => a + b, 0) / d.length) * 10) / 10 : null,
      current: currentCount.get(s.id) ?? 0,
    };
  });
}

/** The stage that costs the most: long dwell time combined with a weak hand-off to the next stage. */
export function bottleneck(flow: StageFlow[]): { stageId: string; reason: "slow" | "leaky" } | null {
  const withData = flow.filter((f) => f.entered >= 3);
  if (withData.length < 2) return null;
  const maxDays = Math.max(...withData.map((f) => f.avgDays ?? 0));
  const avgDays = withData.reduce((s, f) => s + (f.avgDays ?? 0), 0) / withData.length;
  const slow = withData.find((f) => (f.avgDays ?? 0) === maxDays && maxDays > avgDays * 1.5 && maxDays >= 3);
  const leakyList = withData.filter((f) => f.conversion !== null).sort((a, b) => (a.conversion ?? 0) - (b.conversion ?? 0));
  const leaky = leakyList[0];
  // the last stage only "converts" through won/lost, so it is judged by speed alone
  const lastId = flow[flow.length - 1]?.stageId;
  if (slow) return { stageId: slow.stageId, reason: "slow" };
  if (leaky && leaky.stageId !== lastId && (leaky.conversion ?? 100) < 50) return { stageId: leaky.stageId, reason: "leaky" };
  return null;
}

/* -------------------------------------------------------------- forecast --- */

export interface ForecastDeal {
  value: number;
  stage_id: string;
  expected_close_date: string | null;
  health: number;
}

export interface Forecast {
  /** deals very likely to close this month: closing this month, late stage (>= 70%) and not at risk */
  commit: number;
  /** weighted by the health-adjusted win chance, expected this month */
  expected: number;
  /** everything expected this month at full value */
  bestCase: number;
  /** total open value regardless of date */
  pipelineTotal: number;
  /** weighted value of the next 6 months, starting this month; "undated" collects deals without a date */
  months: { key: string; weighted: number; total: number; count: number }[];
  undated: { weighted: number; total: number; count: number };
}

export function forecast(deals: ForecastDeal[], probability: Map<string, number>, now = new Date()): Forecast {
  const monthKeys: string[] = [];
  for (let i = 0; i < 6; i++) {
    const dt = new Date(now.getFullYear(), now.getMonth() + i, 1);
    monthKeys.push(`${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}`);
  }
  const months = monthKeys.map((key) => ({ key, weighted: 0, total: 0, count: 0 }));
  const undated = { weighted: 0, total: 0, count: 0 };
  let commit = 0, expected = 0, bestCase = 0, pipelineTotal = 0;
  for (const d of deals) {
    pipelineTotal += d.value;
    const p = probability.get(d.stage_id) ?? 0;
    const win = adaptiveWinChance(p, d.health);
    const weighted = (d.value * win) / 100;
    const slot = d.expected_close_date ? months.find((m) => m.key === d.expected_close_date!.slice(0, 7)) : undefined;
    if (!d.expected_close_date) {
      undated.weighted += weighted;
      undated.total += d.value;
      undated.count++;
      continue;
    }
    if (slot) {
      slot.weighted += weighted;
      slot.total += d.value;
      slot.count++;
    }
    if (d.expected_close_date.slice(0, 7) === monthKeys[0]) {
      expected += weighted;
      bestCase += d.value;
      if (p >= 70 && d.health >= 55) commit += d.value;
    }
  }
  const r = (n: number) => Math.round(n);
  return {
    commit: r(commit),
    expected: r(expected),
    bestCase: r(bestCase),
    pipelineTotal: r(pipelineTotal),
    months: months.map((m) => ({ ...m, weighted: r(m.weighted), total: r(m.total) })),
    undated: { weighted: r(undated.weighted), total: r(undated.total), count: undated.count },
  };
}

/* -------------------------------------------------------------- velocity --- */

export interface ClosedDeal {
  status: "won" | "lost";
  value: number;
  created_at?: string | null;
  closed_at?: string | null;
}

export interface Velocity {
  /** value the pipeline produces per day: open x win rate x avg won value / avg cycle days */
  perDay: number | null;
  perMonth: number | null;
  avgCycleDays: number | null;
  winRate: number | null;
}

export function salesVelocity(openCount: number, closed: ClosedDeal[]): Velocity {
  const won = closed.filter((d) => d.status === "won");
  const winRate = closed.length ? won.length / closed.length : null;
  const avgWon = won.length ? won.reduce((s, d) => s + d.value, 0) / won.length : null;
  const cycles = won
    .map((d) => {
      const a = ts(d.created_at), b = ts(d.closed_at);
      return a !== null && b !== null && b >= a ? (b - a) / DAY : null;
    })
    .filter((x): x is number => x !== null);
  const avgCycle = cycles.length ? cycles.reduce((a, b) => a + b, 0) / cycles.length : null;
  if (winRate === null || avgWon === null || avgCycle === null || avgCycle <= 0) {
    return { perDay: null, perMonth: null, avgCycleDays: avgCycle === null ? null : Math.round(avgCycle * 10) / 10, winRate: winRate === null ? null : Math.round(winRate * 100) };
  }
  const perDay = (openCount * winRate * avgWon) / avgCycle;
  return { perDay: Math.round(perDay), perMonth: Math.round(perDay * 30), avgCycleDays: Math.round(avgCycle * 10) / 10, winRate: Math.round(winRate * 100) };
}

/* ----------------------------------------------------------- owner board --- */

export interface OwnerRow {
  ownerId: string | null;
  open: number;
  value: number;
  weighted: number;
  atRisk: number;
  won: number;
  lost: number;
  winRate: number | null;
}

export function ownerBoard(
  open: { owner_id: string | null; value: number; weighted: number; health: HealthLevel }[],
  closed: { owner_id: string | null; status: "won" | "lost" }[],
): OwnerRow[] {
  const rows = new Map<string, OwnerRow>();
  const get = (id: string | null) => {
    const k = id ?? "∅";
    let r = rows.get(k);
    if (!r) {
      r = { ownerId: id, open: 0, value: 0, weighted: 0, atRisk: 0, won: 0, lost: 0, winRate: null };
      rows.set(k, r);
    }
    return r;
  };
  for (const d of open) {
    const r = get(d.owner_id);
    r.open++;
    r.value += d.value;
    r.weighted += d.weighted;
    if (d.health === "risk" || d.health === "cooling") r.atRisk++;
  }
  for (const c of closed) {
    const r = get(c.owner_id);
    if (c.status === "won") r.won++;
    else r.lost++;
  }
  return [...rows.values()]
    .map((r) => ({ ...r, value: Math.round(r.value), weighted: Math.round(r.weighted), winRate: r.won + r.lost ? Math.round((r.won / (r.won + r.lost)) * 100) : null }))
    .sort((a, b) => b.weighted - a.weighted || b.open - a.open);
}

/* ------------------------------------------------------------- focus list --- */

export interface FocusItem {
  id: string;
  priority: number;
  action: NextAction;
  health: HealthResult;
}

/**
 * Deals worth acting on first: bigger weighted value x how urgent the next action is x how much
 * health could still be saved. Deals that are simply fine ("keepGoing") are left out.
 */
export function focusList(
  deals: (BrainDeal & { winChance: number; health: HealthResult })[],
  limit = 5,
): FocusItem[] {
  return deals
    .map((d) => {
      const action = nextBestAction(d, d.health);
      const weighted = (d.value * d.winChance) / 100;
      const rescue = 1 + (100 - d.health.score) / 100; // a cooling deal is worth rescuing more than a dead one is lost
      return { id: d.id, action, health: d.health, priority: Math.round(weighted * action.urgency * rescue) };
    })
    .filter((x) => x.action.key !== "keepGoing")
    .sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id))
    .slice(0, limit);
}

/* --------------------------------------------------------- helpers for UI --- */

export const BRAIN_FLAGS = ["hot", "risk", "unassigned", "nodate"] as const;
export type BrainFlag = (typeof BRAIN_FLAGS)[number];

export const DEAL_SORTS = ["position", "value", "health", "close", "age"] as const;
export type DealSort = (typeof DEAL_SORTS)[number];

export function matchesBrainFlag(flag: BrainFlag, d: Pick<BrainDeal, "owner_id" | "expected_close_date">, h: Pick<HealthResult, "level">): boolean {
  switch (flag) {
    case "hot": return h.level === "hot";
    case "risk": return h.level === "risk" || h.level === "cooling";
    case "unassigned": return !d.owner_id;
    case "nodate": return !d.expected_close_date;
  }
}

export function compareDeals(sort: DealSort): (a: { value: number; position: number; health: HealthResult; expected_close_date: string | null }, b: { value: number; position: number; health: HealthResult; expected_close_date: string | null }) => number {
  switch (sort) {
    case "value": return (a, b) => b.value - a.value;
    case "health": return (a, b) => a.health.score - b.health.score; // weakest first: that is where attention goes
    case "close": return (a, b) => (a.expected_close_date ?? "9999-12-31").localeCompare(b.expected_close_date ?? "9999-12-31");
    case "age": return (a, b) => (b.health.ageDays ?? -1) - (a.health.ageDays ?? -1);
    default: return (a, b) => a.position - b.position;
  }
}

/** Stage progress 0..1 for every stage of a pipeline (stages in order). */
export function stageProgressMap(stages: { id: string }[]): Map<string, number> {
  const n = Math.max(1, stages.length - 1);
  return new Map(stages.map((s, i) => [s.id, i / n]));
}
