/**
 * Resilience upgrade (pure, unit-tested) — "busy for a moment" is not "failed".
 *
 * When every engine is resting for only a few seconds (a per-minute limit that is about to open), the router used to give
 * up at once and the work waited for the next clock tick (minutes). Now the call waits exactly as long as the soonest
 * engine needs (a few seconds, never longer than the cap) and tries ONE more pass. Live conversations wait less than
 * background work; nothing waits when the soonest engine is far away (then the normal retry with backoff takes over).
 */
type Env = Record<string, string | undefined>;

export interface BusyWaitInput {
  /** ms until some engine is usable again (RouterError.retryInMs); null = nothing configured */
  retryInMs: number | null;
  lane: "interactive" | "background";
  /** how long this call has already taken */
  elapsedMs: number;
  /** was this error "busy" (rate limits / resting) — other failures are not waited for */
  busy: boolean;
}

export function busyWaitCaps(env: Env = {}): { interactive: number; background: number; total: number } {
  const n = (v: string | undefined, d: number) => (Number.isFinite(Number(v)) && Number(v) >= 0 && v !== undefined && v !== "" ? Number(v) : d);
  return {
    interactive: n(env.AI_BUSY_WAIT_INTERACTIVE_MS, 5_000),
    background: n(env.AI_BUSY_WAIT_MS, 15_000),
    // the whole call (first pass + wait + second pass) must stay well inside a 60s serverless function
    total: n(env.AI_BUSY_WAIT_TOTAL_MS, 38_000),
  };
}

/** ms to wait before one more pass, or 0 = do not wait (report busy as before) */
export function busyWaitMs(input: BusyWaitInput, env: Env = {}): number {
  if (!input.busy || input.retryInMs === null || input.retryInMs < 0) return 0;
  const caps = busyWaitCaps(env);
  const cap = input.lane === "interactive" ? caps.interactive : caps.background;
  if (cap <= 0) return 0;
  const wait = Math.max(400, Math.round(input.retryInMs) + 400);
  if (wait > cap) return 0;
  // leave room for the second pass (at least 10s)
  if (input.elapsedMs + wait + 10_000 > caps.total) return 0;
  return wait;
}

/** the time budget of the second pass: whatever is left of the total, at most 20s, at least 8s */
export function secondPassBudget(elapsedMs: number, waitedMs: number, env: Env = {}): number {
  const left = busyWaitCaps(env).total - elapsedMs - waitedMs;
  return Math.max(8_000, Math.min(20_000, left));
}
