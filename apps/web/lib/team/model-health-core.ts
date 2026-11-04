/**
 * The digital team — model health / circuit breaker (pure, unit-tested).
 *
 * Problem it solves: a model that fails on EVERY call (e.g. gemini/gemini-3.8-flash) is still tried first, so each task
 * pays a slow failure + fallback. Here a failing model is skipped TEMPORARILY (circuit open) and probed again later
 * (half-open). Nothing is deleted from any configuration — a skipped model simply moves to the end of the route and
 * comes back by itself when its rest time ends or a probe succeeds.
 */
export interface HealthEntry {
  fails: number; // consecutive failures
  trips: number; // how many times the circuit opened in a row (drives the backoff)
  openUntil: number; // epoch ms; 0 = closed
  lastError: string | null;
  lastFailAt: number;
  lastOkAt: number;
  total: number;
  failed: number;
}
export type HealthState = Record<string, HealthEntry>;

export const HEALTH_DEFAULTS = { threshold: 2, baseMs: 30_000, capMs: 15 * 60_000, permanentThreshold: 1 };

export function modelKey(provider: string, model: string): string {
  return `${provider}/${model}`;
}

/** errors that will not fix themselves in seconds (model missing, bad key) trip the breaker at once */
export function isPermanentError(error: string | null | undefined): boolean {
  return /not found|does not exist|not supported|model_not_found|no endpoints|invalid api key|api key not valid|unauthor|permission|404|401|403/i.test(error ?? "");
}

const blank = (): HealthEntry => ({ fails: 0, trips: 0, openUntil: 0, lastError: null, lastFailAt: 0, lastOkAt: 0, total: 0, failed: 0 });

export function openMs(trips: number, o = HEALTH_DEFAULTS): number {
  return Math.min(o.capMs, o.baseMs * 2 ** Math.max(0, trips - 1));
}

/** the new state after one call finished (never mutates the input) */
export function recordResult(state: HealthState, key: string, ok: boolean, now: number, error?: string | null, o = HEALTH_DEFAULTS): HealthState {
  const cur = state[key] ?? blank();
  const next: HealthEntry = { ...cur, total: cur.total + 1 };
  if (ok) {
    next.fails = 0;
    next.trips = 0;
    next.openUntil = 0;
    next.lastOkAt = now;
    next.lastError = null;
  } else {
    next.failed = cur.failed + 1;
    next.fails = cur.fails + 1;
    next.lastFailAt = now;
    next.lastError = String(error ?? "unknown").slice(0, 160);
    const limit = isPermanentError(error) ? o.permanentThreshold : o.threshold;
    if (next.fails >= limit) {
      next.trips = cur.trips + 1;
      next.openUntil = now + openMs(next.trips, o);
      next.fails = 0;
    }
  }
  return { ...state, [key]: next };
}

export type CircuitState = "closed" | "open" | "half_open";

/** a probe window nobody used for this long is over: the model shows as healthy again instead of "checking" forever */
export const HALF_OPEN_STALE_MS = 20 * 60_000;

export function circuitOf(state: HealthState, key: string, now: number): CircuitState {
  const e = state[key];
  if (!e || e.openUntil === 0) return "closed";
  if (e.openUntil > now) return "open";
  return now - e.openUntil > HALF_OPEN_STALE_MS ? "closed" : "half_open";
}

/** old versions wrote the routing note "fallback_used" as if it were a failure of the first engine — never a real error */
export const LEGACY_NOT_AN_ERROR = /^(fallback_used|fallback|ai\.fallback_used)$/i;

/**
 * Reorders a route: healthy models first (original order kept), then half-open probes, then open ones LAST — so when
 * everything is open the route is still usable. Nothing is removed.
 */
export function applyHealth<T extends { provider: string; model: string }>(route: T[], state: HealthState, now: number): T[] {
  const bucket = (r: T) => {
    const c = circuitOf(state, modelKey(r.provider, r.model), now);
    return c === "closed" ? 0 : c === "half_open" ? 1 : 2;
  };
  return route
    .map((r, i) => ({ r, i, b: bucket(r) }))
    .sort((x, y) => x.b - y.b || x.i - y.i)
    .map((x) => x.r);
}

export interface HealthRow {
  key: string;
  circuit: CircuitState;
  openForMs: number;
  lastError: string | null;
  failRate: number; // 0..1
  total: number;
}

/** a flat list for the health screen: unhealthy first */
export function summarizeHealth(state: HealthState, now: number): HealthRow[] {
  return Object.entries(state)
    .map(([key, e]) => ({ key, circuit: circuitOf(state, key, now), openForMs: Math.max(0, e.openUntil - now), lastError: e.lastError, failRate: e.total ? e.failed / e.total : 0, total: e.total }))
    .sort((a, b) => (a.circuit === "closed" ? 1 : 0) - (b.circuit === "closed" ? 1 : 0) || b.failRate - a.failRate);
}

/** a state from the database JSON, tolerant to garbage */
export function cleanHealth(raw: unknown): HealthState {
  const out: HealthState = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!/^[a-z]{2,20}\/[A-Za-z0-9._:/@-]{2,100}$/.test(k) || !v || typeof v !== "object") continue;
    const e = v as Record<string, unknown>;
    const n = (x: unknown) => (typeof x === "number" && Number.isFinite(x) && x >= 0 ? x : 0);
    const entry: HealthEntry = { fails: n(e.fails), trips: n(e.trips), openUntil: n(e.openUntil), lastError: typeof e.lastError === "string" ? e.lastError.slice(0, 160) : null, lastFailAt: n(e.lastFailAt), lastOkAt: n(e.lastOkAt), total: n(e.total), failed: n(e.failed) };
    // a state written by the old bookkeeping bug: not a failure — the model is simply healthy
    if (entry.lastError && LEGACY_NOT_AN_ERROR.test(entry.lastError)) Object.assign(entry, { lastError: null, fails: 0, trips: 0, openUntil: 0 });
    out[k] = entry;
  }
  return out;
}

/** the i18n key (aiTeam.health.err.*) that explains a raw engine error to a person — no codes like "fallback_used" on screen */
export function humanModelErrorKey(error: string | null | undefined): string {
  const e = String(error ?? "");
  if (!e || LEGACY_NOT_AN_ERROR.test(e)) return "unknown";
  if (/empty/i.test(e)) return "empty";
  if (/quota|daily|per ?day|no free quota|resource_exhausted/i.test(e)) return "quota";
  if (/429|rate|busy|overload|limit/i.test(e)) return "rate";
  if (/404|not found|not available|does not exist|not supported|model_not_found|no endpoints/i.test(e)) return "model";
  if (/401|403|api key|unauthor|permission|invalid key/i.test(e)) return "auth";
  if (/5\d\d|timeout|aborted|fetch failed|econn|server/i.test(e)) return "server";
  return "unknown";
}
