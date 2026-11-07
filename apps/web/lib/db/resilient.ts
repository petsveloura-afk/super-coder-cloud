import { nextRetryDelay, type BackoffOptions } from "./resilient-core";

/**
 * Resilient wrapper for IDEMPOTENT database calls (additive). Runs the call; when it fails with a transient error (see
 * resilient-core), waits with exponential backoff + jitter and tries again, inside a total time budget. Works with both
 * styles the code base uses:
 *   - Supabase results ({ data, error }) — a transient `error` is retried, the last result is returned as is;
 *   - thrown errors — a transient throw is retried, the last error is re-thrown.
 *
 * A permanent error (bad input, permission, constraint) returns immediately — retrying would not help.
 */

export interface DbRetryOptions extends BackoffOptions {
  /** total tries (default 3) */
  attempts?: number;
  /** total time budget, ms (default 4000) */
  budgetMs?: number;
  /** a label for the log line */
  label?: string;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function withDbRetry<T>(call: () => PromiseLike<T>, opts: DbRetryOptions = {}): Promise<T> {
  const attempts = Math.max(1, opts.attempts ?? 3);
  const budgetMs = opts.budgetMs ?? 4000;
  const started = Date.now();
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await call();
      const err = res && typeof res === "object" && "error" in (res as object) ? (res as { error?: unknown }).error : null;
      if (!err) return res;
      const wait = nextRetryDelay({ attempt, maxAttempts: attempts, error: err, elapsedMs: Date.now() - started, budgetMs }, opts);
      if (wait === null) return res;
      console.warn("db-retry", opts.label ?? "call", attempt + 1, String((err as { message?: string }).message ?? err).slice(0, 120));
      await sleep(wait);
    } catch (e) {
      const wait = nextRetryDelay({ attempt, maxAttempts: attempts, error: e, elapsedMs: Date.now() - started, budgetMs }, opts);
      if (wait === null) throw e;
      console.warn("db-retry", opts.label ?? "call", attempt + 1, String((e as Error)?.message ?? e).slice(0, 120));
      await sleep(wait);
    }
  }
}
