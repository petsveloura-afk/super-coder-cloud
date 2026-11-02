import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { cleanOps, digestsDue, DEFAULT_OPS, type OpsSettings } from "./ops-settings-core";
import { consolidate, fadedIds, resolveConflicts } from "./memory-plus-core";
import { renderDigest, slaStatus, slaSummary, type SlaStatus } from "./ops-core";
import type { MemoryItem } from "./memory-core";

/**
 * The digital team — server side of upgrade 3: operations settings, the protections' call history, shared and
 * per-customer memory, daily memory upkeep, SLA tracking and the morning / weekly digests.
 * Every function is optional glue: a missing column or table (migration not run) makes it quietly do nothing.
 */
const db = () => createAdminClient();

/* ------------------------------------------------------------------ settings */

export async function loadOps(orgId: string): Promise<OpsSettings> {
  try {
    const { data, error } = await db().from("team_settings").select("ops").eq("organization_id", orgId).maybeSingle();
    if (error) return { ...DEFAULT_OPS };
    return cleanOps((data as { ops?: unknown } | null)?.ops);
  } catch {
    return { ...DEFAULT_OPS };
  }
}

/* ------------------------------------------------------------------ rate-limit history (from the append-only log) */

export async function recentToolCalls(orgId: string, memberId: string, tool: string, sinceMs: number): Promise<number[]> {
  const { data } = await db()
    .from("team_activity")
    .select("created_at")
    .eq("organization_id", orgId)
    .eq("member_id", memberId)
    .eq("phase", "execute")
    .eq("ok", true)
    .eq("details->>tool", tool)
    .gte("created_at", new Date(Date.now() - sinceMs).toISOString())
    .limit(100);
  return ((data ?? []) as { created_at: string }[]).map((r) => Date.parse(r.created_at));
}

/* ------------------------------------------------------------------ memory writes */

interface NewMemory {
  layer: "episodic" | "semantic";
  kind: MemoryItem["kind"];
  content: string;
  subject?: string | null;
  confidence: number;
  status: "active" | "proposed";
  tags?: string[];
}

/** shared memory (member_id = null); same-subject active memories are superseded, never deleted */
export async function writeShared(orgId: string, items: NewMemory[]): Promise<void> {
  const a = db();
  for (const it of items.slice(0, 5)) {
    const subject = it.subject ?? null;
    let old: string[] = [];
    if (it.status === "active" && subject) {
      const { data } = await a.from("team_memory").select("id").eq("organization_id", orgId).is("member_id", null).eq("layer", it.layer).eq("subject", subject).eq("status", "active").limit(5);
      old = ((data ?? []) as { id: string }[]).map((r) => r.id);
    } else if (subject) {
      // a lesson that already exists (proposed or active) is not proposed twice
      const { data } = await a.from("team_memory").select("id").eq("organization_id", orgId).is("member_id", null).eq("subject", subject).in("status", ["active", "proposed"]).limit(1);
      if (data?.length) continue;
    }
    const { data } = await a
      .from("team_memory")
      .insert({ organization_id: orgId, member_id: null, layer: it.layer, kind: it.kind, subject, content: it.content.slice(0, 2000), tags: (it.tags ?? []).slice(0, 8), confidence: it.confidence, source: it.kind === "outcome" ? "agent" : "feedback", status: it.status, supersedes: old[0] ?? null, expires_at: it.layer === "episodic" ? new Date(Date.now() + (subject?.startsWith("client:") ? 365 : 120) * 86_400_000).toISOString() : null })
      .select("id")
      .single();
    if (data && old.length) await a.from("team_memory").update({ status: "expired", updated_at: new Date().toISOString() }).eq("organization_id", orgId).in("id", old);
  }
}

/* ------------------------------------------------------------------ context cache (the business profile, one minute) */

const profileCache = new Map<string, { at: number; value: unknown }>();

export async function cachedProfile<T>(orgId: string, load: () => Promise<T>, ttlMs = 60_000): Promise<T> {
  const hit = profileCache.get(orgId);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value as T;
  const value = await load();
  profileCache.set(orgId, { at: Date.now(), value });
  if (profileCache.size > 200) profileCache.delete(profileCache.keys().next().value as string);
  return value;
}

/* ------------------------------------------------------------------ SLA (first response time of the inbox) */

export interface SlaView {
  targetMin: number;
  total: number;
  breached: number;
  warning: number;
  avgMinutes: number;
}

export async function loadSla(orgId: string, targetMin: number): Promise<SlaView> {
  const now = Date.now();
  const { data } = await db()
    .from("messages")
    .select("conversation_id, direction, created_at")
    .eq("organization_id", orgId)
    .gte("created_at", new Date(now - 3 * 86_400_000).toISOString())
    .order("created_at", { ascending: true })
    .limit(1500);
  const byConv = new Map<string, { direction: string; at: number }[]>();
  for (const m of (data ?? []) as { conversation_id: string; direction: string; created_at: string }[]) {
    const list = byConv.get(m.conversation_id) ?? [];
    list.push({ direction: m.direction, at: Date.parse(m.created_at) });
    byConv.set(m.conversation_id, list);
  }
  const rows: SlaStatus[] = [];
  for (const msgs of byConv.values()) {
    let pending: number | null = null;
    for (const m of msgs) {
      if (m.direction === "in") {
        if (pending === null) pending = m.at;
      } else if (pending !== null) {
        rows.push(slaStatus({ receivedAt: pending, firstReplyAt: m.at, now, targetMin }));
        pending = null;
      }
    }
    if (pending !== null) rows.push(slaStatus({ receivedAt: pending, firstReplyAt: null, now, targetMin }));
  }
  return { targetMin, ...slaSummary(rows) };
}

/* ------------------------------------------------------------------ daily memory upkeep */

/** merges near-duplicates, resolves conflicts, expires faded memories — marks them expired, never deletes */
export async function maintainMemory(orgId: string): Promise<{ merged: number; conflicts: number; faded: number }> {
  const a = db();
  const { data } = await a.from("team_memory").select("id, member_id, layer, kind, subject, content, tags, confidence, status, expires_at, created_at, uses").eq("organization_id", orgId).eq("status", "active").order("created_at", { ascending: false }).limit(800);
  const all = (data ?? []) as MemoryItem[];
  const now = new Date().toISOString();
  const expire = async (ids: string[]) => {
    const unique = [...new Set(ids)].slice(0, 200);
    if (unique.length) await a.from("team_memory").update({ status: "expired", updated_at: now }).eq("organization_id", orgId).in("id", unique);
    return unique.length;
  };
  const plans = consolidate(all);
  for (const p of plans) await a.from("team_memory").update({ confidence: p.confidence, updated_at: now }).eq("organization_id", orgId).eq("id", p.keepId);
  const merged = await expire(plans.flatMap((p) => p.dropIds));
  const gone = new Set(plans.flatMap((p) => p.dropIds));
  const conflicts = await expire(resolveConflicts(all.filter((m) => !gone.has(m.id))).map((c) => c.loser));
  const faded = await expire(fadedIds(all.filter((m) => !gone.has(m.id))));
  return { merged, conflicts, faded };
}

/* ------------------------------------------------------------------ digests */

async function logOnce(orgId: string, key: string, summary: string, details: Record<string, unknown>): Promise<void> {
  await db()
    .from("team_activity")
    .insert({ organization_id: orgId, phase: "learn", summary: summary.slice(0, 1000), details: { ...details, digest: key }, ok: true })
    .then(
      () => undefined,
      () => undefined,
    );
}

/** posts the morning digest (and the weekly one on Sunday) to the activity feed, once per day, and does the daily upkeep */
export async function runDailyOps(orgId: string, tz: string, lang: "he" | "en" | "ar", health: "ok" | "degraded" | "down"): Promise<{ digests: number; memory: boolean }> {
  const a = db();
  const ops = await loadOps(orgId);
  const now = Date.now();
  const since = new Date(now - 2 * 86_400_000).toISOString();
  const { data: seen } = await a.from("team_activity").select("details").eq("organization_id", orgId).eq("phase", "learn").gte("created_at", new Date(now - 9 * 86_400_000).toISOString()).not("details->>digest", "is", null).limit(40);
  const done = new Set(((seen ?? []) as { details: { digest?: string } }[]).map((r) => String(r.details?.digest ?? "")));
  let digests = 0;
  for (const due of digestsDue(now, tz, ops, done)) {
    const days = due.period === "day" ? 1 : 7;
    const from = new Date(now - days * 86_400_000).toISOString();
    const [{ data: tasks }, { count: pending }, { count: learnings }, sla] = await Promise.all([
      a.from("team_tasks").select("status").eq("organization_id", orgId).in("status", ["done", "failed", "blocked"]).gte("finished_at", from).limit(1000),
      a.from("team_approvals").select("id", { count: "exact", head: true }).eq("organization_id", orgId).eq("status", "pending"),
      a.from("team_memory").select("id", { count: "exact", head: true }).eq("organization_id", orgId).eq("layer", "semantic").in("status", ["active", "proposed"]).gte("created_at", from),
      loadSla(orgId, ops.sla.targetMin).catch(() => ({ targetMin: ops.sla.targetMin, total: 0, breached: 0, warning: 0, avgMinutes: 0 }) as SlaView),
    ]);
    const rows = (tasks ?? []) as { status: string }[];
    const text = renderDigest({ period: due.period, tasksDone: rows.filter((r) => r.status === "done").length, tasksFailed: rows.filter((r) => r.status !== "done").length, pendingApprovals: pending ?? 0, slaBreached: sla.breached, avgResponseMin: sla.avgMinutes, learnings: learnings ?? 0, health }, lang);
    await logOnce(orgId, due.key, text, { period: due.period });
    digests++;
  }
  // memory upkeep once a day (the marker keeps it idempotent when two servers tick together)
  const memKey = `mem:${new Date(now).toISOString().slice(0, 10)}`;
  let memory = false;
  const { data: marker } = await a.from("team_activity").select("id").eq("organization_id", orgId).eq("details->>digest", memKey).gte("created_at", since).limit(1);
  if (!marker?.length) {
    await logOnce(orgId, memKey, "Memory upkeep started.", { kind: "memory_upkeep" });
    const r = await maintainMemory(orgId).catch(() => null);
    if (r) {
      memory = true;
      await logOnce(orgId, `${memKey}:done`, `Memory upkeep: ${r.merged} merged, ${r.conflicts} conflicts settled, ${r.faded} faded (kept, marked expired).`, r);
    }
  }
  return { digests, memory };
}
