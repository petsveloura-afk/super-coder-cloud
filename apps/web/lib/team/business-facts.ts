import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ToolRun } from "./engine-core";
import { decideProposal, factLine, factsFor, factsPrompt, historyOf, normalizeFact, openConflicts, resolveIncoming, type FactOutcome, type FactVersion } from "./business-facts-core";

/**
 * Upgrade 7 / stage B — versioned business facts, server side. Every function is scoped to one business (service role,
 * organization_id on every query). When the table is not there yet (migration not run) nothing throws: reads give
 * "nothing known", writes answer "migration_not_applied" and the team keeps working exactly as before.
 */
const db = () => createAdminClient();
type Lang = "he" | "en" | "ar";
const COLUMNS = "id, fact_key, label, kind, value, unit, source, source_ref, confidence, owner_confirmed, status, version, supersedes, valid_from, valid_to, observed_at, created_at";

const missing = (e: { message?: string; code?: string } | null | undefined) => !!e && (e.code === "42P01" || e.code === "PGRST205" || /does not exist|schema cache|migration/i.test(e.message ?? ""));

let cache = new Map<string, { at: number; rows: FactVersion[] }>();
const bust = (orgId: string) => cache.delete(orgId);

/** every version that still matters (current + proposed + the last closed ones), newest first; [] when the table is missing */
export async function loadFacts(orgId: string, opts: { fresh?: boolean } = {}): Promise<{ rows: FactVersion[]; available: boolean }> {
  const hit = cache.get(orgId);
  if (!opts.fresh && hit && Date.now() - hit.at < 30_000) return { rows: hit.rows, available: true };
  try {
    const { data, error } = await db().from("team_business_facts").select(COLUMNS).eq("organization_id", orgId).order("created_at", { ascending: false }).limit(1500);
    if (error) return { rows: [], available: !missing(error) };
    const rows = ((data ?? []) as (Omit<FactVersion, "confidence"> & { confidence: number | string })[]).map((r) => ({ ...r, confidence: Number(r.confidence) })) as FactVersion[];
    if (cache.size > 200) cache = new Map();
    cache.set(orgId, { at: Date.now(), rows });
    return { rows, available: true };
  } catch {
    return { rows: [], available: false };
  }
}

export type RecordResult = { ok: true; outcome: FactOutcome | { kind: "ignored" }; line: string; id?: string } | { ok: false; error: string };

/**
 * Stores one fact with the resolution rules of business-facts-core. `source` is decided by the CALLER (never by the model):
 * the team tool always passes "agent" / "web"; only the owner's screen passes "owner".
 */
export async function recordFact(orgId: string, raw: Record<string, unknown>, ctx: { memberId?: string | null; decidedBy?: string | null; lang?: Lang } = {}): Promise<RecordResult> {
  const lang = ctx.lang ?? "he";
  const n = normalizeFact(raw);
  if ("rejected" in n) return { ok: false, error: n.rejected };
  const f = n.fact;
  const { rows, available } = await loadFacts(orgId, { fresh: true });
  if (!available) return { ok: false, error: "migration_not_applied" };
  const history = rows.filter((r) => r.fact_key === f.fact_key);
  const res = resolveIncoming(history, f);
  const a = db();
  if (res.action === "duplicate") return { ok: true, outcome: { kind: "kept", label: f.label }, line: factLine({ kind: "kept", label: f.label }, lang), id: res.currentId };
  if (res.action === "ignore") return { ok: true, outcome: { kind: "ignored" }, line: factLine({ kind: "kept", label: f.label }, lang), id: res.currentId };
  const cur = history.find((h) => h.status === "current");
  const base = { organization_id: orgId, fact_key: f.fact_key, label: f.label, kind: f.kind, value: f.value, unit: f.unit, source: f.source, source_ref: f.source_ref, confidence: f.confidence, owner_confirmed: f.owner_confirmed, version: res.version, valid_from: f.valid_from, valid_to: f.valid_to, observed_at: f.observed_at, recorded_by: ctx.memberId ?? null, decided_by: f.source === "owner" ? (ctx.decidedBy ?? null) : null, decided_at: f.source === "owner" ? new Date().toISOString() : null };
  if (res.action === "propose") {
    const { data, error } = await a.from("team_business_facts").insert({ ...base, status: "proposed", supersedes: res.againstId }).select("id").single();
    bust(orgId);
    if (error) return { ok: false, error: missing(error) ? "migration_not_applied" : "write_failed" };
    const outcome: FactOutcome = { kind: "proposed", label: f.label, value: f.value };
    return { ok: true, outcome, line: factLine(outcome, lang), id: data?.id as string };
  }
  // new current: close the previous one first (the unique index allows only one in force), put it back if the insert fails
  const closeAt = new Date().toISOString();
  if (res.supersedesId) {
    const { error } = await a.from("team_business_facts").update({ status: "superseded", valid_to: closeAt }).eq("organization_id", orgId).eq("id", res.supersedesId).eq("status", "current");
    if (error) return { ok: false, error: missing(error) ? "migration_not_applied" : "write_failed" };
  }
  const { data, error } = await a.from("team_business_facts").insert({ ...base, status: "current", supersedes: res.supersedesId }).select("id").single();
  bust(orgId);
  if (error) {
    if (res.supersedesId) await a.from("team_business_facts").update({ status: "current", valid_to: null }).eq("organization_id", orgId).eq("id", res.supersedesId).eq("status", "superseded").then(() => undefined, () => undefined);
    return { ok: false, error: missing(error) ? "migration_not_applied" : "write_failed" };
  }
  const outcome: FactOutcome = cur && res.supersedesId ? { kind: "changed", label: f.label, from: cur.value, to: f.value, version: res.version } : { kind: "created", label: f.label, value: f.value };
  return { ok: true, outcome, line: factLine(outcome, lang), id: data?.id as string };
}

/** the owner's answer to a proposal. Accepting makes it current and confirmed; rejecting closes it. */
export async function decideFact(orgId: string, id: string, accept: boolean, userId: string | null, lang: Lang = "he"): Promise<{ ok: true; line: string } | { ok: false; error: string }> {
  const { rows, available } = await loadFacts(orgId, { fresh: true });
  if (!available) return { ok: false, error: "migration_not_applied" };
  const target = rows.find((r) => r.id === id);
  if (!target) return { ok: false, error: "not_found" };
  const plan = decideProposal(rows.filter((r) => r.fact_key === target.fact_key), id, accept);
  if (!plan.ok) return { ok: false, error: plan.error };
  const a = db();
  const decided = { decided_by: userId, decided_at: plan.at };
  if (plan.reject) {
    const { data, error } = await a.from("team_business_facts").update({ status: "rejected", ...decided }).eq("organization_id", orgId).eq("id", plan.reject).eq("status", "proposed").select("id");
    bust(orgId);
    if (error || !data?.length) return { ok: false, error: error ? "write_failed" : "not_proposed" };
    return { ok: true, line: factLine({ kind: "rejected", label: target.label }, lang) };
  }
  if (plan.closeCurrent) {
    const { error } = await a.from("team_business_facts").update({ status: "superseded", valid_to: plan.at }).eq("organization_id", orgId).eq("id", plan.closeCurrent).eq("status", "current");
    if (error) return { ok: false, error: "write_failed" };
  }
  const { data, error } = await a.from("team_business_facts").update({ status: "current", owner_confirmed: true, valid_from: plan.at, ...decided }).eq("organization_id", orgId).eq("id", plan.becomeCurrent!).eq("status", "proposed").select("id");
  bust(orgId);
  if (error || !data?.length) {
    if (plan.closeCurrent) await a.from("team_business_facts").update({ status: "current", valid_to: null }).eq("organization_id", orgId).eq("id", plan.closeCurrent).eq("status", "superseded").then(() => undefined, () => undefined);
    return { ok: false, error: error ? "write_failed" : "not_proposed" };
  }
  return { ok: true, line: factLine({ kind: "accepted", label: target.label }, lang) };
}

/** the facts block for the employee's prompt; "" when nothing is relevant or the table is missing. Never throws. */
export async function factsPromptFor(orgId: string, taskText: string): Promise<string> {
  try {
    const { rows } = await loadFacts(orgId);
    if (!rows.length) return "";
    const hits = factsFor(rows, taskText, { max: 8 });
    return factsPrompt(hits, openConflicts(rows).map((c) => c.proposed.fact_key));
  } catch {
    return "";
  }
}

/* ------------------------------------------------------------------ the team tools */

type Args = Record<string, string | number>;
const s = (v: unknown) => (v === undefined || v === null ? "" : String(v));

export async function runFactsTool(orgId: string, tool: string, args: Args, ctx: { memberId?: string | null; lang?: Lang } = {}): Promise<ToolRun> {
  try {
    if (tool === "facts.lookup") {
      const { rows, available } = await loadFacts(orgId);
      if (!available) return { ok: false, summary: "", error: "migration_not_applied" };
      const hits = factsFor(rows, s(args.query), { max: 8 });
      if (!hits.length) return { ok: true, summary: "no recorded facts match — do not guess; say you are not sure or ask the owner", data: { facts: [] } };
      return { ok: true, summary: `${hits.length} fact(s)`, data: { facts: hits.map((h) => ({ label: h.fact.label, kind: h.fact.kind, value: h.fact.value, unit: h.fact.unit, version: h.fact.version, owner_confirmed: h.fact.owner_confirmed, confidence: h.fact.confidence, source: h.fact.source, observed_at: h.fact.observed_at, valid_to: h.fact.valid_to, possibly_outdated: h.stale })) } };
    }
    if (tool === "facts.history") {
      const { rows, available } = await loadFacts(orgId);
      if (!available) return { ok: false, summary: "", error: "migration_not_applied" };
      const h = historyOf(rows, s(args.label)).slice(0, 12);
      if (!h.length) return { ok: true, summary: "no history for this fact", data: { versions: [] } };
      return { ok: true, summary: `${h.length} version(s)`, data: { versions: h.map((v) => ({ version: v.version, value: v.value, unit: v.unit, status: v.status, source: v.source, owner_confirmed: v.owner_confirmed, observed_at: v.observed_at, valid_from: v.valid_from, valid_to: v.valid_to })) } };
    }
    if (tool === "facts.record") {
      // the model can never claim to be the owner: the source is "web" for a public link, otherwise "agent"
      const ref = s(args.source_ref);
      const r = await recordFact(orgId, { label: args.label, value: args.value, kind: args.kind, unit: args.unit, source: /^https?:\/\//i.test(ref) ? "web" : "agent", source_ref: ref, observed_at: args.observed_at, valid_to: args.valid_to }, { memberId: ctx.memberId ?? null, lang: ctx.lang });
      if (!r.ok) return { ok: false, summary: "", error: r.error };
      return { ok: true, summary: r.line, data: { outcome: r.outcome.kind }, link: "/ai-team" };
    }
    return { ok: false, summary: "", error: "unknown_tool" };
  } catch (e) {
    return { ok: false, summary: "", error: (e as Error).message.slice(0, 300) };
  }
}
