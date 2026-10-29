"use server";

import { revalidatePath } from "next/cache";
import { getOrgContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { dbErrorKey, type ActionState } from "@/lib/action-state";
import { PLUS_DEFAULTS, cleanPlusConfig, isPlusAgent } from "@/lib/agents/plus-core";

/** Wave 54 — switch the new AI team members on/off, save their settings, run them now. */
const loc = (l: string) => (l === "ar" || l === "en" ? l : "he");

export async function savePlusAgentAction(input: { locale: string; agent: string; enabled: boolean; config: Record<string, unknown> }): Promise<ActionState> {
  const locale = loc(input.locale);
  const ctx = await getOrgContext(locale);
  if (!ctx.can("ai.manage")) return { error: "errors.forbidden" };
  if (!isPlusAgent(input.agent)) return { error: "validation.invalidId" };
  const config = cleanPlusConfig(input.agent, input.config ?? {});
  const supabase = await createClient();
  const { error } = await supabase.from("agent_settings").upsert({ organization_id: ctx.org.id, agent: input.agent, enabled: Boolean(input.enabled), config, updated_at: new Date().toISOString() }, { onConflict: "organization_id,agent" });
  if (error) return { error: dbErrorKey(error) };
  revalidatePath(`/${locale}/agents`);
  return { ok: true, message: input.enabled ? "agents.enabled" : "agents.disabled" };
}

export async function runPlusAgentNowAction(input: { locale: string; agent: string }): Promise<ActionState<{ summary: string }>> {
  const locale = loc(input.locale);
  const ctx = await getOrgContext(locale);
  if (!ctx.can("ai.manage")) return { error: "errors.forbidden" };
  if (!isPlusAgent(input.agent)) return { error: "validation.invalidId" };
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return { error: "errors.generic" };
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const admin = createAdminClient();
  const { data: allowed } = await admin.rpc("public_rate_limit", { p_bucket: `agent:${ctx.org.id}:${input.agent}`, p_limit: 1, p_window_seconds: 120 });
  if (allowed === false) return { error: "agents.tooSoon" };
  const { data: st } = await admin.from("agent_settings").select("config").eq("organization_id", ctx.org.id).eq("agent", input.agent).maybeSingle();
  const cfg = { ...PLUS_DEFAULTS[input.agent].config, ...((st?.config as Record<string, unknown> | null) ?? {}) };
  const { PLUS_RUNNERS } = await import("@/lib/agents/run-plus");
  await PLUS_RUNNERS[input.agent](ctx.org.id, cfg);
  const { data: last } = await admin.from("agent_runs").select("summary").eq("organization_id", ctx.org.id).eq("agent", input.agent).order("created_at", { ascending: false }).limit(1).maybeSingle();
  revalidatePath(`/${locale}/agents`);
  return { ok: true, message: "agents.ran", data: { summary: (last?.summary as string | undefined) ?? "" } };
}
