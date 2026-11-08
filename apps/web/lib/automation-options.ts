import "server-only";
import { createClient } from "@/lib/supabase/server";
import { contactOptions, memberOptions, pipelinesWithStages } from "@/lib/lookups";
import type { BuilderOptions } from "@/components/automations/builder";

/** Everything the automation builder needs for its pickers (RLS-scoped). */
export async function builderOptions(orgId: string): Promise<BuilderOptions> {
  const supabase = await createClient();
  const [pipelines, members, contacts, tagsRes, formsRes] = await Promise.all([
    pipelinesWithStages(orgId),
    memberOptions(orgId),
    contactOptions(orgId, 200),
    supabase.from("tags").select("name").eq("organization_id", orgId).order("name").limit(500),
    // forms arrive with wave 3 — the query simply returns nothing until the table exists
    supabase.from("forms").select("id, name").eq("organization_id", orgId).order("created_at").limit(200),
  ]);
  // AI agents (read-only): lets the builder warn about a double reply when an agent already answers on a channel.
  const agentsRes = await supabase.from("ai_agents").select("name, enabled, autopilot_channels").eq("organization_id", orgId).limit(50);
  return {
    pipelines: pipelines.map((p) => ({ id: p.id, name: p.name, stages: p.stages.map((s) => ({ id: s.id, name: s.name })) })),
    members,
    contacts,
    tags: (tagsRes.data ?? []).map((x) => x.name as string),
    forms: (formsRes.error ? [] : (formsRes.data ?? [])).map((f) => ({ id: f.id as string, label: f.name as string })),
    agents: (agentsRes.error ? [] : (agentsRes.data ?? [])).map((g) => ({ name: String(g.name ?? ""), enabled: Boolean(g.enabled), autopilotChannels: ((g.autopilot_channels ?? []) as string[]).map(String) })),
  };
}
