/**
 * Team AI gate (additive, pure, unit-tested). Several team tasks of the same server instance used to start their AI calls at
 * the same moment (a clock beat runs up to 3 tasks, plus "run now" clicks, plus the smart agents). Against the same keys that
 * is a self-made burst: the providers answer "429 / busy" to all of them together and every task ends "AI engines busy".
 *
 * A small counting gate spreads them: at most N team AI calls run at once per instance; the next one waits a short moment for
 * a free slot (never longer than it is allowed to wait — then it simply goes ahead, the gate never blocks work).
 */
export class AiGate {
  private active = 0;
  private readonly waiters: (() => void)[] = [];
  constructor(private readonly max = 4) {}

  /** a release function; resolves when a slot is free or after `waitMs` (then the call goes ahead anyway) */
  async acquire(waitMs: number): Promise<() => void> {
    if (this.active < this.max) {
      this.active++;
      return this.releaser();
    }
    // whether a slot was freed or the wait ran out, the call goes ahead (the gate spreads load, it never blocks work)
    await new Promise<boolean>((resolve) => {
      const wake = () => {
        clearTimeout(timer);
        resolve(true);
      };
      const timer = setTimeout(() => {
        const i = this.waiters.indexOf(wake);
        if (i >= 0) this.waiters.splice(i, 1);
        resolve(false);
      }, Math.max(0, waitMs));
      this.waiters.push(wake);
    });
    this.active++;
    return this.releaser();
  }

  private releaser(): () => void {
    let done = false;
    return () => {
      if (done) return;
      done = true;
      this.active = Math.max(0, this.active - 1);
      const next = this.waiters.shift();
      if (next) next();
    };
  }

  get running(): number {
    return this.active;
  }
  get waiting(): number {
    return this.waiters.length;
  }
}

/** how long a call may wait for a slot: a few seconds, never eating into the time the call itself needs */
export function gateWaitMs(leftMs: number | null): number {
  if (leftMs === null) return 8_000;
  return Math.max(0, Math.min(8_000, leftMs - 30_000));
}
