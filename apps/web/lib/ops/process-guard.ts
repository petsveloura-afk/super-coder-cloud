/**
 * Always-on servers (Railway): a promise that fails with nobody waiting for it ("unhandled rejection") never crashes the server —
 * Next.js already logs it and keeps running. But on Vercel every request was its own short-lived process, so such failures were
 * mostly invisible; on one long-running server they add up. This adds ONE extra listener that also records them in Mission
 * Control (app_errors, redacted) so they are seen and fixed. It changes nothing about how the server reacts.
 *
 * At most 20 records per minute (a failure in a loop never floods the database); never throws; installed once per process.
 */

const g = globalThis as unknown as { __sccProcessGuard?: { at: number; n: number } };

export function guardBudget(state: { at: number; n: number }, now: number, perMinute = 20): boolean {
  if (now - state.at >= 60_000) {
    state.at = now;
    state.n = 0;
  }
  if (state.n >= perMinute) return false;
  state.n++;
  return true;
}

export function installProcessGuard(): boolean {
  if (g.__sccProcessGuard) return false;
  g.__sccProcessGuard = { at: Date.now(), n: 0 };
  const state = g.__sccProcessGuard;
  process.on("unhandledRejection", (reason: unknown) => {
    try {
      if (!guardBudget(state, Date.now())) return;
      // Next.js' "late-awaited prefetch" rejections are not real errors — skip aborted / postponed ones
      const name = (reason as { name?: string } | null)?.name ?? "";
      const digest = (reason as { digest?: string } | null)?.digest ?? "";
      if (name === "AbortError" || /NEXT_|DYNAMIC_SERVER_USAGE|HANGING_PROMISE/.test(`${digest} ${(reason as Error | null)?.message ?? ""}`)) return;
      void import("@/lib/ops/log")
        .then((m) => m.captureError(reason, { source: "server", route: "process:unhandledRejection", digest: digest || null }))
        .catch(() => undefined);
    } catch {
      /* never throw from a process listener */
    }
  });
  return true;
}
