import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { ROUTE_PROVIDERS } from "@/lib/ai/router-core";
import { backoffJitterMs, guardRoute, healthUpdates, noteCall, noteStart, providerHasKey, resetDay, skippedView, spreadTasks, type HealthUpdate, type Skipped, type UsageState } from "./stability-core";
import { classifyToolFailure, statusForToolFailure } from "./tool-failure-core";
import { classifyFailure } from "./reliability-core";
import { findExisting, planMerge, type WorkItem } from "./dedupe-core";
import { buildQueue, responseStats, slaAlert, type QueueItem } from "./response-queue-core";
import { canRestart, restartPatch, revivable, staleBlocked } from "./restart-core";
import { localizeTitle, titleInstruction } from "./title-i18n-core";

/**
 * Upgrade 8 / stage A, server side — connects the pure stability logic to the database and the AI call. Every function is
 * optional glue: on ANY error (missing table / column, no network) it falls back to the original behaviour and the team keeps
 * working. Keys are never read out, logged or returned: only "has a key" booleans are used.
 */
const db = () => createAdminClient();
type Lang = "he" | "en" | "ar";
const missing = (e: { message?: string; code?: string } | null | undefined) => !!e && (e.code === "42P01" || e.code === "42703" || e.code === "PGRST205" || e.code === "PGRST204" || /does not exist|schema cache|column/i.test(e.message ?? ""));

/* ------------------------------------------------------------------ provider usage (in memory + a best-effort copy in the database) */

let usage: UsageState = {};
let usageDay = new Date().toISOString().slice(0, 10);
let loadedAt = 0;
let lastSave = 0;
let lastSkipped: Skipped[] = [];

function rollDay() {
  const d = new Date().toISOString().slice(0, 10);
  if (d !== usageDay) {
    usage = resetDay(usage);
    usageDay = d;
  }
}

export async function loadUsage(): Promise<UsageState> {
  rollDay();
  if (Date.now() - loadedAt < 30_000) return usage;
  loadedAt = Date.now();
  try {
    const { data, error } = await db().from("team_provider_usage").select("provider, calls, rest_until").eq("day", usageDay);
    if (!error) {
      for (const r of (data ?? []) as { provider: string; calls: number; rest_until: string | null }[]) {
        const cur = usage[r.provider] ?? { restUntil: 0, dayCount: 0, streak: 0, inflight: 0 };
        usage = { ...usage, [r.provider]: { ...cur, dayCount: Math.max(cur.dayCount, r.calls), restUntil: Math.max(cur.restUntil, r.rest_until ? Date.parse(r.rest_until) : 0) } };
      }
    }
  } catch {
    /* the table may not exist yet — the in-memory state still protects this instance */
  }
  return usage;
}

/**
 * The route with the engines that should not be tried left out. Any error → the original route (never throws).
 * `kind` is the kind of work ("plan", "vision", …). The skipped engines are remembered for the settings screen.
 */
export async function guardTeamRoute<T extends { provider: string; model: string }>(kind: string, route: T[]): Promise<T[]> {
  try {
    const u = await loadUsage();
    const g = guardRoute(kind, route, { env: process.env, usage: u, now: Date.now() });
    if (g.skipped.length) lastSkipped = [...g.skipped, ...lastSkipped.filter((s) => !g.skipped.some((x) => x.provider === s.provider && x.reason === s.reason))].slice(0, 30);
    return g.route;
  } catch {
    return route;
  }
}

export function markCallStart(provider: string | undefined | null): void {
  if (!provider) return;
  try {
    rollDay();
    usage = noteStart(usage, provider);
  } catch {
    /* optional */
  }
}

/** one finished call: counters, rest time (Retry-After when the error text carries one), saved to the database at most every 15 s */
export async function markCallEnd(provider: string | undefined | null, ok: boolean, error?: string | null): Promise<void> {
  if (!provider) return;
  try {
    const ra = /retry[- ]?after[:= ]+(\d+)/i.exec(error ?? "")?.[1] ?? null;
    usage = noteCall(usage, provider, { ok, retryAfter: ra, error }, Date.now());
    if (Date.now() - lastSave < 15_000) return;
    lastSave = Date.now();
    const u = usage[provider];
    if (!u) return;
    await db().from("team_provider_usage").upsert({ provider, day: usageDay, calls: u.dayCount, failures: ok ? 0 : u.streak, rest_until: u.restUntil > Date.now() ? new Date(u.restUntil).toISOString() : null, last_error: ok ? null : String(error ?? "").slice(0, 200), updated_at: new Date().toISOString() }, { onConflict: "provider,day" });
  } catch {
    /* optional */
  }
}

/** what the circuit breaker learns from one call — the fix of the "fallback_used" bookkeeping (see stability-core.healthUpdates) */
export function healthUpdatesFor(input: Parameters<typeof healthUpdates>[0]): HealthUpdate[] {
  try {
    return healthUpdates(input);
  } catch {
    return [];
  }
}

/** the providers that are skipped right now and why — for the settings screen (reasons only; no keys, ever) */
export async function loadSkippedProviders(lang: Lang): Promise<{ key: string; reason: string; text: string; help: string | null }[]> {
  try {
    const u = await loadUsage();
    const rows: Skipped[] = [];
    for (const p of ROUTE_PROVIDERS) {
      if (!providerHasKey(p, process.env)) rows.push({ provider: p, model: "*", reason: "no_key" });
      else if ((u[p]?.restUntil ?? 0) > Date.now()) rows.push({ provider: p, model: "*", reason: "resting" });
      else if ((u[p]?.streak ?? 0) >= 4) rows.push({ provider: p, model: "*", reason: "fail_streak" });
    }
    const view = skippedView([...rows, ...lastSkipped.filter((s) => s.reason === "wrong_kind" || s.reason === "over_daily_quota")], lang);
    return view.map((v) => ({ key: v.key.replace("/*", ""), reason: v.reason, text: v.text, help: v.help }));
  } catch {
    return [];
  }
}

export { backoffJitterMs };

/* ------------------------------------------------------------------ tool failures → status + reason */

/** the status a finished task should get (a missing connection is "requires_connection", not "failed") + the failure kind column */
export function finishPatch(status: string, error: string | null): { status: string; failure_kind?: string } {
  // only the generic "tool" bucket is split further; AI-busy, policy, budget and input failures keep their own handling
  if (status === "failed" && error && classifyFailure(error).kind === "tool") {
    const s = statusForToolFailure(error);
    const kind = classifyToolFailure(error).kind;
    return { status: s, failure_kind: kind };
  }
  return { status };
}

/* ------------------------------------------------------------------ order of the tick: service queue first, spread, priorities */

export async function orderForTick<T extends { id: string; assignee_id?: string | null; priority?: number }>(orgId: string, ready: T[], slots = 3, prioritize?: (xs: T[]) => T[]): Promise<T[]> {
  try {
    let list = ready;
    // the customer-service employee's tasks first (the waiting-customers queue)
    const { data } = await db().from("team_members").select("id").eq("organization_id", orgId).eq("role_key", "customer_service");
    const service = new Set(((data ?? []) as { id: string }[]).map((m) => m.id));
    if (service.size) list = [...list.filter((t) => t.assignee_id && service.has(t.assignee_id)), ...list.filter((t) => !(t.assignee_id && service.has(t.assignee_id)))];
    if (prioritize) {
      try {
        const p = prioritize(list);
        if (Array.isArray(p) && p.length === list.length) list = p;
      } catch {
        /* the priority hook never blocks the clock */
      }
    }
    return spreadTasks(list, slots);
  } catch {
    return ready.slice(0, slots);
  }
}

/* ------------------------------------------------------------------ restart / bulk cancel / merge / revive */

const TASK_COLS = "id, title, status, error, attempts, depends_on, assignee_id, created_at, updated_at, restarts";

export async function restartTask(orgId: string, taskId: string): Promise<{ ok: boolean; reason?: string }> {
  try {
    const a = db();
    const { data: t } = await a.from("team_tasks").select(TASK_COLS).eq("organization_id", orgId).eq("id", taskId).maybeSingle();
    if (!t) return { ok: false, reason: "not_restartable" };
    const { data: settings } = await a.from("team_settings").select("emergency_stop").eq("organization_id", orgId).maybeSingle();
    const deps = (t.depends_on as string[] | null) ?? [];
    const dependencyStatus: Record<string, string> = {};
    if (deps.length) {
      const { data: ds } = await a.from("team_tasks").select("id, status").eq("organization_id", orgId).in("id", deps);
      for (const d of (ds ?? []) as { id: string; status: string }[]) dependencyStatus[d.id] = d.status;
    }
    const v = canRestart({ id: t.id as string, status: t.status as string, error: t.error as string | null, attempts: t.attempts as number | null, depends_on: deps }, { emergencyStop: Boolean(settings?.emergency_stop), dependencyStatus });
    if (!v.ok) return { ok: false, reason: v.reason };
    const patch: Record<string, unknown> = { ...restartPatch(Date.now()), restarts: ((t.restarts as number | null) ?? 0) + 1 };
    let r = await a.from("team_tasks").update(patch).eq("organization_id", orgId).eq("id", taskId);
    if (r.error && missing(r.error)) {
      delete patch.restarts; // migration 8 not applied — the restart itself still works
      r = await a.from("team_tasks").update(patch).eq("organization_id", orgId).eq("id", taskId);
    }
    return r.error ? { ok: false, reason: "not_restartable" } : { ok: true };
  } catch {
    return { ok: false, reason: "not_restartable" };
  }
}

/** cancels old blocked items in one go (nothing is deleted: status "canceled" + the reason "expired_blocked") */
export async function cancelStaleBlocked(orgId: string, days = 3): Promise<number> {
  try {
    const a = db();
    const { data } = await a.from("team_tasks").select(TASK_COLS).eq("organization_id", orgId).in("status", ["blocked", "requires_connection"]).limit(500);
    const stale = staleBlocked((data ?? []) as { id: string; status: string; updated_at: string; created_at: string }[], Date.now(), days);
    if (!stale.length) return 0;
    const { data: done } = await a.from("team_tasks").update({ status: "canceled", error: "expired_blocked", finished_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("organization_id", orgId).in("id", stale.map((s) => s.id)).in("status", ["blocked", "requires_connection"]).select("id");
    return done?.length ?? 0;
  } catch {
    return 0;
  }
}

/** merges duplicate OPEN tasks: marks them "merged" with a pointer to the survivor (never deletes) */
export async function mergeDuplicateTasks(orgId: string): Promise<{ merged: number; groups: number }> {
  try {
    const a = db();
    const { data } = await a.from("team_tasks").select("id, title, status, created_at, assignee_id, origin").eq("organization_id", orgId).in("status", ["draft", "pending", "blocked", "awaiting_input", "awaiting_approval", "in_progress", "requires_connection"]).limit(800);
    const rows = ((data ?? []) as { id: string; title: string; status: string; created_at: string; assignee_id: string | null }[]).filter((r) => r.status !== "in_progress");
    const items: WorkItem[] = rows.map((r) => ({ id: r.id, title: r.title, status: r.status, created_at: r.created_at, assignee: r.assignee_id, kind: "task" }));
    const plan = planMerge(items, Date.now());
    let merged = 0;
    for (const s of plan.steps) {
      const r = await a.from("team_tasks").update({ status: "merged", merged_into: s.mergedInto, error: "merged_duplicate", finished_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("organization_id", orgId).eq("id", s.id).neq("status", "in_progress");
      if (r.error && missing(r.error)) return { merged, groups: plan.groups }; // migration 8 not applied yet — nothing is half-written
      if (!r.error) {
        merged++;
        // tasks that waited for the merged one now wait for the survivor (so no chain is left waiting for a task that will never run)
        const { data: dependents } = await a.from("team_tasks").select("id, depends_on").eq("organization_id", orgId).contains("depends_on", [s.id]);
        for (const d of (dependents ?? []) as { id: string; depends_on: string[] }[]) {
          const next = [...new Set(d.depends_on.map((x) => (x === s.id ? s.mergedInto : x)).filter((x) => x !== d.id))];
          await a.from("team_tasks").update({ depends_on: next }).eq("organization_id", orgId).eq("id", d.id);
        }
      }
    }
    return { merged, groups: plan.groups };
  } catch {
    return { merged: 0, groups: 0 };
  }
}

/** an open task that already covers a new one (same intent, same owner) — used before creating a task; null = go ahead */
export async function existingTaskFor(orgId: string, next: { title: string; assignee?: string | null; recipient?: string | null }): Promise<string | null> {
  try {
    const { data } = await db().from("team_tasks").select("id, title, status, created_at, assignee_id").eq("organization_id", orgId).in("status", ["draft", "pending", "in_progress", "awaiting_approval", "awaiting_input", "blocked", "requires_connection"]).gte("created_at", new Date(Date.now() - 2 * 86_400_000).toISOString()).limit(300);
    const open: WorkItem[] = ((data ?? []) as { id: string; title: string; status: string; created_at: string; assignee_id: string | null }[]).map((r) => ({ id: r.id, title: r.title, status: r.status, created_at: r.created_at, assignee: r.assignee_id, kind: "task" }));
    return findExisting({ title: next.title, assignee: next.assignee ?? null, recipient: next.recipient ?? null, kind: "task" }, open, Date.now());
  } catch {
    return null;
  }
}

/** merges duplicate goals (team_business_goals): marks "merged", never deletes */
export async function mergeDuplicateGoals(orgId: string): Promise<{ merged: number }> {
  try {
    const a = db();
    const { data, error } = await a.from("team_business_goals").select("id, title, status, created_at, metric").eq("organization_id", orgId).in("status", ["proposed", "active", "paused"]).limit(300);
    if (error) return { merged: 0 };
    const rows = (data ?? []) as { id: string; title: string; status: string; created_at: string; metric: string }[];
    const items: WorkItem[] = rows.map((r) => ({ id: r.id, title: `${r.metric} ${r.title}`, status: r.status === "active" ? "in_progress" : r.status === "proposed" ? "draft" : "blocked", created_at: r.created_at, kind: "goal" }));
    const plan = planMerge(items, Date.now(), { threshold: 0.8 });
    let merged = 0;
    for (const s of plan.steps) {
      const { error: e } = await a.from("team_business_goals").update({ status: "merged", merged_into: s.mergedInto, updated_at: new Date().toISOString() }).eq("organization_id", orgId).eq("id", s.id);
      if (e && missing(e)) return { merged };
      if (!e) merged++;
    }
    return { merged };
  } catch {
    return { merged: 0 };
  }
}

/** a task blocked ONLY by a dependency that is no longer failed returns to the queue (also looks at "merged" / "requires_connection") */
export async function reviveChains(orgId: string): Promise<number> {
  try {
    const a = db();
    const { data } = await a.from("team_tasks").select("id, status, error, depends_on").eq("organization_id", orgId).eq("status", "blocked").eq("error", "dependency_failed").limit(100);
    const rows = (data ?? []) as { id: string; status: string; error: string | null; depends_on: string[] | null }[];
    const ids = [...new Set(rows.flatMap((r) => r.depends_on ?? []))];
    if (!ids.length) return 0;
    const { data: ds } = await a.from("team_tasks").select("id, status").eq("organization_id", orgId).in("id", ids);
    const status = Object.fromEntries(((ds ?? []) as { id: string; status: string }[]).map((d) => [d.id, d.status]));
    const back = revivable(rows, status);
    let n = 0;
    for (const r of back) {
      const { data: done } = await a.from("team_tasks").update({ status: "pending", error: null, finished_at: null, updated_at: new Date().toISOString() }).eq("organization_id", orgId).eq("id", r.id).eq("status", "blocked").eq("error", "dependency_failed").select("id");
      if (done?.length) n++;
    }
    return n;
  } catch {
    return 0;
  }
}

/* ------------------------------------------------------------------ the waiting-for-a-reply queue */

export interface ResponseView {
  targetMin: number;
  queue: QueueItem[];
  stats: ReturnType<typeof responseStats>;
  alert: ReturnType<typeof slaAlert>;
}

export async function loadResponseQueue(orgId: string, targetMin: number): Promise<ResponseView | null> {
  try {
    const a = db();
    const now = Date.now();
    const since = new Date(now - 3 * 86_400_000).toISOString();
    const [{ data: msgs }, { data: convs }, { data: deals }] = await Promise.all([
      a.from("messages").select("conversation_id, direction, created_at").eq("organization_id", orgId).gte("created_at", since).order("created_at", { ascending: true }).limit(2000),
      a.from("conversations").select("id, contact_id, status").eq("organization_id", orgId).eq("status", "open").gte("last_customer_at", since).limit(400),
      a.from("deals").select("contact_id, value").eq("organization_id", orgId).eq("status", "open").limit(500),
    ]);
    const byConv = new Map<string, { direction: string; at: number }[]>();
    for (const m of (msgs ?? []) as { conversation_id: string; direction: string; created_at: string }[]) (byConv.get(m.conversation_id) ?? byConv.set(m.conversation_id, []).get(m.conversation_id)!).push({ direction: m.direction, at: Date.parse(m.created_at) });
    const minutes: number[] = [];
    const waitingSince = new Map<string, number>();
    for (const [cid, list] of byConv) {
      let pending: number | null = null;
      for (const m of list) {
        if (m.direction === "in") {
          if (pending === null) pending = m.at;
        } else if (pending !== null) {
          minutes.push(Math.round((m.at - pending) / 60_000));
          pending = null;
        }
      }
      if (pending !== null) waitingSince.set(cid, pending);
    }
    const value = new Map<string, number>();
    for (const d of (deals ?? []) as { contact_id: string | null; value: number }[]) if (d.contact_id) value.set(d.contact_id, (value.get(d.contact_id) ?? 0) + Number(d.value || 0));
    const { automatedContactIds } = await import("./tools");
    const contactIds = ((convs ?? []) as { contact_id: string | null }[]).map((c) => c.contact_id);
    const robots = await automatedContactIds(orgId, contactIds).catch(() => new Set<string>());
    const rows = ((convs ?? []) as { id: string; contact_id: string | null }[]).filter((c) => waitingSince.has(c.id)).map((c) => ({ id: c.id, contactId: c.contact_id, waitingSince: waitingSince.get(c.id)!, value: c.contact_id ? value.get(c.contact_id) ?? 0 : 0, automated: Boolean(c.contact_id && robots.has(c.contact_id)) }));
    const queue = buildQueue(rows, now, targetMin);
    const waitedMin = queue.map((q) => q.waitingMin);
    const stats = responseStats([...minutes, ...waitedMin], targetMin);
    return { targetMin, queue: queue.slice(0, 20), stats, alert: slaAlert(queue, stats, targetMin) };
  } catch {
    return null;
  }
}

/**
 * Once per tick: when customers wait past the target, the service employee gets ONE task (per hour) that lists the queue,
 * oldest and most valuable first. It runs first in the tick (see orderForTick). Idempotent via plan_key.
 */
export async function ensureQueueTask(orgId: string, lang: Lang, targetMin: number): Promise<boolean> {
  try {
    const view = await loadResponseQueue(orgId, targetMin);
    if (!view || !view.queue.some((q) => q.state !== "ok")) return false;
    const a = db();
    const { data: m } = await a.from("team_members").select("id, status").eq("organization_id", orgId).eq("role_key", "customer_service").eq("status", "active").limit(1).maybeSingle();
    if (!m) return false;
    const key = `queue-${new Date().toISOString().slice(0, 13).replace(/[-T]/g, "")}`.slice(0, 40);
    const { count } = await a.from("team_tasks").select("id", { count: "exact", head: true }).eq("organization_id", orgId).eq("plan_key", key);
    if (count) return false;
    const top = view.queue.slice(0, 5);
    const brief = (lang === "he" ? "לקוחות שממתינים למענה (הוותיקים והחשובים ראשונים):" : lang === "ar" ? "عملاء بانتظار الرد (الأقدم والأهم أولًا):" : "Customers waiting for a reply (oldest and most valuable first):") + "\n" + top.map((q, i) => `${i + 1}. ${q.contactId ? `contact ${q.contactId}` : `conversation ${q.id}`} — ${q.waitingMin} min`).join("\n");
    const title = lang === "he" ? "מענה ללקוחות שממתינים" : lang === "ar" ? "الرد على العملاء المنتظرين" : "Reply to waiting customers";
    const { error } = await a.from("team_tasks").insert({ organization_id: orgId, plan_key: key, title, brief, assignee_id: m.id, priority: 1, status: "pending", origin: "initiative" });
    return !error;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ A/B experiments: entering the sample (counts per version) */

export async function recordExperimentSample(orgId: string, id: string, add: { aTrials: number; aSuccesses: number; bTrials: number; bSuccesses: number }): Promise<{ ok: boolean; error?: string }> {
  const ints = [add.aTrials, add.aSuccesses, add.bTrials, add.bSuccesses];
  if (!ints.every((n) => Number.isInteger(n) && n >= 0 && n <= 10_000_000)) return { ok: false, error: "invalid" };
  if (add.aSuccesses > add.aTrials || add.bSuccesses > add.bTrials) return { ok: false, error: "successes_over_trials" };
  try {
    const a = db();
    const { data: e, error } = await a.from("team_experiments").select("a_trials, a_successes, b_trials, b_successes, status").eq("organization_id", orgId).eq("id", id).maybeSingle();
    if (error) return { ok: false, error: missing(error) ? "migration_not_applied" : "write_failed" };
    if (!e) return { ok: false, error: "not_found" };
    if (e.status !== "running") return { ok: false, error: "not_running" };
    const { error: w } = await a.from("team_experiments").update({ a_trials: (e.a_trials as number) + add.aTrials, a_successes: (e.a_successes as number) + add.aSuccesses, b_trials: (e.b_trials as number) + add.bTrials, b_successes: (e.b_successes as number) + add.bSuccesses, updated_at: new Date().toISOString() }).eq("organization_id", orgId).eq("id", id).eq("status", "running");
    return w ? { ok: false, error: "write_failed" } : { ok: true };
  } catch {
    return { ok: false, error: "write_failed" };
  }
}

export { localizeTitle, titleInstruction };
