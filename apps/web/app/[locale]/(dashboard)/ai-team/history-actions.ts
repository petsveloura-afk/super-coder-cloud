"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getOrgContext } from "@/lib/auth";
import type { ActionState } from "@/lib/action-state";
import type { createAdminClient } from "@/lib/supabase/admin";

type Admin = ReturnType<typeof createAdminClient>;

/**
 * Task history clean-up (additive). The people who MANAGE the digital team can delete tasks for real, in every stage of the
 * board — finished (done / failed / canceled), waiting (pending / blocked) and waiting for an answer or approval. A task that
 * is running right now is never deleted (stop it first). What a task produced elsewhere — posts, messages, contacts — stays;
 * only the task, its internal messages and its open approvals go (database cascade). Every delete is audited.
 *
 * Goals are not deleted from here (a goal owns its tasks).
 *
 * The team's own clean-up (merge duplicates, cancel stale) and the per-user "hide from view" stay exactly as they were.
 */

const loc = (l: string): "he" | "en" | "ar" => (l === "ar" || l === "en" ? l : "he");
const DELETABLE = ["done", "failed", "canceled", "pending", "blocked", "awaiting_input", "awaiting_approval", "draft"] as const;
const FINISHED = ["done", "failed", "canceled"] as const;

/** a goal (the owner's big request) is never deleted from here — deleting it would also delete its tasks */
const NOT_GOAL = "plan->>goal.is.null,plan->>goal.neq.true";

const idsSchema = z.array(z.string().uuid()).min(1).max(200);

async function gate(locale: "he" | "en" | "ar") {
  const ctx = await getOrgContext(locale);
  if (!ctx.can("ai.manage")) return { error: "errors.forbidden" as const };
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return { error: "common.error" as const };
  const admin = await import("@/lib/supabase/admin");
  return { ctx, a: admin.createAdminClient() as Admin };
}

async function audit(a: Admin, orgId: string, userId: string, summary: string, details: Record<string, unknown>) {
  await a
    .from("team_activity")
    .insert({ organization_id: orgId, actor_user: userId, phase: "system", summary: summary.slice(0, 1000), details })
    .then(
      () => undefined,
      () => undefined,
    );
}

/** delete the chosen tasks (any stage except "running now") */
export async function deleteTeamTasksAction(input: { locale: string; ids: string[] }): Promise<ActionState<{ deleted: number; running: number }>> {
  const locale = loc(input.locale);
  const ids = idsSchema.safeParse([...new Set(input.ids ?? [])]);
  if (!ids.success) return { error: "validation.invalidId" };
  const g = await gate(locale);
  if ("error" in g) return { error: g.error };
  const { ctx, a } = g;
  const { data: rows, error } = await a.from("team_tasks").select("id, status, plan").eq("organization_id", ctx.org.id).in("id", ids.data);
  if (error) return { error: "common.error" };
  const list = (rows ?? []) as { id: string; status: string; plan?: { goal?: boolean } | null }[];
  const deletable = list.filter((x) => (DELETABLE as readonly string[]).includes(x.status) && x.plan?.goal !== true).map((x) => x.id);
  const running = list.filter((x) => x.status === "in_progress").length;
  let deleted = 0;
  if (deletable.length) {
    const { data: gone, error: delErr } = await a.from("team_tasks").delete().eq("organization_id", ctx.org.id).in("id", deletable).neq("status", "in_progress").select("id");
    if (delErr) return { error: "common.error" };
    deleted = (gone ?? []).length;
  }
  await audit(a, ctx.org.id, ctx.userId, `Tasks deleted by a manager (${deleted})`, { ids: deletable.slice(0, 50), running_skipped: running });
  revalidatePath(`/${locale}/ai-team`);
  if (!deleted && running) return { error: "aiTeam.history.runningOnly" };
  return { ok: true, message: running ? "aiTeam.history.deletedSkipped" : deleted === 1 ? "aiTeam.history.deletedOne" : "aiTeam.history.deleted", messageParams: { n: deleted, running }, data: { deleted, running } };
}

/** clear the board's history: every FINISHED task older than N days (0 = all finished tasks) */
export async function clearTaskHistoryAction(input: { locale: string; olderThanDays?: number }): Promise<ActionState<{ deleted: number }>> {
  const locale = loc(input.locale);
  const days = Math.max(0, Math.min(365, Math.floor(Number(input.olderThanDays ?? 0)) || 0));
  const g = await gate(locale);
  if ("error" in g) return { error: g.error };
  const { ctx, a } = g;
  // the ids are chosen first (a goal is filtered out on read — a JSON filter cannot be used on a delete), then deleted by id
  let q = a.from("team_tasks").select("id").eq("organization_id", ctx.org.id).in("status", [...FINISHED]).or(NOT_GOAL);
  if (days > 0) q = q.lt("created_at", new Date(Date.now() - days * 86_400_000).toISOString());
  const { data: pick, error: pickErr } = await q.limit(1000);
  if (pickErr) return { error: "common.error" };
  const ids = ((pick ?? []) as { id: string }[]).map((x) => x.id);
  let deleted = 0;
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await a.from("team_tasks").delete().eq("organization_id", ctx.org.id).in("id", ids.slice(i, i + 200)).in("status", [...FINISHED]).select("id");
    if (error) return { error: "common.error" };
    deleted += (data ?? []).length;
  }
  await audit(a, ctx.org.id, ctx.userId, `Task history cleared (${deleted}${days ? `, older than ${days} days` : ""})`, { days });
  revalidatePath(`/${locale}/ai-team`);
  return { ok: true, message: "aiTeam.history.cleared", messageParams: { n: deleted }, data: { deleted } };
}

/**
 * round 12: delete a whole GOAL (the owner's big request) with its tasks — from the "goals in progress and summaries" card.
 * Only when none of its tasks is running right now (a running task is stopped first with "stop", then the goal can go).
 * The goal and its tasks are removed together (the database cascades from the goal to its tasks, approvals and messages);
 * the team's memory, facts and the activity log stay. Recorded in the activity log.
 */
export async function deleteGoalAction(input: { locale: string; goalId: string }): Promise<ActionState<{ deleted: number }>> {
  const locale = loc(input.locale);
  const id = z.string().uuid().safeParse(input.goalId);
  if (!id.success) return { error: "validation.invalidId" };
  const g = await gate(locale);
  if ("error" in g) return { error: g.error };
  const { ctx, a } = g;
  const { data: goal } = await a.from("team_tasks").select("id, title, status, plan").eq("organization_id", ctx.org.id).eq("id", id.data).maybeSingle();
  if (!goal || (goal.plan as { goal?: boolean } | null)?.goal !== true) return { error: "errors.notFound" };
  const { data: kids } = await a.from("team_tasks").select("id, status").eq("organization_id", ctx.org.id).eq("goal_id", id.data).limit(500);
  const rows = [{ id: goal.id as string, status: goal.status as string }, ...((kids ?? []) as { id: string; status: string }[])];
  if (rows.some((r) => r.status === "in_progress")) return { error: "aiTeam.goal.deleteRunning" };
  const kidIds = rows.slice(1).map((r) => r.id);
  for (let i = 0; i < kidIds.length; i += 200) {
    const { error } = await a.from("team_tasks").delete().eq("organization_id", ctx.org.id).in("id", kidIds.slice(i, i + 200)).neq("status", "in_progress");
    if (error) return { error: "common.error" };
  }
  const { error } = await a.from("team_tasks").delete().eq("organization_id", ctx.org.id).eq("id", id.data).neq("status", "in_progress");
  if (error) return { error: "common.error" };
  await audit(a, ctx.org.id, ctx.userId, `Goal deleted by a manager: ${String(goal.title ?? "").slice(0, 200)}`, { goal: id.data, tasks: kidIds.length });
  revalidatePath(`/${locale}/ai-team`);
  return { ok: true, message: "aiTeam.goal.deleted", data: { deleted: kidIds.length + 1 } };
}
