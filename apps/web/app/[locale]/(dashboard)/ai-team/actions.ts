"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getOrgContext } from "@/lib/auth";
import type { ActionState } from "@/lib/action-state";
import { ROLES, ROLE_KEYS, isRoleKey } from "@/lib/team/roles";
import { TOOL_MAP } from "@/lib/team/tools-core";
import { TASK_KINDS } from "@/lib/team/routing-core";

/**
 * The digital team — server actions. Configuring the team needs ai.manage; giving goals, running tasks and deciding
 * approvals needs ai.use (+ the permission of the tool being approved). Everything is validated here, scoped to the
 * business, written with the service role after these checks, and audited (team_activity is append-only).
 */
const loc = (l: string): "he" | "en" | "ar" => (l === "ar" || l === "en" ? l : "he");
const uuid = z.string().uuid();
const path = (locale: string) => revalidatePath(`/${locale}/ai-team`);

async function admin() {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  return createAdminClient();
}

async function gate(locale: "he" | "en" | "ar", perm: "ai.use" | "ai.manage", opts: { plan?: boolean } = {}) {
  const ctx = await getOrgContext(locale);
  if (!ctx.can(perm)) return { error: "errors.forbidden" as const };
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return { error: "common.error" as const };
  const { teamFlagOn } = await import("@/lib/team/runner");
  if (!(await teamFlagOn(ctx.org.id))) return { error: "aiTeam.err.flagOff" as const };
  // paid feature: the digital team is part of the existing "ai_team" plan feature (Pro and up, or the 7-day trial).
  // Stopping / turning the team off is always allowed, also after the plan or the trial ended.
  if (opts.plan !== false) {
    const { orgHasFeature } = await import("@/lib/billing/features");
    if (!(await orgHasFeature(ctx.org.id, "ai_team"))) return { error: "plans.locked.ai_team.title" as const };
  }
  return { ctx };
}

async function audit(orgId: string, userId: string, summary: string, details: Record<string, unknown> = {}) {
  await (await admin()).from("team_activity").insert({ organization_id: orgId, actor_user: userId, phase: "system", summary: summary.slice(0, 1000), details }).then(
    () => undefined,
    () => undefined,
  );
}

/* ------------------------------------------------------------------ settings */

export async function setTeamEnabledAction(input: { locale: string; enabled: boolean }): Promise<ActionState<{ seeded: number }>> {
  const locale = loc(input.locale);
  const g = await gate(locale, "ai.manage", { plan: Boolean(input.enabled) });
  if ("error" in g) return { error: g.error };
  const a = await admin();
  const { error } = await a.from("team_settings").upsert({ organization_id: g.ctx.org.id, enabled: Boolean(input.enabled), updated_by: g.ctx.userId, updated_at: new Date().toISOString() }, { onConflict: "organization_id" });
  if (error) return { error: "common.error" };
  let seeded = 0;
  if (input.enabled) {
    const { seedStarterTeam } = await import("@/lib/team/runner");
    seeded = await seedStarterTeam(g.ctx.org.id, g.ctx.userId, locale);
  }
  await audit(g.ctx.org.id, g.ctx.userId, input.enabled ? "Team turned on" : "Team turned off", { seeded });
  path(locale);
  return { ok: true, message: input.enabled ? "aiTeam.msg.on" : "aiTeam.msg.off", data: { seeded } };
}

export async function emergencyStopAction(input: { locale: string; on: boolean }): Promise<ActionState> {
  const locale = loc(input.locale);
  // the emergency stop is allowed to anyone who can use the team (stopping is always safe)
  const g = await gate(locale, "ai.use", { plan: false });
  if ("error" in g) return { error: g.error };
  if (!input.on && !g.ctx.can("ai.manage")) return { error: "errors.forbidden" };
  const a = await admin();
  const { error } = await a.from("team_settings").upsert({ organization_id: g.ctx.org.id, emergency_stop: Boolean(input.on), updated_by: g.ctx.userId, updated_at: new Date().toISOString() }, { onConflict: "organization_id" });
  if (error) return { error: "common.error" };
  await audit(g.ctx.org.id, g.ctx.userId, input.on ? "EMERGENCY STOP — the team is frozen" : "Emergency stop released");
  path(locale);
  return { ok: true, message: input.on ? "aiTeam.msg.stopped" : "aiTeam.msg.released" };
}

const settingsSchema = z.object({
  routing_pref: z.enum(["quality", "balanced", "speed", "cost"]),
  daily_credit_cap: z.coerce.number().int().min(0).max(100000),
  max_depth: z.coerce.number().int().min(1).max(6),
  max_steps: z.coerce.number().int().min(1).max(60),
  initiative: z.boolean(),
});

export async function saveTeamSettingsAction(input: { locale: string } & z.input<typeof settingsSchema>): Promise<ActionState> {
  const locale = loc(input.locale);
  const g = await gate(locale, "ai.manage");
  if ("error" in g) return { error: g.error };
  const p = settingsSchema.safeParse(input);
  if (!p.success) return { error: "validation.invalid" };
  const { error } = await (await admin()).from("team_settings").upsert({ organization_id: g.ctx.org.id, ...p.data, updated_by: g.ctx.userId, updated_at: new Date().toISOString() }, { onConflict: "organization_id" });
  if (error) return { error: "common.error" };
  await audit(g.ctx.org.id, g.ctx.userId, "Team settings saved", p.data);
  path(locale);
  return { ok: true, message: "common.saved" };
}

/* ------------------------------------------------------------------ employees */

const memberSchema = z.object({
  id: uuid.optional(),
  role_key: z.enum(ROLE_KEYS),
  name: z.string().trim().min(1).max(80),
  title: z.string().trim().max(120).optional().default(""),
  avatar: z
    .object({
      hue: z.coerce.number().int().min(0).max(360),
      accessory: z.enum(["none", "tie", "headset", "pen", "chart", "brush", "clipboard", "shield", "coin", "star", "megaphone", "laptop", "spark"]),
      face: z.enum(["smile", "cheer", "calm", "focus"]),
      skin: z.enum(["light", "tan", "brown", "dark"]),
      hair: z.enum(["short", "long", "curly", "bun", "none"]),
    })
    .partial()
    .optional()
    .default({}),
  tone: z.string().trim().max(400).optional().default(""),
  instructions: z.string().trim().max(6000).optional().default(""),
  tools: z.array(z.string()).max(40),
  autonomy: z.enum(["suggest", "approve", "auto"]),
  auto_actions: z.array(z.string()).max(40).optional().default([]),
  reports_to: uuid.nullable().optional(),
  status: z.enum(["active", "paused"]).optional().default("active"),
  limits: z.object({ max_steps: z.coerce.number().int().min(1).max(60), max_credits: z.coerce.number().int().min(1).max(500) }).partial().optional().default({}),
});

export async function saveMemberAction(input: { locale: string } & z.input<typeof memberSchema>): Promise<ActionState<{ id: string }>> {
  const locale = loc(input.locale);
  const g = await gate(locale, "ai.manage");
  if ("error" in g) return { error: g.error };
  const p = memberSchema.safeParse(input);
  if (!p.success) return { error: "validation.invalid" };
  const d = p.data;
  // only real tools; autonomous actions must be among the employee's tools
  const tools = [...new Set(d.tools.filter((t) => t in TOOL_MAP))];
  const auto = [...new Set(d.auto_actions.filter((t) => tools.includes(t) && TOOL_MAP[t]!.kind === "write"))];
  const a = await admin();
  if (d.reports_to) {
    const { data: boss } = await a.from("team_members").select("id").eq("organization_id", g.ctx.org.id).eq("id", d.reports_to).maybeSingle();
    if (!boss || d.reports_to === d.id) return { error: "validation.invalidId" };
  }
  const row = { role_key: d.role_key, name: d.name, title: d.title || null, avatar: { ...ROLES[d.role_key].avatar, ...d.avatar }, tone: d.tone || null, instructions: d.instructions, tools, autonomy: d.autonomy, auto_actions: auto, reports_to: d.reports_to ?? null, status: d.status, limits: d.limits, updated_at: new Date().toISOString() };
  let id = d.id;
  if (id) {
    const { data, error } = await a.from("team_members").update(row).eq("organization_id", g.ctx.org.id).eq("id", id).select("id");
    if (error || !data?.length) return { error: error ? "common.error" : "errors.notFound" };
  } else {
    const { count } = await a.from("team_members").select("id", { count: "exact", head: true }).eq("organization_id", g.ctx.org.id);
    if ((count ?? 0) >= 40) return { error: "aiTeam.err.tooMany" };
    const { data, error } = await a.from("team_members").insert({ ...row, organization_id: g.ctx.org.id, position: count ?? 0, created_by: g.ctx.userId }).select("id").single();
    if (error || !data) return { error: "common.error" };
    id = data.id as string;
  }
  await audit(g.ctx.org.id, g.ctx.userId, `${d.id ? "Employee updated" : "Employee hired"}: ${d.name} (${d.role_key})`, { member: id, autonomy: d.autonomy, auto });
  path(locale);
  return { ok: true, message: "common.saved", data: { id: id! } };
}

export async function duplicateMemberAction(input: { locale: string; id: string }): Promise<ActionState<{ id: string }>> {
  const locale = loc(input.locale);
  const g = await gate(locale, "ai.manage");
  if ("error" in g) return { error: g.error };
  if (!uuid.safeParse(input.id).success) return { error: "validation.invalidId" };
  const a = await admin();
  const { data: m } = await a.from("team_members").select("role_key, name, title, avatar, tone, instructions, tools, autonomy, auto_actions, reports_to, limits, position").eq("organization_id", g.ctx.org.id).eq("id", input.id).maybeSingle();
  if (!m) return { error: "errors.notFound" };
  const { data, error } = await a.from("team_members").insert({ ...m, name: `${String(m.name).slice(0, 72)} (2)`, status: "paused", organization_id: g.ctx.org.id, created_by: g.ctx.userId, position: (m.position as number) + 1 }).select("id").single();
  if (error || !data) return { error: "common.error" };
  await audit(g.ctx.org.id, g.ctx.userId, `Employee duplicated: ${m.name}`, { from: input.id, to: data.id });
  path(locale);
  return { ok: true, message: "aiTeam.msg.duplicated", data: { id: data.id as string } };
}

/* ------------------------------------------------------------------ goals + tasks */

export async function planGoalAction(input: { locale: string; goal: string }): Promise<ActionState<{ goalId: string }>> {
  const locale = loc(input.locale);
  const g = await gate(locale, "ai.use");
  if ("error" in g) return { error: g.error };
  const goal = z.string().trim().min(5).max(2000).safeParse(input.goal);
  if (!goal.success) return { error: "aiTeam.err.goalShort" };
  const { planGoal } = await import("@/lib/team/runner");
  const r = await planGoal(g.ctx.org.id, goal.data, g.ctx.userId);
  if (!r.ok) return { error: r.error };
  path(locale);
  return { ok: true, message: "aiTeam.msg.planned", data: { goalId: r.goalId } };
}

export async function confirmGoalAction(input: { locale: string; goalId: string }): Promise<ActionState> {
  const locale = loc(input.locale);
  const g = await gate(locale, "ai.use");
  if ("error" in g) return { error: g.error };
  if (!uuid.safeParse(input.goalId).success) return { error: "validation.invalidId" };
  const { confirmGoal } = await import("@/lib/team/runner");
  const r = await confirmGoal(g.ctx.org.id, input.goalId, g.ctx.userId);
  if (!r.ok) return { error: r.error ?? "common.error" };
  path(locale);
  return { ok: true, message: "aiTeam.msg.started", messageParams: { n: r.created ?? 0 } };
}

export async function cancelTaskAction(input: { locale: string; taskId: string }): Promise<ActionState> {
  const locale = loc(input.locale);
  const g = await gate(locale, "ai.use");
  if ("error" in g) return { error: g.error };
  if (!uuid.safeParse(input.taskId).success) return { error: "validation.invalidId" };
  const a = await admin();
  const { data } = await a.from("team_tasks").update({ status: "canceled", updated_at: new Date().toISOString(), finished_at: new Date().toISOString() }).eq("organization_id", g.ctx.org.id).or(`id.eq.${input.taskId},goal_id.eq.${input.taskId}`).in("status", ["draft", "pending", "awaiting_input", "blocked", "awaiting_approval"]).select("id");
  await a.from("team_approvals").update({ status: "expired" }).eq("organization_id", g.ctx.org.id).eq("status", "pending").in("task_id", ((data ?? []) as { id: string }[]).map((x) => x.id));
  await audit(g.ctx.org.id, g.ctx.userId, `Task canceled (${data?.length ?? 0})`, { task: input.taskId });
  path(locale);
  return { ok: true, message: "aiTeam.msg.canceled" };
}

export async function createTaskAction(input: { locale: string; memberId: string; title: string; brief?: string }): Promise<ActionState<{ taskId: string }>> {
  const locale = loc(input.locale);
  const g = await gate(locale, "ai.use");
  if ("error" in g) return { error: g.error };
  const p = z.object({ memberId: uuid, title: z.string().trim().min(3).max(300), brief: z.string().trim().max(6000).optional().default("") }).safeParse(input);
  if (!p.success) return { error: "validation.invalid" };
  const a = await admin();
  const { data: m } = await a.from("team_members").select("id").eq("organization_id", g.ctx.org.id).eq("id", p.data.memberId).maybeSingle();
  if (!m) return { error: "errors.notFound" };
  const { data, error } = await a.from("team_tasks").insert({ organization_id: g.ctx.org.id, title: p.data.title, brief: p.data.brief, assignee_id: m.id, status: "pending", origin: "user", created_by: g.ctx.userId }).select("id").single();
  if (error || !data) return { error: "common.error" };
  path(locale);
  return { ok: true, message: "aiTeam.msg.taskCreated", data: { taskId: data.id as string } };
}

/** start an initiative proposal ("draft") or run a pending task right now (from the screen: site building allowed) */
export async function runTaskNowAction(input: { locale: string; taskId: string }): Promise<ActionState<{ status: string }>> {
  const locale = loc(input.locale);
  const g = await gate(locale, "ai.use");
  if ("error" in g) return { error: g.error };
  if (!uuid.safeParse(input.taskId).success) return { error: "validation.invalidId" };
  const a = await admin();
  await a.from("team_tasks").update({ status: "pending", updated_at: new Date().toISOString() }).eq("organization_id", g.ctx.org.id).eq("id", input.taskId).eq("status", "draft").is("goal_id", null).neq("origin", "user");
  const { runTask } = await import("@/lib/team/runner");
  const r = await runTask(g.ctx.org.id, input.taskId, { interactive: true, actorUser: g.ctx.userId });
  path(locale);
  if ("notRun" in r) return { error: r.notRun === "not_pending" ? "aiTeam.err.notPending" : r.notRun === "team_flag_off" ? "aiTeam.err.flagOff" : "common.error" };
  return { ok: true, message: `aiTeam.status.${r.status}`, data: { status: r.status } };
}

export async function answerQuestionAction(input: { locale: string; taskId: string; answer: string }): Promise<ActionState> {
  const locale = loc(input.locale);
  const g = await gate(locale, "ai.use");
  if ("error" in g) return { error: g.error };
  const p = z.object({ taskId: uuid, answer: z.string().trim().min(1).max(2000) }).safeParse(input);
  if (!p.success) return { error: "validation.invalid" };
  const { answerQuestion } = await import("@/lib/team/runner");
  if (!(await answerQuestion(g.ctx.org.id, p.data.taskId, p.data.answer))) return { error: "aiTeam.err.notWaiting" };
  await audit(g.ctx.org.id, g.ctx.userId, "Owner answered an employee's question", { task: p.data.taskId });
  path(locale);
  return { ok: true, message: "aiTeam.msg.answered" };
}

/* ------------------------------------------------------------------ approvals */

export async function decideApprovalAction(input: { locale: string; id: string; kind: "approve" | "reject" | "edit"; note?: string; text?: string }): Promise<ActionState> {
  const locale = loc(input.locale);
  const g = await gate(locale, "ai.use");
  if ("error" in g) return { error: g.error };
  const p = z.object({ id: uuid, kind: z.enum(["approve", "reject", "edit"]), note: z.string().trim().max(1000).optional(), text: z.string().trim().max(4000).optional() }).safeParse(input);
  if (!p.success) return { error: "validation.invalid" };
  const a = await admin();
  const { data: ap } = await a.from("team_approvals").select("tool").eq("organization_id", g.ctx.org.id).eq("id", p.data.id).maybeSingle();
  if (!ap) return { error: "errors.notFound" };
  // approving runs the action in this person's name — they need its permission (rejecting is always allowed)
  const spec = TOOL_MAP[ap.tool as string];
  if (p.data.kind !== "reject" && spec && !g.ctx.can(spec.permission as Parameters<typeof g.ctx.can>[0])) return { error: "errors.forbidden" };
  const { decideApproval } = await import("@/lib/team/runner");
  const r = await decideApproval(g.ctx.org.id, p.data.id, { kind: p.data.kind, note: p.data.note, text: p.data.text }, g.ctx.userId);
  path(locale);
  if (!r.ok) return { error: r.error ?? "common.error", messageParams: { detail: r.result ?? "" } };
  return { ok: true, message: p.data.kind === "reject" ? "aiTeam.msg.rejected" : "aiTeam.msg.approved" };
}

export async function approveManyAction(input: { locale: string; ids: string[] }): Promise<ActionState<{ done: number; failed: number }>> {
  const locale = loc(input.locale);
  const ids = (input.ids ?? []).filter((x) => uuid.safeParse(x).success).slice(0, 30);
  let done = 0;
  let failed = 0;
  // the same checks as one approval, up front (each approval is checked again for its own tool's permission)
  const g = await gate(locale, "ai.use");
  if ("error" in g) return { error: g.error };
  if (!g.ctx.can("ai.use")) return { error: "errors.forbidden" };
  for (const id of ids) {
    const r = await decideApprovalAction({ locale, id, kind: "approve" });
    if (r.ok) done++;
    else failed++;
  }
  return { ok: true, message: "aiTeam.msg.bulk", messageParams: { done, failed }, data: { done, failed } };
}

/* ------------------------------------------------------------------ memory */

export async function memoryAction(input: { locale: string; op: "confirm" | "revoke" | "delete" | "edit" | "add" | "reset"; id?: string; memberId?: string | null; content?: string; kind?: string; subject?: string }): Promise<ActionState> {
  const locale = loc(input.locale);
  const g = await gate(locale, "ai.manage");
  if ("error" in g) return { error: g.error };
  const a = await admin();
  const org = g.ctx.org.id;
  const now = new Date().toISOString();
  if (input.op === "add") {
    const p = z.object({ content: z.string().trim().min(2).max(2000), kind: z.enum(["fact", "preference", "forbidden", "policy"]), subject: z.string().trim().max(120).optional(), memberId: uuid.nullable().optional() }).safeParse(input);
    if (!p.success) return { error: "validation.invalid" };
    const { writeMemories } = await import("@/lib/team/runner");
    await writeMemories(org, p.data.memberId ?? null, [{ layer: "semantic", kind: p.data.kind, content: p.data.content, subject: p.data.subject || null, confidence: 1, status: "active" }]);
  } else if (input.op === "reset") {
    const m = input.memberId === null ? null : uuid.safeParse(input.memberId);
    let q = a.from("team_memory").delete().eq("organization_id", org);
    q = m === null ? q.is("member_id", null) : m.success ? q.eq("member_id", m.data) : q.eq("id", "00000000-0000-0000-0000-000000000000");
    const { error } = await q;
    if (error) return { error: "common.error" };
  } else {
    if (!uuid.safeParse(input.id).success) return { error: "validation.invalidId" };
    const base = a.from("team_memory");
    const r =
      input.op === "confirm"
        ? await base.update({ status: "active", confidence: 0.9, source: "user", updated_at: now }).eq("organization_id", org).eq("id", input.id!).select("id")
        : input.op === "revoke"
          ? await base.update({ status: "revoked", updated_at: now }).eq("organization_id", org).eq("id", input.id!).select("id")
          : input.op === "edit"
            ? z.string().trim().min(2).max(2000).safeParse(input.content).success
              ? await base.update({ content: input.content!.trim(), source: "user", confidence: 1, updated_at: now }).eq("organization_id", org).eq("id", input.id!).select("id")
              : { data: null, error: { message: "invalid" } }
            : await base.delete().eq("organization_id", org).eq("id", input.id!).select("id");
    if (r.error) return { error: "validation.invalid" };
    if (!r.data?.length) return { error: "errors.notFound" };
  }
  await audit(org, g.ctx.userId, `Memory ${input.op}`, { id: input.id ?? null, member: input.memberId ?? null });
  path(locale);
  return { ok: true, message: "common.saved" };
}

/* ------------------------------------------------------------------ playbook additions */

export async function savePlaybookExtraAction(input: { locale: string; role: string; extra: string }): Promise<ActionState> {
  const locale = loc(input.locale);
  const g = await gate(locale, "ai.manage");
  if ("error" in g) return { error: g.error };
  if (!isRoleKey(input.role)) return { error: "validation.invalid" };
  const extra = String(input.extra ?? "").slice(0, 6000);
  const { error } = await (await admin()).from("team_playbooks").upsert({ organization_id: g.ctx.org.id, role_key: input.role, extra, updated_by: g.ctx.userId, updated_at: new Date().toISOString() }, { onConflict: "organization_id,role_key" });
  if (error) return { error: "common.error" };
  await audit(g.ctx.org.id, g.ctx.userId, `Playbook additions saved: ${input.role}`, { length: extra.length });
  path(locale);
  return { ok: true, message: "common.saved" };
}

/* ------------------------------------------------------------------ test chat before hiring (no tools run) */

export async function testChatAction(input: { locale: string; role: string; name: string; tone?: string; instructions?: string; message: string; history?: { role: "user" | "assistant"; content: string }[] }): Promise<ActionState<{ reply: string }>> {
  const locale = loc(input.locale);
  const g = await gate(locale, "ai.use");
  if ("error" in g) return { error: g.error };
  const p = z.object({ role: z.enum(ROLE_KEYS), name: z.string().trim().min(1).max(80), tone: z.string().max(400).optional(), instructions: z.string().max(6000).optional(), message: z.string().trim().min(1).max(2000), history: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(4000) })).max(12).optional() }).safeParse(input);
  if (!p.success) return { error: "validation.invalid" };
  const { loadProfile } = await import("@/lib/team/runner");
  const { employeeSystem } = await import("@/lib/team/engine-core");
  const { knownFacts, profilePrompt } = await import("@/lib/team/insight-core");
  const { asData } = await import("@/lib/team/safety-core");
  const profile = await loadProfile(g.ctx.org.id);
  const member = { id: "test", role: p.data.role, name: p.data.name, tone: p.data.tone ?? null, instructions: p.data.instructions ?? "", tools: ROLES[p.data.role].tools, autonomy: "suggest" as const, auto_actions: [], status: "active" as const, limits: {} };
  const system = `${employeeSystem(member, { profile: profilePrompt(profile), known: knownFacts(profile), memories: [], playbookExtra: "", reviewer: null }, locale, p.data.message)}\n\nThis is a TEST CONVERSATION with the owner before hiring you: answer in character, explain how you would work; do not claim you already did actions.`;
  const { runAISystem } = await import("@/lib/ai/run-system");
  const messages = [...(p.data.history ?? []), { role: "user" as const, content: asData("owner message", p.data.message, 2000) }];
  const r = await runAISystem({ orgId: g.ctx.org.id, feature: "copilot", system, messages, temperature: 0.6, maxTokens: 700, patienceMs: 25_000 });
  if (!r.ok) return { error: r.error ?? "ai.failed" };
  return { ok: true, data: { reply: r.text.trim() } };
}

/* ------------------------------------------------------------------ platform admin: flag + model routing */

export async function setTeamFlagAction(input: { locale: string; scope: "org" | "global"; enabled: boolean }): Promise<ActionState> {
  const locale = loc(input.locale);
  const ctx = await getOrgContext(locale);
  if (!ctx.isPlatformAdmin) return { error: "errors.forbidden" };
  const a = await admin();
  const orgId = input.scope === "global" ? null : ctx.org.id;
  const q = a.from("feature_flags").select("key").eq("key", "team_v1");
  const { data: existing } = await (orgId ? q.eq("organization_id", orgId) : q.is("organization_id", null)).maybeSingle();
  const r = existing
    ? await (orgId ? a.from("feature_flags").update({ enabled: Boolean(input.enabled), updated_at: new Date().toISOString() }).eq("key", "team_v1").eq("organization_id", orgId) : a.from("feature_flags").update({ enabled: Boolean(input.enabled), updated_at: new Date().toISOString() }).eq("key", "team_v1").is("organization_id", null))
    : await a.from("feature_flags").insert({ key: "team_v1", organization_id: orgId, enabled: Boolean(input.enabled) });
  if (r.error) return { error: "common.error" };
  await a.from("audit_logs").insert({ organization_id: ctx.org.id, actor_id: ctx.userId, action: "team.flag", entity_type: "organization", entity_id: ctx.org.id, metadata: { scope: input.scope, enabled: input.enabled } }).then(
    () => undefined,
    () => undefined,
  );
  path(locale);
  return { ok: true, message: "common.saved" };
}

export async function saveRoutingAction(input: { locale: string; kind: string; models: { provider: string; model: string }[] }): Promise<ActionState> {
  const locale = loc(input.locale);
  const ctx = await getOrgContext(locale);
  if (!ctx.isPlatformAdmin) return { error: "errors.forbidden" };
  if (!(TASK_KINDS as string[]).includes(input.kind)) return { error: "validation.invalid" };
  const { cleanRoutingRow } = await import("@/lib/team/routing-core");
  const row = cleanRoutingRow(input.kind, input.models);
  if (!row) return { error: "validation.invalid" };
  const { error } = await (await admin()).from("ai_routing").upsert({ task_kind: row.kind, models: row.models, updated_by: ctx.userId, updated_at: new Date().toISOString() }, { onConflict: "task_kind" });
  if (error) return { error: "common.error" };
  path(locale);
  return { ok: true, message: "common.saved" };
}
