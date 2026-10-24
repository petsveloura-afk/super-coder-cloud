import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { averageReplyMs, startOfTodayIso } from "./pulse-core";

export interface AiPulse {
  agentName: string | null;
  agentOn: boolean;
  repliesToday: number;
  leadsToday: number;
  avgReplyMs: number | null;
  waiting: number;
}

/** Today's agent activity for the overview (RLS client: the person only sees their organization). */
export async function loadAiPulse(supabase: SupabaseClient, orgId: string, tz?: string): Promise<AiPulse> {
  const zone = tz ?? ((await supabase.from("organizations").select("timezone").eq("id", orgId).maybeSingle()).data as { timezone?: string } | null)?.timezone ?? "Asia/Jerusalem";
  const since = startOfTodayIso(zone);
  const [agentRes, repliesRes, timingRes, leadsRes, waitingRes] = await Promise.all([
    supabase.from("ai_agents").select("name, enabled, autopilot_channels").eq("organization_id", orgId).order("created_at"),
    supabase.from("messages").select("id", { count: "exact", head: true }).eq("organization_id", orgId).eq("direction", "out").not("ai_agent_id", "is", null).gte("created_at", since),
    supabase.from("messages").select("meta").eq("organization_id", orgId).eq("direction", "out").not("ai_agent_id", "is", null).gte("created_at", since).order("created_at", { ascending: false }).limit(200),
    supabase.from("contacts").select("id", { count: "exact", head: true }).eq("organization_id", orgId).gte("created_at", since),
    supabase.from("conversations").select("id", { count: "exact", head: true }).eq("organization_id", orgId).eq("status", "open").eq("ai_mode", "human").not("handoff_at", "is", null),
  ]);
  const agents = (agentRes.data ?? []) as { name: string; enabled: boolean; autopilot_channels: string[] | null }[];
  const live = agents.find((a) => a.enabled && (a.autopilot_channels ?? []).length > 0) ?? null;
  return {
    agentName: live?.name ?? agents[0]?.name ?? null,
    agentOn: Boolean(live),
    repliesToday: repliesRes.count ?? 0,
    leadsToday: leadsRes.count ?? 0,
    avgReplyMs: averageReplyMs(((timingRes.data ?? []) as { meta: unknown }[]).map((r) => r.meta)),
    waiting: waitingRes.count ?? 0,
  };
}
