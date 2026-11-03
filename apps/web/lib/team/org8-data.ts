import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ToolRun } from "./engine-core";
import { DEFAULT_DEPTS, deptName, isDeptKey, manualPlacement, placeMembers, cleanBudget, type DeptKey, type DeptRow, type Lang, type MemberLite, type Placement } from "./departments-core";
import { decideSopProposal, effectiveSops, historyOfSop, normalizeSop, planSopChange, sopFor, sopLine, sopPrompt, type NewSop, type SopOutcome, type SopSource, type SopVersion } from "./sop-core";

/**
 * Upgrade 8 / stage B — server side of the professional organisation: departments, placements, procedures. Every function is scoped to
 * one business (service role, organization_id on every query). When a table is not there yet (migration not run) nothing throws:
 * reads give the defaults in code, writes answer "migration_not_applied", and the team keeps working exactly as before.
 */
const db = () => createAdminClient();
const missing = (e: { message?: string; code?: string } | null | undefined) => !!e && (e.code === "42P01" || e.code === "PGRST205" || /does not exist|schema cache|migration/i.test(e.message ?? ""));
export const orgLang = (v: unknown): Lang => (v === "en" || v === "ar" ? v : "he");

/* ------------------------------------------------------------------ departments */

export interface DeptState {
  available: boolean;
  members: MemberLite[];
  placements: Placement[];
  rows: DeptRow[];
}

/** members, placements (computed from roles when the table is missing) and the department rows; never throws */
export async function loadDeptState(orgId: string): Promise<DeptState> {
  const a = db();
  const { data: m } = await a.from("team_members").select("id, role_key, name, status, position").eq("organization_id", orgId).order("position");
  const members = ((m ?? []) as MemberLite[]).map((x) => ({ ...x }));
  let available = true;
  let stored: Placement[] = [];
  let rows: DeptRow[] = [];
  try {
    const [p, d] = await Promise.all([a.from("team_dept_members").select("member_id, dept_key, manual").eq("organization_id", orgId), a.from("team_departments").select("dept_key, head_member_id, credit_budget").eq("organization_id", orgId)]);
    if (p.error || d.error) available = !(missing(p.error) || missing(d.error));
    else {
      stored = ((p.data ?? []) as Placement[]).filter((x) => isDeptKey(x.dept_key));
      rows = ((d.data ?? []) as DeptRow[]).filter((x) => isDeptKey(x.dept_key));
    }
  } catch {
    available = false;
  }
  return { available, members, placements: placeMembers(members, stored).all, rows };
}

/** writes the automatic placements that are new or changed (manual ones are never touched) and the six department rows; fails soft */
export async function ensureDepartments(orgId: string): Promise<boolean> {
  try {
    const st = await loadDeptState(orgId);
    if (!st.available) return false;
    const a = db();
    const stored = await a.from("team_dept_members").select("member_id, dept_key, manual").eq("organization_id", orgId);
    if (stored.error) return false;
    const { toWrite } = placeMembers(st.members, (stored.data ?? []) as Placement[]);
    if (toWrite.length) {
      const { error } = await a.from("team_dept_members").upsert(toWrite.map((p) => ({ organization_id: orgId, member_id: p.member_id, dept_key: p.dept_key, manual: false, updated_at: new Date().toISOString() })), { onConflict: "member_id" });
      if (error) return false;
    }
    const have = new Set(st.rows.map((r) => r.dept_key));
    const add = DEFAULT_DEPTS.filter((d) => !have.has(d.key)).map((d) => ({ organization_id: orgId, dept_key: d.key }));
    if (add.length) await a.from("team_departments").upsert(add, { onConflict: "organization_id,dept_key", ignoreDuplicates: true });
    return true;
  } catch {
    return false;
  }
}

type Res = { ok: true } | { ok: false; error: string };

export async function setMemberDept(orgId: string, memberId: string, dept: string): Promise<Res> {
  const p = manualPlacement(memberId, dept);
  if (!p) return { ok: false, error: "bad:dept" };
  try {
    const a = db();
    const { data: m } = await a.from("team_members").select("id").eq("organization_id", orgId).eq("id", memberId).maybeSingle();
    if (!m) return { ok: false, error: "not_found" };
    const { error } = await a.from("team_dept_members").upsert({ organization_id: orgId, member_id: memberId, dept_key: p.dept_key, manual: true, updated_at: new Date().toISOString() }, { onConflict: "member_id" });
    if (error) return { ok: false, error: missing(error) ? "migration_not_applied" : "write_failed" };
    return { ok: true };
  } catch {
    return { ok: false, error: "write_failed" };
  }
}

export async function setDeptHead(orgId: string, dept: string, memberId: string | null): Promise<Res> {
  if (!isDeptKey(dept)) return { ok: false, error: "bad:dept" };
  try {
    const st = await loadDeptState(orgId);
    if (memberId) {
      const inDept = st.placements.find((p) => p.member_id === memberId)?.dept_key === dept;
      if (!inDept) return { ok: false, error: "not_in_department" };
    }
    const { error } = await db().from("team_departments").upsert({ organization_id: orgId, dept_key: dept, head_member_id: memberId, updated_at: new Date().toISOString() }, { onConflict: "organization_id,dept_key" });
    if (error) return { ok: false, error: missing(error) ? "migration_not_applied" : "write_failed" };
    return { ok: true };
  } catch {
    return { ok: false, error: "write_failed" };
  }
}

export async function setDeptBudget(orgId: string, dept: string, budget: unknown): Promise<Res> {
  const b = cleanBudget(budget);
  if (!isDeptKey(dept) || b === null) return { ok: false, error: "bad:budget" };
  try {
    const { error } = await db().from("team_departments").upsert({ organization_id: orgId, dept_key: dept, credit_budget: b, updated_at: new Date().toISOString() }, { onConflict: "organization_id,dept_key" });
    if (error) return { ok: false, error: missing(error) ? "migration_not_applied" : "write_failed" };
    return { ok: true };
  } catch {
    return { ok: false, error: "write_failed" };
  }
}

/** is this employee the head of their department (so they may propose procedure changes)? never throws */
export async function isDeptHead(orgId: string, memberId: string): Promise<boolean> {
  try {
    const { headOf, DEPT_KEYS } = await import("./departments-core");
    const st = await loadDeptState(orgId);
    const mine = st.placements.find((p) => p.member_id === memberId)?.dept_key;
    if (!mine || !DEPT_KEYS.includes(mine)) return false;
    return headOf(mine, st.members, st.placements, st.rows.find((r) => r.dept_key === mine)?.head_member_id ?? null)?.id === memberId;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ procedures (SOP) */

type SopRow = { id: string; sop_key: string; version: number; status: SopVersion["status"]; source: SopSource; dept_key: DeptKey; lang: Lang; title: string; purpose: string; trigger_text: string; steps: string[]; owner_role: string; success_metric: string; escalation: string; approvals: string[]; proposed_by: string | null; valid_from: string; valid_to: string | null; created_at: string };
const SOP_COLUMNS = "id, sop_key, version, status, source, dept_key, lang, title, purpose, trigger_text, steps, owner_role, success_metric, escalation, approvals, proposed_by, valid_from, valid_to, created_at";
const rowToSop = (r: SopRow): SopVersion => ({ id: r.id, sop_key: r.sop_key, version: r.version, status: r.status, source: r.source, dept: r.dept_key, lang: r.lang, title: r.title, purpose: r.purpose, trigger: r.trigger_text, steps: Array.isArray(r.steps) ? r.steps : [], owner_role: r.owner_role, success_metric: r.success_metric, escalation: r.escalation, approvals: Array.isArray(r.approvals) ? r.approvals : [], proposed_by: r.proposed_by, valid_from: r.valid_from, valid_to: r.valid_to, created_at: r.created_at });

let sopCache = new Map<string, { at: number; rows: SopVersion[] }>();
const bustSops = (orgId: string) => sopCache.delete(orgId);

export async function loadSops(orgId: string, opts: { fresh?: boolean } = {}): Promise<{ rows: SopVersion[]; available: boolean }> {
  const hit = sopCache.get(orgId);
  if (!opts.fresh && hit && Date.now() - hit.at < 30_000) return { rows: hit.rows, available: true };
  try {
    const { data, error } = await db().from("team_sops").select(SOP_COLUMNS).eq("organization_id", orgId).order("created_at", { ascending: false }).limit(1000);
    if (error) return { rows: [], available: !missing(error) };
    const rows = ((data ?? []) as SopRow[]).map(rowToSop);
    if (sopCache.size > 200) sopCache = new Map();
    sopCache.set(orgId, { at: Date.now(), rows });
    return { rows, available: true };
  } catch {
    return { rows: [], available: false };
  }
}

export type SopSaveResult = { ok: true; outcome: SopOutcome; line: string; id?: string } | { ok: false; error: string };

/**
 * Saves one procedure change by the rules of sop-core. `source` is decided by the CALLER, never by the model: the team tool passes
 * "agent" (always a proposal), only the owner's screen passes "owner" (current at once, the previous version is closed, not deleted).
 */
export async function saveSop(orgId: string, raw: Record<string, unknown>, ctx: { source: SopSource; memberId?: string | null; lang?: Lang }): Promise<SopSaveResult> {
  const lang = ctx.lang ?? "he";
  const n = normalizeSop(raw, lang);
  if ("rejected" in n) return { ok: false, error: n.rejected };
  const sop: NewSop = n.sop;
  const { rows, available } = await loadSops(orgId, { fresh: true });
  if (!available) return { ok: false, error: "migration_not_applied" };
  const history = rows.filter((r) => r.sop_key === sop.sop_key);
  const plan = planSopChange(history, sop, ctx.source);
  if (plan.action === "duplicate") return { ok: true, outcome: { kind: "same", title: sop.title }, line: sopLine({ kind: "same", title: sop.title }, lang), id: plan.id ?? undefined };
  const a = db();
  const now = new Date().toISOString();
  const base = { organization_id: orgId, sop_key: sop.sop_key, version: plan.version, source: ctx.source === "owner" ? "owner" : "agent", dept_key: sop.dept, lang: sop.lang, title: sop.title, purpose: sop.purpose, trigger_text: sop.trigger, steps: sop.steps, owner_role: sop.owner_role, success_metric: sop.success_metric, escalation: sop.escalation, approvals: sop.approvals, proposed_by: ctx.memberId ?? null };
  if (plan.action === "propose") {
    const { data, error } = await a.from("team_sops").insert({ ...base, status: "proposed", valid_from: now }).select("id").single();
    bustSops(orgId);
    if (error) return { ok: false, error: missing(error) ? "migration_not_applied" : "write_failed" };
    return { ok: true, outcome: { kind: "proposed", title: sop.title }, line: sopLine({ kind: "proposed", title: sop.title }, lang), id: data?.id as string };
  }
  // owner: close the previous current version first (one in force), put it back if the insert fails
  if (plan.action === "new_version") {
    const { error } = await a.from("team_sops").update({ status: "superseded", valid_to: now }).eq("organization_id", orgId).eq("id", plan.supersedesId).eq("status", "current");
    if (error) return { ok: false, error: missing(error) ? "migration_not_applied" : "write_failed" };
  }
  const { data, error } = await a.from("team_sops").insert({ ...base, status: "current", valid_from: now, decided_at: now }).select("id").single();
  bustSops(orgId);
  if (error) {
    if (plan.action === "new_version") await a.from("team_sops").update({ status: "current", valid_to: null }).eq("organization_id", orgId).eq("id", plan.supersedesId).eq("status", "superseded").then(() => undefined, () => undefined);
    return { ok: false, error: missing(error) ? "migration_not_applied" : "write_failed" };
  }
  const outcome: SopOutcome = plan.action === "new_version" ? { kind: "changed", title: sop.title, version: plan.version } : { kind: "created", title: sop.title, version: plan.version };
  return { ok: true, outcome, line: sopLine(outcome, lang), id: data?.id as string };
}

/** the owner's answer to a proposal. Accepting makes it current (the old current is closed); rejecting closes the proposal. */
export async function decideSop(orgId: string, id: string, accept: boolean, userId: string | null, lang: Lang = "he"): Promise<{ ok: true; line: string } | { ok: false; error: string }> {
  const { rows, available } = await loadSops(orgId, { fresh: true });
  if (!available) return { ok: false, error: "migration_not_applied" };
  const target = rows.find((r) => r.id === id);
  if (!target) return { ok: false, error: "not_found" };
  const plan = decideSopProposal(rows.filter((r) => r.sop_key === target.sop_key), id, accept);
  if (!plan.ok) return { ok: false, error: plan.error };
  const a = db();
  const decided = { decided_by: userId, decided_at: plan.at };
  if (plan.reject) {
    const { data, error } = await a.from("team_sops").update({ status: "rejected", valid_to: plan.at, ...decided }).eq("organization_id", orgId).eq("id", plan.reject).eq("status", "proposed").select("id");
    bustSops(orgId);
    if (error || !data?.length) return { ok: false, error: error ? "write_failed" : "not_proposed" };
    return { ok: true, line: sopLine({ kind: "rejected", title: target.title }, lang) };
  }
  if (plan.closeCurrent) {
    const { error } = await a.from("team_sops").update({ status: "superseded", valid_to: plan.at }).eq("organization_id", orgId).eq("id", plan.closeCurrent).eq("status", "current");
    if (error) return { ok: false, error: "write_failed" };
  }
  const { data, error } = await a.from("team_sops").update({ status: "current", valid_from: plan.at, ...decided }).eq("organization_id", orgId).eq("id", plan.becomeCurrent!).eq("status", "proposed").select("id");
  bustSops(orgId);
  if (error || !data?.length) {
    if (plan.closeCurrent) await a.from("team_sops").update({ status: "current", valid_to: null }).eq("organization_id", orgId).eq("id", plan.closeCurrent).eq("status", "superseded").then(() => undefined, () => undefined);
    return { ok: false, error: error ? "write_failed" : "not_proposed" };
  }
  return { ok: true, line: sopLine({ kind: "accepted", title: target.title }, lang) };
}

/** the procedure block for the employee's prompt; "" when nothing fits. Works without the table (the defaults in code). Never throws. */
export async function sopPromptFor(orgId: string, taskText: string, lang: Lang): Promise<string> {
  try {
    const { rows } = await loadSops(orgId);
    const views = effectiveSops(rows, lang);
    const hits = sopFor(taskText, views, { max: 1 });
    if (!hits.length) return "";
    return sopPrompt(hits);
  } catch {
    return "";
  }
}

/* ------------------------------------------------------------------ the team tools */

type Args = Record<string, string | number>;
const s = (v: unknown) => (v === undefined || v === null ? "" : String(v));

export async function runOrgTool(orgId: string, tool: string, args: Args, ctx: { memberId?: string | null; lang?: Lang } = {}): Promise<ToolRun> {
  const lang = ctx.lang ?? "he";
  try {
    if (tool === "sop.lookup") {
      const { rows } = await loadSops(orgId);
      const hits = sopFor(s(args.query), effectiveSops(rows, lang), { max: 2, min: 0.2 });
      if (!hits.length) return { ok: true, summary: "no matching procedure — work from your playbook and the owner's instructions; do not invent a procedure", data: { procedures: [] } };
      return { ok: true, summary: `${hits.length} procedure(s)`, data: { procedures: hits.map((h) => ({ key: h.sop.sop_key, title: h.sop.title, dept: h.sop.dept, version: h.sop.version, source: h.sop.source, purpose: h.sop.purpose, steps: h.sop.steps, success_metric: h.sop.success_metric, escalation: h.sop.escalation, needs_owner_approval: h.sop.approvals })) } };
    }
    if (tool === "sop.propose") {
      // the model can never claim to be the owner: the source is always "agent" → always a proposal
      const r = await saveSop(orgId, { title: args.title, steps: args.body, sop_key: args.sop_key, dept: args.dept, trigger: args.trigger, purpose: args.purpose, success_metric: args.success_metric, escalation: args.escalation, approvals: args.approvals, lang }, { source: "agent", memberId: ctx.memberId ?? null, lang });
      if (!r.ok) return { ok: false, summary: "", error: r.error };
      return { ok: true, summary: r.line, data: { outcome: r.outcome.kind }, link: "/ai-team" };
    }
    return { ok: false, summary: "", error: "unknown_tool" };
  } catch (e) {
    return { ok: false, summary: "", error: (e as Error).message.slice(0, 300) };
  }
}

/** list helpers for the screen */
export { historyOfSop, deptName };
