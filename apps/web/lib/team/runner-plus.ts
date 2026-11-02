import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { applyHealth, cleanHealth, recordResult, summarizeHealth, modelKey, type HealthRow, type HealthState } from "./model-health-core";
import { classifyFailure, isStuck, nextRetry, teamHealth, type TeamHealth } from "./reliability-core";

/**
 * The digital team — server side of the upgrade: model health (circuit breaker) with a best-effort copy in the
 * database, stuck-task recovery, retry with backoff for failed tasks, and the data of the health screen.
 * Every function here is optional glue: when a table or column is not there yet (migration not run) it quietly does
 * nothing, and the team keeps working exactly as before.
 */
const db = () => createAdminClient();

let cache: { at: number; state: HealthState; dirty: boolean } | null = null;
let lastSave = 0;

export async function loadModelHealth(): Promise<HealthState> {
  if (cache && Date.now() - cache.at < 30_000) return cache.state;
  try {
    const { data } = await db().from("team_model_health").select("state").eq("id", "global").maybeSingle();
    const fromDb = cleanHealth(data?.state);
    // keep what this instance learned since the last load (it may be newer than the database copy)
    cache = { at: Date.now(), state: cache?.dirty ? { ...fromDb, ...cache.state } : fromDb, dirty: cache?.dirty ?? false };
  } catch {
    cache = { at: Date.now(), state: cache?.state ?? {}, dirty: cache?.dirty ?? false };
  }
  return cache.state;
}

/** reorders a route by model health (nothing is removed from it) */
export async function healthyRoute<T extends { provider: string; model: string }>(route: T[]): Promise<T[]> {
  if (route.length < 2) return route;
  return applyHealth(route, await loadModelHealth(), Date.now());
}

/** records the outcome of one model call; saved to the database at most every 10 seconds */
export async function noteModelResult(provider: string, model: string, ok: boolean, error?: string | null): Promise<void> {
  const state = cache?.state ?? {};
  const next = recordResult(state, modelKey(provider, model), ok, Date.now(), error);
  cache = { at: cache?.at ?? Date.now(), state: next, dirty: true };
  if (Date.now() - lastSave < 10_000) return;
  lastSave = Date.now();
  try {
    await db().from("team_model_health").upsert({ id: "global", state: next, updated_at: new Date().toISOString() });
    if (cache) cache.dirty = false;
  } catch {
    /* the table may not exist yet — the in-memory state still protects this instance */
  }
}

/* ------------------------------------------------------------------ recovery + retry */

const MAX_ATTEMPTS = 4;

/** tasks stuck "in progress" (server died mid-run) go back to the queue — and stop after too many tries */
export async function recoverStuckTasks(orgId: string): Promise<number> {
  const a = db();
  const now = Date.now();
  const { data } = await a.from("team_tasks").select("id, started_at, attempts").eq("organization_id", orgId).eq("status", "in_progress").lt("started_at", new Date(now - 10 * 60_000).toISOString()).limit(20);
  let n = 0;
  for (const t of (data ?? []) as { id: string; started_at: string | null; attempts: number | null }[]) {
    if (!isStuck(t.started_at, now)) continue;
    const attempts = (t.attempts ?? 0) + 1;
    const patch = attempts >= MAX_ATTEMPTS ? { status: "failed", error: "stuck_too_often", attempts, finished_at: new Date().toISOString() } : { status: "pending", error: "recovered_stuck", attempts };
    const { data: done } = await a.from("team_tasks").update({ ...patch, updated_at: new Date().toISOString() }).eq("organization_id", orgId).eq("id", t.id).eq("status", "in_progress").select("id");
    if (done?.length) n++;
  }
  return n;
}

/** failed tasks whose reason is temporary (AI busy, network) come back after a growing pause */
export async function retryFailedTasks(orgId: string): Promise<number> {
  const a = db();
  const now = Date.now();
  const { data } = await a.from("team_tasks").select("id, error, attempts, finished_at").eq("organization_id", orgId).eq("status", "failed").gte("finished_at", new Date(now - 6 * 3600_000).toISOString()).limit(20);
  let n = 0;
  for (const t of (data ?? []) as { id: string; error: string | null; attempts: number | null; finished_at: string | null }[]) {
    const attempts = t.attempts ?? 0;
    const d = nextRetry(t.error, attempts, t.finished_at ? Date.parse(t.finished_at) : now, MAX_ATTEMPTS, () => 0.5);
    if (!d.retry || d.at === null || d.at > now) continue;
    const { data: done } = await a.from("team_tasks").update({ status: "pending", error: null, attempts: attempts + 1, finished_at: null, updated_at: new Date().toISOString() }).eq("organization_id", orgId).eq("id", t.id).eq("status", "failed").select("id");
    if (done?.length) n++;
  }
  return n;
}

/**
 * upgrade 6: tasks blocked ONLY because a dependency had failed (error "dependency_failed") come back by themselves once
 * none of their dependencies is failed / canceled any more (e.g. the dependency was retried and is pending, running or done).
 * Before, one temporary AI failure left the whole chain blocked forever. A dependency that stays failed keeps them blocked.
 */
export async function reviveBlockedDependents(orgId: string): Promise<number> {
  const a = db();
  const { data } = await a.from("team_tasks").select("id, depends_on").eq("organization_id", orgId).eq("status", "blocked").eq("error", "dependency_failed").limit(50);
  const rows = (data ?? []) as { id: string; depends_on: string[] | null }[];
  if (!rows.length) return 0;
  const depIds = [...new Set(rows.flatMap((r) => r.depends_on ?? []))];
  if (!depIds.length) return 0;
  const { data: deps } = await a.from("team_tasks").select("id, status").eq("organization_id", orgId).in("id", depIds);
  const status = new Map(((deps ?? []) as { id: string; status: string }[]).map((d) => [d.id, d.status]));
  let n = 0;
  for (const r of rows) {
    const ds = (r.depends_on ?? []).map((d) => status.get(d));
    if (ds.some((x) => x === "failed" || x === "canceled" || x === "blocked")) continue;
    const { data: done } = await a.from("team_tasks").update({ status: "pending", error: null, finished_at: null, updated_at: new Date().toISOString() }).eq("organization_id", orgId).eq("id", r.id).eq("status", "blocked").eq("error", "dependency_failed").select("id");
    if (done?.length) n++;
  }
  return n;
}

/**
 * upgrade 6b: a task that stayed blocked by a failed dependency for more than 3 days is closed as canceled (nothing is deleted —
 * it stays in the history with the reason "expired_blocked"), so the board does not fill with dead items.
 */
export async function expireStaleBlocked(orgId: string): Promise<number> {
  const a = db();
  const cutoff = new Date(Date.now() - 3 * 86_400_000).toISOString();
  const { data } = await a.from("team_tasks").update({ status: "canceled", error: "expired_blocked", finished_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("organization_id", orgId).eq("status", "blocked").eq("error", "dependency_failed").lt("updated_at", cutoff).select("id");
  return data?.length ?? 0;
}

/** both, for the team clock; never throws */
export async function maintainTeam(orgId: string): Promise<{ recovered: number; retried: number }> {
  try {
    const recovered = await recoverStuckTasks(orgId);
    const retried = await retryFailedTasks(orgId);
    await reviveBlockedDependents(orgId).catch(() => 0);
    await expireStaleBlocked(orgId).catch(() => 0);
    return { recovered, retried };
  } catch {
    return { recovered: 0, retried: 0 };
  }
}

/* ------------------------------------------------------------------ the health screen */

export interface TeamHealthView {
  verdict: TeamHealth;
  models: HealthRow[];
  failures: { id: string; title: string; reason: string; error: string | null; at: string | null }[];
  stuck: number;
  failed24h: number;
}

export async function loadTeamHealth(orgId: string, settings: { enabled: boolean; emergency_stop: boolean }): Promise<TeamHealthView> {
  const a = db();
  const now = Date.now();
  const state = await loadModelHealth();
  const models = summarizeHealth(state, now);
  const [{ data: failed }, { count: stuck }] = await Promise.all([
    a.from("team_tasks").select("id, title, error, finished_at").eq("organization_id", orgId).in("status", ["failed", "blocked"]).gte("updated_at", new Date(now - 86_400_000).toISOString()).order("updated_at", { ascending: false }).limit(8),
    a.from("team_tasks").select("id", { count: "exact", head: true }).eq("organization_id", orgId).eq("status", "in_progress").lt("started_at", new Date(now - 10 * 60_000).toISOString()),
  ]);
  const rows = (failed ?? []) as { id: string; title: string; error: string | null; finished_at: string | null }[];
  const open = models.filter((m) => m.circuit === "open").length;
  return {
    verdict: teamHealth({ enabled: settings.enabled, emergencyStop: settings.emergency_stop, stuck: stuck ?? 0, failedLast24h: rows.length, openCircuits: open, totalModels: models.length, lastTickAt: null, now }),
    models: models.slice(0, 8),
    failures: rows.map((r) => ({ id: r.id, title: r.title.slice(0, 120), reason: classifyFailure(r.error).code, error: r.error?.slice(0, 120) ?? null, at: r.finished_at })),
    stuck: stuck ?? 0,
    failed24h: rows.length,
  };
}
