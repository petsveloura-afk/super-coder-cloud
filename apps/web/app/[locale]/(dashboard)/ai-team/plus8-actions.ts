"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getOrgContext } from "@/lib/auth";
import type { ActionState } from "@/lib/action-state";

/**
 * Upgrade 8 / stage A — the owner's one-click actions: restart a task (with the reason when it cannot), cancel old blocked tasks,
 * merge duplicates, and enter the sample counts of an A/B experiment. Only the owner side (ai.manage); validated again, scoped to
 * the business. Nothing is deleted: cancel / merge only change a status.
 */
const loc = (l: string): "he" | "en" | "ar" => (l === "ar" || l === "en" ? l : "he");

async function gate(locale: "he" | "en" | "ar") {
  const ctx = await getOrgContext(locale);
  if (!ctx.can("ai.manage")) return { error: "errors.forbidden" as const };
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return { error: "common.error" as const };
  const { teamFlagOn } = await import("@/lib/team/runner");
  if (!(await teamFlagOn(ctx.org.id))) return { error: "aiTeam.err.flagOff" as const };
  const { orgHasFeature } = await import("@/lib/billing/features");
  if (!(await orgHasFeature(ctx.org.id, "ai_team"))) return { error: "plans.locked.ai_team.title" as const };
  return { ctx };
}

export async function restartTaskAction(input: { locale: string; id: string }): Promise<ActionState<{ reason?: string }>> {
  const locale = loc(input.locale);
  const g = await gate(locale);
  if ("error" in g) return { error: g.error };
  const p = z.object({ id: z.string().uuid() }).safeParse(input);
  if (!p.success) return { error: "validation.invalidId" };
  const { restartTask } = await import("@/lib/team/runner-plus8");
  const r = await restartTask(g.ctx.org.id, p.data.id);
  if (!r.ok) return { error: "aiTeam.plus8.restartFailed", data: { reason: r.reason } };
  revalidatePath(`/${locale}/ai-team`);
  return { ok: true, message: "aiTeam.plus8.restarted" };
}

export async function cancelStaleBlockedAction(input: { locale: string }): Promise<ActionState<{ n: number }>> {
  const locale = loc(input.locale);
  const g = await gate(locale);
  if ("error" in g) return { error: g.error };
  const { cancelStaleBlocked } = await import("@/lib/team/runner-plus8");
  const n = await cancelStaleBlocked(g.ctx.org.id);
  revalidatePath(`/${locale}/ai-team`);
  return { ok: true, message: "common.saved", data: { n } };
}

export async function mergeDuplicatesAction(input: { locale: string }): Promise<ActionState<{ tasks: number; goals: number }>> {
  const locale = loc(input.locale);
  const g = await gate(locale);
  if ("error" in g) return { error: g.error };
  const { mergeDuplicateTasks, mergeDuplicateGoals } = await import("@/lib/team/runner-plus8");
  const [t, gl] = await Promise.all([mergeDuplicateTasks(g.ctx.org.id), mergeDuplicateGoals(g.ctx.org.id)]);
  revalidatePath(`/${locale}/ai-team`);
  return { ok: true, message: "common.saved", data: { tasks: t.merged, goals: gl.merged } };
}

const count = z.number().int().min(0).max(10_000_000);
export async function recordSampleAction(input: { locale: string; id: string; aTrials: number; aSuccesses: number; bTrials: number; bSuccesses: number }): Promise<ActionState> {
  const locale = loc(input.locale);
  const g = await gate(locale);
  if ("error" in g) return { error: g.error };
  const p = z.object({ id: z.string().uuid(), aTrials: count, aSuccesses: count, bTrials: count, bSuccesses: count }).safeParse(input);
  if (!p.success) return { error: "validation.invalid" };
  const { recordExperimentSample } = await import("@/lib/team/runner-plus8");
  const r = await recordExperimentSample(g.ctx.org.id, p.data.id, { aTrials: p.data.aTrials, aSuccesses: p.data.aSuccesses, bTrials: p.data.bTrials, bSuccesses: p.data.bSuccesses });
  if (!r.ok) return { error: r.error === "successes_over_trials" ? "aiTeam.plus8.sample.errOver" : r.error === "not_running" ? "aiTeam.plus8.sample.errNotRunning" : r.error === "migration_not_applied" ? "aiTeam.plus7.err.migration" : r.error === "not_found" ? "errors.notFound" : "common.error" };
  revalidatePath(`/${locale}/ai-team`);
  return { ok: true, message: "common.saved" };
}
