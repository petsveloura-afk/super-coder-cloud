import "server-only";
import { backgroundShouldWait, enterLive, GATE_DEFAULTS, leaveLive, liveCount, type LiveState } from "./lane-gate-core";

/**
 * Wave 66 — server glue for the lane priority. In-process only. A live ("interactive") request registers and goes on at once —
 * it never waits for anything. A background request waits at most `maxWaitMs` (3s) while live requests run, then goes on.
 * Any error → no wait. The returned function releases the lease; calling it twice is harmless.
 */
let live: LiveState = {};
let seq = 0;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function laneEnter(lane: "interactive" | "background", o: { maxWaitMs?: number; pollMs?: number } = {}): Promise<() => void> {
  try {
    if (lane === "interactive") {
      const id = `l${++seq}`;
      live = enterLive(live, id, Date.now());
      let done = false;
      return () => {
        if (done) return;
        done = true;
        live = leaveLive(live, id);
      };
    }
    const maxWait = o.maxWaitMs ?? GATE_DEFAULTS.maxWaitMs;
    const poll = Math.max(10, o.pollMs ?? GATE_DEFAULTS.pollMs);
    const t0 = Date.now();
    while (backgroundShouldWait(live, Date.now(), Date.now() - t0, maxWait)) await sleep(Math.min(poll, Math.max(1, maxWait - (Date.now() - t0))));
  } catch {
    /* never block a request because of the courtesy gate */
  }
  return () => undefined;
}

/** how many live requests are running right now (tests / diagnostics) */
export function liveNow(): number {
  return liveCount(live, Date.now());
}

/** tests only */
export function resetLaneGate(): void {
  live = {};
}
