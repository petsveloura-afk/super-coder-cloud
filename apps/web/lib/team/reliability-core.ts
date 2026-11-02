/**
 * The digital team — 24/7 reliability helpers (pure, unit-tested): retry with backoff, a clear reason for every
 * failure, stuck-task recovery and "do not run twice" windows.
 */
export type FailureKind = "ai_busy" | "ai_unreadable" | "budget" | "policy" | "tool" | "network" | "input" | "unknown";

export interface FailureInfo {
  kind: FailureKind;
  retryable: boolean;
  /** stable code, used for an i18n key team.health.reason.<code> */
  code: string;
}

export function classifyFailure(error: string | null | undefined): FailureInfo {
  const e = (error ?? "").toLowerCase();
  if (!e) return { kind: "unknown", retryable: true, code: "unknown" };
  if (/emergency_stop|team_off|member_paused|plan_locked|tool_not_allowed|needs_screen|blocked:/.test(e)) return { kind: "policy", retryable: false, code: "policy" };
  if (/depth_limit|step_limit|credit|daily_credit_cap/.test(e)) return { kind: "budget", retryable: false, code: "budget" };
  if (/plan_unreadable|parse|json/.test(e)) return { kind: "ai_unreadable", retryable: true, code: "ai_unreadable" };
  if (/ai_failed|ai\.failed|all engines|rate|429|quota|busy|overload|503|502/.test(e)) return { kind: "ai_busy", retryable: true, code: "ai_busy" };
  if (/timeout|network|fetch failed|econn|etimedout|5\d\d/.test(e)) return { kind: "network", retryable: true, code: "network" };
  if (/invalid|missing|too_short|not_found|no_assignee/.test(e)) return { kind: "input", retryable: false, code: "input" };
  return { kind: "tool", retryable: true, code: "tool" };
}

/** exponential backoff with a cap; `rand` (0..1) adds jitter so many tasks do not retry in the same second */
export function backoffMs(attempt: number, o: { baseMs?: number; capMs?: number; jitter?: number } = {}, rand: () => number = Math.random): number {
  const base = o.baseMs ?? 30_000;
  const cap = o.capMs ?? 30 * 60_000;
  const exp = Math.min(cap, base * 2 ** Math.max(0, attempt - 1));
  const j = o.jitter ?? 0.2;
  return Math.round(exp * (1 - j + rand() * j * 2));
}

export interface RetryDecision {
  retry: boolean;
  /** epoch ms of the next attempt, null when not retrying */
  at: number | null;
  reason: string;
}

export function nextRetry(error: string | null | undefined, attempts: number, now: number, maxAttempts = 4, rand: () => number = Math.random): RetryDecision {
  const f = classifyFailure(error);
  if (!f.retryable) return { retry: false, at: null, reason: f.code };
  if (attempts >= maxAttempts) return { retry: false, at: null, reason: "max_attempts" };
  return { retry: true, at: now + backoffMs(attempts + 1, {}, rand), reason: f.code };
}

/** a task "in progress" for too long (the server died mid-run) can be put back — once per window */
export function isStuck(startedAt: string | number | null, now: number, ttlMs = 10 * 60_000): boolean {
  if (startedAt == null) return false;
  const t = typeof startedAt === "number" ? startedAt : Date.parse(startedAt);
  return Number.isFinite(t) && now - t > ttlMs;
}

/** the same job must not run again inside its minimum gap (cron fired twice, manual + automatic) */
export function tooSoon(lastRunAt: string | number | null, now: number, minGapMs: number): boolean {
  if (lastRunAt == null) return false;
  const t = typeof lastRunAt === "number" ? lastRunAt : Date.parse(lastRunAt);
  return Number.isFinite(t) && now - t < minGapMs;
}

export interface TeamHealth {
  level: "ok" | "degraded" | "down";
  issues: string[];
}

/** one verdict for the health screen */
export function teamHealth(input: { enabled: boolean; emergencyStop: boolean; stuck: number; failedLast24h: number; openCircuits: number; totalModels: number; lastTickAt: number | null; now: number }): TeamHealth {
  const issues: string[] = [];
  if (input.emergencyStop) issues.push("emergency_stop");
  if (!input.enabled) issues.push("team_off");
  if (input.stuck > 0) issues.push("stuck_tasks");
  if (input.failedLast24h >= 5) issues.push("many_failures");
  if (input.totalModels > 0 && input.openCircuits >= input.totalModels) issues.push("all_models_down");
  else if (input.openCircuits > 0) issues.push("some_models_down");
  if (input.lastTickAt !== null && input.now - input.lastTickAt > 30 * 60_000) issues.push("clock_late");
  const down = issues.some((i) => ["emergency_stop", "team_off", "all_models_down"].includes(i));
  return { level: down ? "down" : issues.length ? "degraded" : "ok", issues };
}
