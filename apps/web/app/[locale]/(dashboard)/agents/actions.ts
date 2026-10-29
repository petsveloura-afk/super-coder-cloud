"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getOrgContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { dbErrorKey, type ActionState } from "@/lib/action-state";
import { AGENTS, AGENT_DEFAULTS, type AgentKey } from "@/lib/agents/core";

const loc = (l: string) => (l === "ar" || l === "en" ? l : "he");
const configSchema = z.record(z.string().max(40), z.union([z.number().min(0).max(1000), z.boolean(), z.string().max(400)])).refine((o) => Object.keys(o).length <= 20);

/** Wave 19 — switch an AI team member on/off and save its settings. */
export async function saveAgentAction(input: { locale: string; agent: string; enabled: boolean; config: Record<string, unknown> }): Promise<ActionState> {
  const locale = loc(input.locale);
  const ctx = await getOrgContext(locale);
  if (!ctx.can("ai.manage")) return { error: "errors.forbidden" };
  if (!(AGENTS as readonly string[]).includes(input.agent)) return { error: "validation.invalidId" };
  // wave 55: the AI team is a paid feature (plan or free trial) — switching off is always allowed
  if (input.enabled && !(await import("@/lib/billing/features").then((m) => m.orgHasFeature(ctx.org.id, "ai_team")))) return { error: "plans.locked.ai_team.title" };
  const cfg = configSchema.safeParse({ ...AGENT_DEFAULTS[input.agent as AgentKey].config, ...(input.config ?? {}) });
  if (!cfg.success) return { error: "validation.invalid" };
  const supabase = await createClient();
  const { error } = await supabase.from("agent_settings").upsert({ organization_id: ctx.org.id, agent: input.agent, enabled: Boolean(input.enabled), config: cfg.data, updated_at: new Date().toISOString() }, { onConflict: "organization_id,agent" });
  if (error) return { error: dbErrorKey(error) };
  revalidatePath(`/${locale}/agents`);
  return { ok: true, message: input.enabled ? "agents.enabled" : "agents.disabled" };
}

/** Runs one agent now for this business (owner's "try it" button). */
export async function runAgentNowAction(input: { locale: string; agent: string }): Promise<ActionState<{ summary: string }>> {
  const locale = loc(input.locale);
  const ctx = await getOrgContext(locale);
  if (!ctx.can("ai.manage")) return { error: "errors.forbidden" };
  if (!(AGENTS as readonly string[]).includes(input.agent)) return { error: "validation.invalidId" };
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return { error: "errors.generic" };
  if (!(await import("@/lib/billing/features").then((m) => m.orgHasFeature(ctx.org.id, "ai_team")))) return { error: "plans.locked.ai_team.title" };
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const admin = createAdminClient();
  // at most one manual run per agent every 2 minutes
  const { data: allowed } = await admin.rpc("public_rate_limit", { p_bucket: `agent:${ctx.org.id}:${input.agent}`, p_limit: 1, p_window_seconds: 120 });
  if (allowed === false) return { error: "agents.tooSoon" };
  const { data: st } = await admin.from("agent_settings").select("config").eq("organization_id", ctx.org.id).eq("agent", input.agent).maybeSingle();
  const cfg = { ...AGENT_DEFAULTS[input.agent as AgentKey].config, ...((st?.config as Record<string, unknown> | null) ?? {}) };
  const run = await import("@/lib/agents/run");
  const fn = { analyst: () => run.runAnalyst(ctx.org.id), sales_manager: () => run.runSalesManager(ctx.org.id, cfg), collections: () => run.runCollections(ctx.org.id, cfg), marketing: () => run.runMarketing(ctx.org.id, cfg) }[input.agent as AgentKey];
  await fn();
  const { data: last } = await admin.from("agent_runs").select("summary").eq("organization_id", ctx.org.id).eq("agent", input.agent).order("created_at", { ascending: false }).limit(1).maybeSingle();
  revalidatePath(`/${locale}/agents`);
  return { ok: true, message: "agents.ran", data: { summary: (last?.summary as string | undefined) ?? "" } };
}
