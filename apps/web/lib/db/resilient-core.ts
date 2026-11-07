/**
 * Resilient database calls (additive, pure — no I/O). The platform talks to Postgres through Supabase's HTTP API; under load
 * a call can fail for a moment for reasons that a second try fixes (a dropped connection, a gateway 502/503/504, a pooler
 * that is momentarily full, a serialization conflict or deadlock that Postgres itself asks to retry). This module decides
 * which errors are such transient ones and how long to wait before the next try (exponential backoff with full jitter, so a
 * burst of retries does not hit the database at the same instant).
 *
 * A retry is only safe for a call that is IDEMPOTENT (a read, an upsert, or an RPC that is written to run once — like the
 * credit grant, which returns "already" the second time). Never wrap a plain insert that may have succeeded.
 */

export interface DbErrorLike {
  message?: string | null;
  code?: string | null;
  details?: string | null;
  hint?: string | null;
  status?: number | null;
  name?: string | null;
}

/** Postgres / PostgREST / network codes that mean "try again" */
const TRANSIENT_PG_CODES = new Set([
  "40001", // serialization_failure
  "40P01", // deadlock_detected
  "55P03", // lock_not_available
  "57P01", // admin_shutdown
  "57P02", // crash_shutdown
  "57P03", // cannot_connect_now
  "53300", // too_many_connections
  "53400", // configuration_limit_exceeded
  "08000", // connection_exception
  "08003", // connection_does_not_exist
  "08006", // connection_failure
  "08001", // sqlclient_unable_to_establish_sqlconnection
  "08004", // sqlserver_rejected_establishment_of_sqlconnection
  "PGRST000", // PostgREST: could not connect to the database
  "PGRST001", // PostgREST: database connection error
  "PGRST002", // PostgREST: schema cache not ready
  "PGRST003", // PostgREST: pool timeout
]);

const TRANSIENT_STATUS = new Set([408, 425, 429, 500, 502, 503, 504, 520, 521, 522, 523, 524]);

const TRANSIENT_TEXT = /fetch failed|network|socket hang up|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|EPIPE|UND_ERR|timed? ?out|timeout|connection (?:terminated|reset|closed|refused)|too many (?:connections|clients)|remaining connection slots|server closed the connection|could not serialize|deadlock detected|canceling statement due to lock timeout|bad gateway|service unavailable|gateway time-?out|temporarily unavailable/i;

/** never retried: wrong input, missing permission, constraint violations, not found */
const PERMANENT_PG_CLASS = /^(22|23|42|28|P0)/;

export function isTransientDbError(e: unknown): boolean {
  if (!e) return false;
  const err = (typeof e === "object" ? e : { message: String(e) }) as DbErrorLike;
  const code = String(err.code ?? "");
  if (code && TRANSIENT_PG_CODES.has(code)) return true;
  if (code && PERMANENT_PG_CLASS.test(code)) return false;
  if (typeof err.status === "number" && TRANSIENT_STATUS.has(err.status)) return true;
  if (err.name === "AbortError" || err.name === "TimeoutError") return true;
  const text = `${err.message ?? ""} ${err.details ?? ""} ${err.hint ?? ""}`;
  return TRANSIENT_TEXT.test(text);
}

export interface BackoffOptions {
  /** first wait, ms (default 150) */
  baseMs?: number;
  /** the longest single wait, ms (default 2000) */
  maxMs?: number;
}

/** "full jitter" exponential backoff: a random wait between 0 and min(max, base·2^attempt) (attempt starts at 0) */
export function backoffDelay(attempt: number, opts: BackoffOptions = {}, random: () => number = Math.random): number {
  const base = opts.baseMs ?? 150;
  const max = opts.maxMs ?? 2000;
  const cap = Math.min(max, base * 2 ** Math.max(0, attempt));
  return Math.round(cap * Math.max(0, Math.min(1, random())));
}

export interface RetryPlanInput {
  attempt: number;
  maxAttempts: number;
  error: unknown;
  /** ms already spent */
  elapsedMs: number;
  /** the total budget, ms */
  budgetMs: number;
}

/** should we try again, and after how long (null = stop and return the error) */
export function nextRetryDelay(input: RetryPlanInput, opts: BackoffOptions = {}, random: () => number = Math.random): number | null {
  if (input.attempt + 1 >= input.maxAttempts) return null;
  if (!isTransientDbError(input.error)) return null;
  const wait = backoffDelay(input.attempt, opts, random);
  if (input.elapsedMs + wait >= input.budgetMs) return null;
  return wait;
}
