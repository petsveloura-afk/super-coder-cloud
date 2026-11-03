import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { cleanMatrixOverride, cleanRaci, resolveMatrix, type MatrixOverride, type MatrixRule, type RaciOverride } from "./raci-core";
import { cleanSlaOverride, measureSlas, resolveSlas, slaBriefLine, alertKey, slaLevel, slaLine, type HandoffLite, type SlaDef, type SlaOverride, type SlaResult } from "./dept-sla-core";
import type { Lang } from "./departments-core";

/**
 * Upgrade 8 / stage B (B3–B6) — server side: the owner's RACI / matrix / SLA / job-profile overrides and the measurements. Every
 * function is scoped to one business (service role, organization_id on every query). A missing table never throws: reads give the
 * defaults in code (available = false), writes answer "migration_not_applied", and the team keeps working exactly as before.
 */
const db = () => createAdminClient();
const missing = (e: { message?: string; code?: string } | null | undefined) => !!e && (e.code === "42P01" || e.code === "PGRST205" || /does not exist|schema cache|migration/i.test(e.message ?? ""));
type Res = { ok: true } | { ok: false; error: string };
const fail = (e: { message?: string; code?: string } | null | undefined): Res => ({ ok: false, error: missing(e) ? "migration_not_applied" : "write_failed" });

/* ------------------------------------------------------------------ RACI + matrix */

export interface RaciState {
  available: boolean;
  roles: RaciOverride[];
  matrix: MatrixOverride[];
}

let raciCache = new Map<string, { at: number; v: RaciState }>();
export const bustRaci = (orgId: string) => raciCache.delete(orgId);

export async function loadRaciState(orgId: string, opts: { fresh?: boolean } = {}): Promise<RaciState> {
  const hit = raciCache.get(orgId);
  if (!opts.fresh && hit && Date.now() - hit.at < 30_000) return hit.v;
  let v: RaciState = { available: false, roles: [], matrix: [] };
  try {
    const a = db();
    const [r, m] = await Promise.all([a.from("team_raci_roles").select("sop_key, r_role, a_role, c_roles, i_roles").eq("organization_id", orgId), a.from("team_raci_matrix").select("rule_id, enabled, threshold").eq("organization_id", orgId)]);
    if (!r.error && !m.error) {
      v = {
        available: true,
        roles: ((r.data ?? []) as { sop_key: string; r_role: string | null; a_role: string | null; c_roles: string[] | null; i_roles: string[] | null }[]).map((x) => ({ key: x.sop_key, R: x.r_role, A: x.a_role, C: x.c_roles?.length ? x.c_roles : null, I: x.i_roles?.length ? x.i_roles : null })),
        matrix: ((m.data ?? []) as { rule_id: string; enabled: boolean | null; threshold: number | null }[]).map((x) => ({ rule_id: x.rule_id, enabled: x.enabled, threshold: x.threshold === null ? null : Number(x.threshold) })),
      };
    }
  } catch {
    /* defaults */
  }
  if (raciCache.size > 200) raciCache = new Map();
  raciCache.set(orgId, { at: Date.now(), v });
  return v;
}

export async function matrixFor(orgId: string): Promise<MatrixRule[]> {
  const st = await loadRaciState(orgId);
  return resolveMatrix(st.matrix);
}

export async function saveRaciRow(orgId: string, raw: Record<string, unknown>, userId: string | null): Promise<Res> {
  const c = cleanRaci(raw);
  if (!c.ok) return { ok: false, error: c.error };
  try {
    const { error } = await db().from("team_raci_roles").upsert({ organization_id: orgId, sop_key: c.row.key, r_role: c.row.R ?? null, a_role: c.row.A ?? null, c_roles: c.row.C ?? [], i_roles: c.row.I ?? [], updated_by: userId, updated_at: new Date().toISOString() }, { onConflict: "organization_id,sop_key" });
    bustRaci(orgId);
    return error ? fail(error) : { ok: true };
  } catch {
    return { ok: false, error: "write_failed" };
  }
}

export async function saveMatrixRow(orgId: string, raw: Record<string, unknown>, userId: string | null): Promise<Res> {
  const c = cleanMatrixOverride(raw);
  if (!c.ok) return { ok: false, error: c.error };
  try {
    const { error } = await db().from("team_raci_matrix").upsert({ organization_id: orgId, rule_id: c.row.rule_id, enabled: c.row.enabled ?? null, threshold: c.row.threshold ?? null, updated_by: userId, updated_at: new Date().toISOString() }, { onConflict: "organization_id,rule_id" });
    bustRaci(orgId);
    return error ? fail(error) : { ok: true };
  } catch {
    return { ok: false, error: "write_failed" };
  }
}

/* ------------------------------------------------------------------ SLA */

export async function loadSlaState(orgId: string): Promise<{ available: boolean; defs: SlaDef[]; overrides: SlaOverride[] }> {
  try {
    const { data, error } = await db().from("team_dept_sla").select("sla_id, minutes, enabled").eq("organization_id", orgId);
    if (error) return { available: !missing(error), defs: resolveSlas([]), overrides: [] };
    const overrides = (data ?? []) as SlaOverride[];
    return { available: true, defs: resolveSlas(overrides), overrides };
  } catch {
    return { available: false, defs: resolveSlas([]), overrides: [] };
  }
}

export async function saveSlaRow(orgId: string, raw: Record<string, unknown>, userId: string | null): Promise<Res> {
  const c = cleanSlaOverride(raw);
  if (!c.ok) return { ok: false, error: c.error };
  try {
    const { error } = await db().from("team_dept_sla").upsert({ organization_id: orgId, sla_id: c.row.sla_id, minutes: c.row.minutes ?? null, enabled: c.row.enabled ?? null, updated_by: userId, updated_at: new Date().toISOString() }, { onConflict: "organization_id,sla_id" });
    return error ? fail(error) : { ok: true };
  } catch {
    return { ok: false, error: "write_failed" };
  }
}

/** the handoffs of the last `days` days: the handoff messages (who → whom) joined to the task they created (created / started / status) */
export async function loadHandoffs(orgId: string, days = 30): Promise<HandoffLite[]> {
  try {
    const a = db();
    const since = new Date(Date.now() - days * 86_400_000).toISOString();
    const { data: msgs, error } = await a.from("team_messages").select("task_id, from_member, to_member").eq("organization_id", orgId).eq("kind", "handoff").gte("created_at", since).limit(1500);
    if (error || !msgs?.length) return [];
    const ids = [...new Set((msgs as { task_id: string | null }[]).map((m) => m.task_id).filter((x): x is string => !!x))];
    const rows: { id: string; status: string; created_at: string; started_at: string | null; finished_at: string | null }[] = [];
    for (let i = 0; i < ids.length; i += 200) {
      const { data } = await a.from("team_tasks").select("id, status, created_at, started_at, finished_at").eq("organization_id", orgId).in("id", ids.slice(i, i + 200));
      rows.push(...((data ?? []) as typeof rows));
    }
    const byId = new Map(rows.map((r) => [r.id, r]));
    const out: HandoffLite[] = [];
    for (const m of msgs as { task_id: string | null; from_member: string | null; to_member: string | null }[]) {
      const t = m.task_id ? byId.get(m.task_id) : undefined;
      if (!t || !m.from_member || !m.to_member) continue;
      out.push({ task_id: t.id, from_member: m.from_member, to_member: m.to_member, created_at: t.created_at, started_at: t.started_at, finished_at: t.finished_at, status: t.status });
    }
    return out;
  } catch {
    return [];
  }
}

/** the SLA results of one business right now; never throws ([] when nothing can be measured) */
export async function measureOrgSlas(orgId: string, now = Date.now()): Promise<{ results: SlaResult[]; defs: SlaDef[]; available: boolean }> {
  try {
    const { loadDeptState } = await import("./org8-data");
    const [st, sla, handoffs] = await Promise.all([loadDeptState(orgId), loadSlaState(orgId), loadHandoffs(orgId)]);
    return { results: measureSlas(handoffs, st.placements, sla.defs, now), defs: sla.defs, available: sla.available };
  } catch {
    return { results: [], defs: resolveSlas([]), available: false };
  }
}

/** the one brief line (null when nothing is wrong) */
export async function slaLineFor(orgId: string, lang: Lang, now = Date.now()): Promise<string | null> {
  const m = await measureOrgSlas(orgId, now);
  return slaBriefLine(m.results, lang);
}

/** the daily tick: ONE owner alert per breached agreement per day (deduped by the unique key); fails soft */
export async function slaAlertTick(orgId: string, lang: Lang, now = Date.now()): Promise<number> {
  try {
    const { results } = await measureOrgSlas(orgId, now);
    let sent = 0;
    const a = db();
    for (const r of results) {
      const key = alertKey(r, now);
      if (!key || slaLevel(r) !== "breach") continue;
      const line = slaLine(r, lang);
      const { error } = await a.from("team_sla_alerts").insert({ organization_id: orgId, alert_key: key, line: line.slice(0, 500) });
      if (error) continue; // duplicate (already alerted today) or the table is missing
      sent++;
      await a.from("team_activity").insert({ organization_id: orgId, phase: "system", summary: line.slice(0, 1000), details: { sla: r.def.id, breached: r.breached, open: r.openBreached }, ok: false }).then(() => undefined, () => undefined);
      const { notifyOwners } = await import("@/lib/agents/run");
      await notifyOwners(orgId, "aiTeam.org8.slaAlert", { line: line.slice(0, 120) }, "/ai-team").catch(() => undefined);
    }
    return sent;
  } catch {
    return 0;
  }
}

/** the last `days` days of tasks, for the measurements of the rest of stage B */
export async function loadTaskRows(orgId: string, days = 30) {
  try {
    const { data } = await db().from("team_tasks").select("id, title, status, assignee_id, credits_used, created_at, finished_at, updated_at, priority, result").eq("organization_id", orgId).gte("updated_at", new Date(Date.now() - days * 86_400_000).toISOString()).order("created_at", { ascending: false }).limit(1000);
    return (data ?? []) as { id: string; title: string; status: string; assignee_id: string | null; credits_used: number; created_at: string; finished_at: string | null; updated_at: string; priority: number; result: Record<string, unknown> | null }[];
  } catch {
    return [];
  }
}
