"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getOrgContext } from "@/lib/auth";
import type { ActionState } from "@/lib/action-state";
import { GOAL_METRIC_KEYS } from "@/lib/team/goals-core";

/**
 * Upgrade 7 / stages C, F, J — the owner's actions: create / activate / pause goals, start / stop experiments, judge a decision
 * (the correction becomes a PROPOSED lesson). Only the owner side (ai.manage) can do these; everything is validated again and
 * scoped to the business.
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
const errKey = (code: string) => (code === "migration_not_applied" ? "aiTeam.plus7.err.migration" : code === "not_found" ? "errors.notFound" : code === "write_failed" ? "common.error" : "validation.invalid");

export async function saveGoalAction(input: { locale: string; title: string; metric: string; target: number; dueDate: string; baseline?: number }): Promise<ActionState<{ line: string }>> {
  const locale = loc(input.locale);
  const g = await gate(locale);
  if ("error" in g) return { error: g.error };
  const p = z.object({ title: z.string().trim().min(3).max(160), metric: z.enum(GOAL_METRIC_KEYS as [string, ...string[]]), target: z.number().finite(), dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), baseline: z.number().finite().optional() }).safeParse(input);
  if (!p.success) return { error: "validation.invalid" };
  const { saveGoal } = await import("@/lib/team/goals");
  const r = await saveGoal(g.ctx.org.id, { title: p.data.title, metric: p.data.metric, target: p.data.target, due_date: p.data.dueDate, baseline: p.data.baseline }, { source: "owner", userId: g.ctx.userId, lang: locale });
  if (!r.ok) return { error: errKey(r.error) };
  revalidatePath(`/${locale}/ai-team`);
  return { ok: true, message: "common.saved", data: { line: r.line } };
}

export async function goalStatusAction(input: { locale: string; id: string; status: "active" | "paused" }): Promise<ActionState> {
  const locale = loc(input.locale);
  const g = await gate(locale);
  if ("error" in g) return { error: g.error };
  const p = z.object({ id: z.string().uuid(), status: z.enum(["active", "paused"]) }).safeParse(input);
  if (!p.success) return { error: "validation.invalidId" };
  const { setGoalStatus } = await import("@/lib/team/goals");
  const r = await setGoalStatus(g.ctx.org.id, p.data.id, p.data.status);
  if (!r.ok) return { error: errKey(r.error ?? "write_failed") };
  revalidatePath(`/${locale}/ai-team`);
  return { ok: true, message: "common.saved" };
}

export async function experimentStatusAction(input: { locale: string; id: string; status: "running" | "stopped" }): Promise<ActionState> {
  const locale = loc(input.locale);
  const g = await gate(locale);
  if ("error" in g) return { error: g.error };
  const p = z.object({ id: z.string().uuid(), status: z.enum(["running", "stopped"]) }).safeParse(input);
  if (!p.success) return { error: "validation.invalidId" };
  const { setExperimentStatus } = await import("@/lib/team/tools-plus7c");
  const r = await setExperimentStatus(g.ctx.org.id, p.data.id, p.data.status);
  if (!r.ok) return { error: errKey(r.error ?? "write_failed") };
  revalidatePath(`/${locale}/ai-team`);
  return { ok: true, message: "common.saved" };
}

export async function decisionFeedbackAction(input: { locale: string; id: string; result: "good" | "bad"; correction?: string }): Promise<ActionState<{ lessonProposed: boolean }>> {
  const locale = loc(input.locale);
  const g = await gate(locale);
  if ("error" in g) return { error: g.error };
  const p = z.object({ id: z.string().uuid(), result: z.enum(["good", "bad"]), correction: z.string().trim().max(1000).optional() }).safeParse(input);
  if (!p.success) return { error: "validation.invalid" };
  const { recordFeedback } = await import("@/lib/team/decisions");
  const r = await recordFeedback(g.ctx.org.id, p.data.id, { result: p.data.result, correction: p.data.correction }, g.ctx.userId);
  if (!r.ok) return { error: errKey(r.error) };
  revalidatePath(`/${locale}/ai-team`);
  return { ok: true, message: "common.saved", data: { lessonProposed: r.lessonProposed } };
}
