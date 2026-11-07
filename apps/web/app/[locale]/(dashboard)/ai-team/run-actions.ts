"use server";

import { z } from "zod";
import { getOrgContext } from "@/lib/auth";
import type { ActionState } from "@/lib/action-state";

/**
 * Run a task from the screen — professionally (additive). Before, "run now" / "try again" did the WHOLE task inside the
 * button's request: a long run was cut off by the 60-second limit, the screen showed "something went wrong" and the task stayed
 * "in progress". Now the button only STARTS the work in its own server call (full time budget) and returns at once; the screen
 * then follows the task (taskProgressAction) and shows the real result — and retries by itself when the engines were busy.
 */
const loc = (l: string): "he" | "en" | "ar" => (l === "ar" || l === "en" ? l : "he");
const uuid = z.string().uuid();

async function gate(locale: "he" | "en" | "ar") {
  const ctx = await getOrgContext(locale);
  if (!ctx.can("ai.use")) return { error: "errors.forbidden" as const };
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return { error: "common.error" as const };
  const { teamFlagOn } = await import("@/lib/team/runner");
  if (!(await teamFlagOn(ctx.org.id))) return { error: "aiTeam.err.flagOff" as const };
  const { orgHasFeature } = await import("@/lib/billing/features");
  if (!(await orgHasFeature(ctx.org.id, "ai_team"))) return { error: "plans.locked.ai_team.title" as const };
  return { ctx };
}

/** starts (or restarts) one task: failed / blocked → a fresh start; draft → pending; then its own server call runs it */
export async function startTaskAction(input: { locale: string; taskId: string }): Promise<ActionState<{ status: string; started: boolean }>> {
  const locale = loc(input.locale);
  const g = await gate(locale);
  if ("error" in g) return { error: g.error };
  if (!uuid.safeParse(input.taskId).success) return { error: "validation.invalidId" };
  const orgId = g.ctx.org.id;
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const a = createAdminClient();
  // security (additive): at most 30 starts a minute per business (a stuck button / script can not flood the AI engines)
  const { data: allowed } = await a.rpc("public_rate_limit", { p_bucket: `team-start:${orgId}`, p_limit: 30, p_window_seconds: 60 });
  if (allowed === false) return { error: "aiTeam.run.tooFast" };
  const { data: t } = await a.from("team_tasks").select("id, status, origin, goal_id").eq("organization_id", orgId).eq("id", input.taskId).maybeSingle();
  if (!t) return { error: "validation.invalidId" };
  const status = String(t.status);
  if (status === "in_progress") return { ok: true, data: { status, started: false } };
  if (["failed", "blocked", "requires_connection"].includes(status)) {
    // security (parity with the restart button): giving a stopped task a fresh start needs the "manage AI" permission
    if (!g.ctx.can("ai.manage")) return { error: "errors.forbidden" };
    const { restartTask } = await import("@/lib/team/runner-plus8");
    const r = await restartTask(orgId, input.taskId);
    if (!r.ok) return { error: r.reason === "dependency_failed" ? "aiTeam.run.waitingDependency" : r.reason === "emergency_stop" ? "aiTeam.err.stopped" : r.reason === "budget" ? "aiTeam.run.budget" : "aiTeam.plus8.restartFailed" };
  } else if (status === "draft" && !t.goal_id && t.origin !== "user") {
    await a.from("team_tasks").update({ status: "pending", updated_at: new Date().toISOString() }).eq("organization_id", orgId).eq("id", input.taskId).eq("status", "draft");
  } else if (status !== "pending") {
    return { error: "aiTeam.err.notPending" };
  }
  const { dispatchTaskRun, runTask } = await import("@/lib/team/runner");
  if (await dispatchTaskRun(orgId, input.taskId)) return { ok: true, data: { status: "in_progress", started: true } };
  // no separate call possible (e.g. no CRON_SECRET) → run here, with an end time inside this request's limit
  const r = await runTask(orgId, input.taskId, { interactive: true, actorUser: g.ctx.userId, deadlineAt: Date.now() + 45_000 }).catch(() => ({ notRun: "error" }));
  return { ok: true, data: { status: "notRun" in r ? "pending" : r.status, started: true } };
}

/** what the screen follows while the scene is open: the task's status + its latest activity line (cheap, one row) */
export async function taskProgressAction(input: { locale: string; taskId: string }): Promise<ActionState<{ status: string; error: string | null; line: string | null; partial: boolean; drafts: number }>> {
  const locale = loc(input.locale);
  const ctx = await getOrgContext(locale);
  if (!ctx.can("ai.use")) return { error: "errors.forbidden" };
  if (!uuid.safeParse(input.taskId).success) return { error: "validation.invalidId" };
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return { error: "common.error" };
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const a = createAdminClient();
  const [{ data: t }, { data: act }] = await Promise.all([
    a.from("team_tasks").select("status, error, result").eq("organization_id", ctx.org.id).eq("id", input.taskId).maybeSingle(),
    a.from("team_activity").select("summary").eq("organization_id", ctx.org.id).eq("task_id", input.taskId).order("id", { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (!t) return { error: "validation.invalidId" };
  const res = (t.result ?? {}) as { partial?: boolean; drafts?: number };
  return { ok: true, data: { status: String(t.status), error: (t.error as string | null) ?? null, line: (act?.summary as string | null)?.slice(0, 160) ?? null, partial: Boolean(res.partial), drafts: Number(res.drafts ?? 0) } };
}
