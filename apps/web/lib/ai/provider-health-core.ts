/**
 * Wave 66 — provider health window (pure, unit-tested). Added next to router-core / resilience-core; nothing there changed.
 *
 * What it does: remembers, per AI provider, how the last 15 minutes of calls went (success and response time) and RE-RANKS the
 * candidates with it: a provider that is clearly failing is tried after the healthy ones.
 *
 * What it does NOT do:
 *   - it never removes a candidate. Taking an engine out of the round stays the job of the existing rests (capRest + ai_provider_rests);
 *   - a provider with fewer than MIN_SAMPLES calls in the window is NEUTRAL (never pushed back because of a small sample);
 *   - paid providers keep exactly the positions the paid providers had (free capacity is never swapped with paid capacity).
 */

export const HEALTH_WINDOW_MS = 15 * 60_000;
/** fewer calls than this in the window = not enough data = neutral */
export const MIN_SAMPLES = 3;
/** success rate below this (with enough data) = degraded */
export const DEGRADED_BELOW = 0.5;
/** success rate below this (with enough data) = shaky */
export const SHAKY_BELOW = 0.8;
/** per provider, the newest samples kept (bounds the memory) */
export const MAX_SAMPLES = 120;

export interface Sample {
  /** epoch ms */
  t: number;
  ok: boolean;
  /** response time of the call in ms */
  ms: number;
}
export type HealthWindow = Record<string, Sample[]>;

export interface ProviderHealth {
  calls: number;
  okCalls: number;
  /** 0..1, null when there is no data at all */
  successRate: number | null;
  /** average response time of the successful calls, null when none */
  avgMs: number | null;
  /** fewer than MIN_SAMPLES calls: not enough data to judge */
  neutral: boolean;
  degraded: boolean;
  shaky: boolean;
}

const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);

/** the new window after one call (never mutates the input; samples older than the window are dropped) */
export function recordSample(state: HealthWindow, provider: string, s: Sample, now: number): HealthWindow {
  if (!provider || !finite(s.t) || !finite(s.ms)) return state;
  const kept = (state[provider] ?? []).filter((x) => now - x.t <= HEALTH_WINDOW_MS);
  const next = [...kept, { t: s.t, ok: !!s.ok, ms: Math.max(0, Math.round(s.ms)) }].slice(-MAX_SAMPLES);
  return { ...state, [provider]: next };
}

export function providerHealth(state: HealthWindow, provider: string, now: number): ProviderHealth {
  const inWindow = (state[provider] ?? []).filter((x) => now - x.t <= HEALTH_WINDOW_MS);
  const calls = inWindow.length;
  const oks = inWindow.filter((x) => x.ok);
  const okCalls = oks.length;
  const neutral = calls < MIN_SAMPLES;
  const successRate = calls ? okCalls / calls : null;
  return {
    calls,
    okCalls,
    successRate,
    avgMs: okCalls ? Math.round(oks.reduce((a, x) => a + x.ms, 0) / okCalls) : null,
    neutral,
    degraded: !neutral && (successRate ?? 1) < DEGRADED_BELOW,
    shaky: !neutral && (successRate ?? 1) >= DEGRADED_BELOW && (successRate ?? 1) < SHAKY_BELOW,
  };
}

/** 0 = healthy or neutral, 1 = shaky, 2 = degraded */
export function healthBucket(h: ProviderHealth): 0 | 1 | 2 {
  return h.degraded ? 2 : h.shaky ? 1 : 0;
}

/**
 * Re-orders `items` WITHIN each class: the positions a class occupied are refilled with the same items, sorted by `cmp`
 * (stable: equal items keep their original order). Items of other classes never move. Nothing is added or removed.
 */
export function reorderWithin<T>(items: T[], classOf: (t: T) => string, cmp: (a: T, b: T) => number): T[] {
  const slots = new Map<string, { idx: number[]; list: { t: T; i: number }[] }>();
  items.forEach((t, i) => {
    const k = classOf(t);
    const s = slots.get(k) ?? { idx: [], list: [] };
    s.idx.push(i);
    s.list.push({ t, i });
    slots.set(k, s);
  });
  const out = items.slice();
  for (const s of slots.values()) {
    s.list.sort((a, b) => cmp(a.t, b.t) || a.i - b.i);
    s.idx.forEach((pos, n) => {
      out[pos] = s.list[n]!.t;
    });
  }
  return out;
}

/**
 * Candidates re-ranked by provider health: healthy / neutral first, shaky next, degraded last. Original order is kept inside
 * each tier (so the agent's choice, the lane order and the model order are untouched when nothing is wrong).
 * Free and paid providers are ranked separately and keep their own positions.
 */
export function rankByHealth<T extends { provider: string }>(cands: T[], state: HealthWindow, now: number, paid: readonly string[] = ["anthropic", "openai"]): T[] {
  const bucket = new Map<string, number>();
  const b = (p: string) => {
    let v = bucket.get(p);
    if (v === undefined) {
      v = healthBucket(providerHealth(state, p, now));
      bucket.set(p, v);
    }
    return v;
  };
  return reorderWithin(
    cands,
    (c) => (paid.includes(c.provider) ? "paid" : "free"),
    (x, y) => b(x.provider) - b(y.provider),
  );
}

export interface HealthRow {
  provider: string;
  calls: number;
  successRate: number | null;
  avgMs: number | null;
  status: "healthy" | "neutral" | "shaky" | "degraded";
}

/** a flat list for a health screen (wave 67 reads it): worst first */
export function summarizeWindow(state: HealthWindow, now: number): HealthRow[] {
  const rank = { degraded: 0, shaky: 1, neutral: 2, healthy: 3 } as const;
  return Object.keys(state)
    .map((provider) => {
      const h = providerHealth(state, provider, now);
      const status: HealthRow["status"] = h.degraded ? "degraded" : h.shaky ? "shaky" : h.neutral ? "neutral" : "healthy";
      return { provider, calls: h.calls, successRate: h.successRate, avgMs: h.avgMs, status };
    })
    .filter((r) => r.calls > 0)
    .sort((a, b) => rank[a.status] - rank[b.status] || a.provider.localeCompare(b.provider));
}
