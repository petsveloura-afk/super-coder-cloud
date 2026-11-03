import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { GENESIS, hash53, lessonFromDecision, type DecisionRecord } from "./decision-core";
import { calibrationTable, type CalibrationBin } from "./understanding-core";
import { correctionLesson } from "./transparency-core";

/**
 * Upgrade 7 / stages E + J — decision records, server side. Append-only, scoped to one business. Without the migration every
 * function answers "nothing" / migration_not_applied and the team works exactly as before.
 */
const db = () => createAdminClient();
const missing = (e: { message?: string; code?: string } | null | undefined) => !!e && (e.code === "42P01" || e.code === "PGRST205" || /does not exist|schema cache|migration/i.test(e.message ?? ""));

/** stores one record; the chain (seq / prev_hash / hash) is continued per task from what is already stored */
export async function persistDecision(orgId: string, rec: DecisionRecord): Promise<void> {
  const a = db();
  const { data: last, error: e0 } = await a.from("team_decisions").select("seq, hash").eq("organization_id", orgId).eq("task_id", rec.task_id).order("seq", { ascending: false }).limit(1).maybeSingle();
  if (e0) return; // table missing → silently nothing
  const seq = ((last?.seq as number | undefined) ?? 0) + 1;
  const prev = (last?.hash as string | undefined) ?? GENESIS;
  const { id: _id, hash: _h, prev_hash: _p, seq: _s, ...record } = rec;
  void _id; void _h; void _p; void _s;
  // the stored hash covers the stored content + the previous hash (a re-computable chain per task)
  const hash = hash53(JSON.stringify([seq, prev, record]));
  await a.from("team_decisions").insert({ organization_id: orgId, task_id: rec.task_id, member_id: rec.member_id, seq, route: rec.route, route_reasons: rec.route_reasons, record, confidence: rec.confidence, raw_confidence: rec.raw_confidence, audit_verdict: rec.audit?.verdict ?? null, prev_hash: prev, hash });
}

export interface StoredDecision {
  id: string;
  task_id: string;
  member_id: string | null;
  seq: number;
  route: "fast" | "deep";
  route_reasons: string[];
  record: Omit<DecisionRecord, "id" | "hash" | "prev_hash" | "seq">;
  confidence: number;
  audit_verdict: string | null;
  hash: string;
  prev_hash: string;
  created_at: string;
}

export async function loadDecisions(orgId: string, opts: { taskId?: string; limit?: number } = {}): Promise<{ rows: StoredDecision[]; available: boolean }> {
  try {
    let q = db().from("team_decisions").select("id, task_id, member_id, seq, route, route_reasons, record, confidence, audit_verdict, hash, prev_hash, created_at").eq("organization_id", orgId).order("created_at", { ascending: false }).limit(opts.limit ?? 30);
    if (opts.taskId) q = q.eq("task_id", opts.taskId);
    const { data, error } = await q;
    if (error) return { rows: [], available: !missing(error) };
    return { rows: (data ?? []) as StoredDecision[], available: true };
  } catch {
    return { rows: [], available: false };
  }
}

/** the verified chain of ONE task (re-computes every hash from the stored content) */
export function verifyStored(rows: StoredDecision[]): boolean {
  const sorted = [...rows].sort((x, y) => x.seq - y.seq);
  let prev = GENESIS;
  for (const r of sorted) {
    if (r.prev_hash !== prev || r.hash !== hash53(JSON.stringify([r.seq, r.prev_hash, r.record]))) return false;
    prev = r.hash;
  }
  return true;
}

/** how often past readings were right: from the owner's outcomes (good = the confidence was justified) */
export async function loadCalibration(orgId: string): Promise<CalibrationBin[]> {
  try {
    const { data, error } = await db().from("team_decision_feedback").select("result, decision:team_decisions(raw_confidence)").eq("organization_id", orgId).order("created_at", { ascending: false }).limit(500);
    if (error) return calibrationTable([]);
    const samples = ((data ?? []) as unknown as { result: string; decision: { raw_confidence: number } | { raw_confidence: number }[] | null }[])
      .map((r) => ({ confidence: Number((Array.isArray(r.decision) ? r.decision[0] : r.decision)?.raw_confidence), correct: r.result === "good" }))
      .filter((s) => Number.isFinite(s.confidence));
    return calibrationTable(samples);
  } catch {
    return calibrationTable([]);
  }
}

/**
 * The owner judges a decision: an outcome (good / bad) and, when bad, what should have been done. The correction is stored
 * append-only and becomes a PROPOSED lesson in team memory — active only after the owner confirms it in the memory screen.
 */
export async function recordFeedback(orgId: string, decisionId: string, input: { result: "good" | "bad"; note?: string; correction?: string }, userId: string | null): Promise<{ ok: true; lessonProposed: boolean } | { ok: false; error: string }> {
  const a = db();
  const { data: d, error: e0 } = await a.from("team_decisions").select("id, member_id, record").eq("organization_id", orgId).eq("id", decisionId).maybeSingle();
  if (e0) return { ok: false, error: missing(e0) ? "migration_not_applied" : "write_failed" };
  if (!d) return { ok: false, error: "not_found" };
  const correction = input.correction?.trim().slice(0, 1000) || null;
  const { error } = await a.from("team_decision_feedback").insert({ organization_id: orgId, decision_id: decisionId, kind: correction ? "correction" : "outcome", result: input.result, note: input.note?.trim().slice(0, 1000) || null, correction, created_by: userId });
  if (error) return { ok: false, error: missing(error) ? "migration_not_applied" : "write_failed" };
  const rec = d.record as DecisionRecord;
  const lesson = correction ? correctionLesson(rec, correction) : lessonFromDecision(rec, { result: input.result, note: input.note });
  if (!lesson) return { ok: true, lessonProposed: false };
  const { writeShared } = await import("./runner-ops");
  await writeShared(orgId, [{ layer: lesson.layer, kind: lesson.kind, content: lesson.content, subject: lesson.subject, confidence: lesson.confidence, status: "proposed", tags: lesson.tags }]).catch(() => undefined);
  return { ok: true, lessonProposed: true };
}
