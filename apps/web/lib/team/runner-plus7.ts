import "server-only";
import type { EngineDeps, EngineMember, EngineTask, Outcome } from "./engine-core";
import { TOOL_MAP } from "./tools-core";
import { withDecisionLayer } from "./engine-plus7";

/**
 * Upgrade 7 / stages D + E, server side — wraps the engine's dependencies with the understanding + decision layer, stores the
 * decision record append-only, and folds the layer's own approvals into the outcome. Any failure returns the original deps.
 */
export async function layerDeps(orgId: string, deps: EngineDeps, member: EngineMember, task: EngineTask): Promise<{ deps: EngineDeps; held: () => string[] }> {
  try {
    const { loadCalibration, persistDecision } = await import("./decisions");
    const calibration = await loadCalibration(orgId);
    const layered = withDecisionLayer(deps, {
      member: { id: member.id, name: member.name },
      task: { id: task.id, title: task.title, brief: task.brief },
      sensitivityOf: (t) => TOOL_MAP[t]?.sensitivity ?? null,
      calibration,
      persist: (r) => persistDecision(orgId, r),
      newId: () => crypto.randomUUID(),
    });
    return { deps: layered, held: () => layered.layer.heldApprovals };
  } catch {
    return { deps, held: () => [] };
  }
}

/** approvals the layer created itself make the task "awaiting approval" instead of "done" */
export function foldHeld(out: Outcome, held: string[]): Outcome {
  if (!held.length) return out;
  out.approvals.push(...held);
  if (out.status === "done") out.status = "awaiting_approval";
  return out;
}

/** once a day per business: skipped when today's morning brief already exists (the brief is the marker) */
export async function dailyPlus7(orgId: string, tz: string): Promise<void> {
  try {
    const { createAdminClient } = await import("@/lib/supabase/admin");
    const a = createAdminClient();
    const { data: org } = await a.from("organizations").select("locale").eq("id", orgId).maybeSingle();
    const lang = (org?.locale === "en" || org?.locale === "ar" ? org.locale : "he") as "he" | "en" | "ar";
    const today = new Date().toISOString().slice(0, 10);
    const { data: done, error } = await a.from("team_reports").select("id").eq("organization_id", orgId).eq("kind", "brief").eq("period_start", today).maybeSingle();
    if (error || done) return; // table missing, or already done today
    const { plus7Tick } = await import("./tools-plus7c");
    await plus7Tick(orgId, lang, tz);
  } catch {
    /* optional */
  }
}
