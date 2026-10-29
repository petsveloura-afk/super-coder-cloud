"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { uuidSchema } from "@scc/shared/validators";
import { getOrgContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { dbErrorKey, type ActionState } from "@/lib/action-state";

/** Wave 16 — agent guardrails and conversation flows. */
const loc = (l: unknown) => (l === "ar" || l === "en" ? l : "he") as "he" | "ar" | "en";

const railsSchema = z.object({
  max_replies_per_day: z.coerce.number().int().min(0).max(500),
  banned: z.array(z.string().trim().min(2).max(80)).max(50),
  price_guard: z.boolean(),
  angry_handoff: z.boolean(),
  kb: z.boolean(),
  voice_replies: z.boolean(),
});

export async function saveGuardrailsAction(input: { locale: string; agentId: string; rails: unknown }): Promise<ActionState> {
  const locale = loc(input.locale);
  const ctx = await getOrgContext(locale);
  if (!ctx.can("ai.manage")) return { error: "errors.forbidden" };
  const id = uuidSchema.safeParse(input.agentId);
  if (!id.success) return { error: "validation.invalidId" };
  const p = railsSchema.safeParse(input.rails);
  if (!p.success) return { error: "rails.invalid" };
  // wave 55: voice answers are a paid feature (plan or free trial)
  if (p.data.voice_replies) {
    const { orgHasFeature } = await import("@/lib/billing/features");
    if (!(await orgHasFeature(ctx.org.id, "voice_notes"))) return { error: "plans.locked.voice_notes.title" };
  }
  const supabase = await createClient();
  const { error } = await supabase.from("ai_agents").update({ guardrails: p.data }).eq("id", id.data).eq("organization_id", ctx.org.id);
  if (error) return { error: dbErrorKey(error) };
  revalidatePath(`/${locale}/ai-agents/${id.data}/setup`);
  return { ok: true, message: "rails.saved" };
}

const nodeSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9_-]{1,40}$/),
  type: z.enum(["message", "buttons", "collect", "handoff", "ai", "end"]),
  text: z.string().max(1500).optional().default(""),
  buttons: z.array(z.object({ label: z.string().trim().min(1).max(60), next: z.string().max(40).nullable().optional() })).max(10).optional(),
  field: z.string().max(40).optional(),
  next: z.string().max(40).nullable().optional(),
});
const flowSchema = z.object({
  name: z.string().trim().min(1).max(120),
  enabled: z.boolean(),
  trigger_keywords: z.array(z.string().trim().min(1).max(60)).max(20),
  on_first_message: z.boolean(),
  nodes: z.array(nodeSchema).min(1).max(60),
});

export async function saveFlowAction(input: { locale: string; agentId: string; flowId?: string | null; flow: unknown }): Promise<ActionState<{ id: string }>> {
  const locale = loc(input.locale);
  const ctx = await getOrgContext(locale);
  if (!ctx.can("ai.manage")) return { error: "errors.forbidden" };
  const agent = uuidSchema.safeParse(input.agentId);
  if (!agent.success) return { error: "validation.invalidId" };
  const { orgHasFeature } = await import("@/lib/billing/features");
  if (!(await orgHasFeature(ctx.org.id, "flow_builder"))) return { error: "plans.locked.flow_builder.title" };
  const p = flowSchema.safeParse(input.flow);
  if (!p.success) return { error: "flows.invalid" };
  // every "next" must point at an existing step
  const ids = new Set(p.data.nodes.map((n) => n.id));
  if (ids.size !== p.data.nodes.length) return { error: "flows.duplicateStep" };
  for (const n of p.data.nodes) {
    if (n.next && !ids.has(n.next)) return { error: "flows.badLink" };
    for (const b of n.buttons ?? []) if (b.next && !ids.has(b.next)) return { error: "flows.badLink" };
    if (n.type === "buttons" && !(n.buttons ?? []).length) return { error: "flows.needButtons" };
  }
  const supabase = await createClient();
  const row = { ...p.data, agent_id: agent.data, organization_id: ctx.org.id };
  if (input.flowId) {
    const id = uuidSchema.safeParse(input.flowId);
    if (!id.success) return { error: "validation.invalidId" };
    const { error } = await supabase.from("agent_flows").update(row).eq("id", id.data).eq("organization_id", ctx.org.id);
    if (error) return { error: dbErrorKey(error) };
    revalidatePath(`/${locale}/ai-agents/${agent.data}/setup`);
    return { ok: true, message: "flows.saved", data: { id: id.data } };
  }
  const { data, error } = await supabase.from("agent_flows").insert({ ...row, created_by: ctx.userId }).select("id").single();
  if (error || !data) return { error: dbErrorKey(error) };
  revalidatePath(`/${locale}/ai-agents/${agent.data}/setup`);
  return { ok: true, message: "flows.saved", data: { id: data.id as string } };
}

export async function deleteFlowAction(input: { locale: string; flowId: string; agentId: string }): Promise<ActionState> {
  const locale = loc(input.locale);
  const ctx = await getOrgContext(locale);
  if (!ctx.can("ai.manage")) return { error: "errors.forbidden" };
  const id = uuidSchema.safeParse(input.flowId);
  if (!id.success) return { error: "validation.invalidId" };
  const supabase = await createClient();
  const { error } = await supabase.from("agent_flows").delete().eq("id", id.data).eq("organization_id", ctx.org.id);
  if (error) return { error: dbErrorKey(error) };
  revalidatePath(`/${locale}/ai-agents/${input.agentId}/setup`);
  return { ok: true, message: "flows.deleted" };
}
