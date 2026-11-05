/**
 * Wave 66 — lane priority (pure, unit-tested). A live customer request is never delayed; a background request (reports, team
 * tasks, insights) may step aside for a few seconds while live requests are running, and then goes on anyway.
 * The state is only in this server instance (no table): it is a courtesy, not a lock.
 */

export const GATE_DEFAULTS = {
  /** the longest a background request ever waits */
  maxWaitMs: 3000,
  pollMs: 100,
  /** a live request that never reported back stops counting after this (a crashed call can never block anyone) */
  liveTtlMs: 35_000,
};

/** id → the time (epoch ms) the live request stops counting */
export type LiveState = Record<string, number>;

export function enterLive(state: LiveState, id: string, now: number, ttlMs = GATE_DEFAULTS.liveTtlMs): LiveState {
  return { ...pruneLive(state, now), [id]: now + ttlMs };
}

export function leaveLive(state: LiveState, id: string): LiveState {
  if (!(id in state)) return state;
  const { [id]: _gone, ...rest } = state;
  return rest;
}

export function pruneLive(state: LiveState, now: number): LiveState {
  return Object.fromEntries(Object.entries(state).filter(([, until]) => until > now));
}

export function liveCount(state: LiveState, now: number): number {
  return Object.values(state).filter((until) => until > now).length;
}

/** should a background request keep waiting? yes only while live requests run AND it has waited less than the cap */
export function backgroundShouldWait(state: LiveState, now: number, waitedMs: number, maxWaitMs = GATE_DEFAULTS.maxWaitMs): boolean {
  return waitedMs < maxWaitMs && liveCount(state, now) > 0;
}
