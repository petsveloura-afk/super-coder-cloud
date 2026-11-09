import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { agentCoversChannel, pickAgentForChannel, withChannel, type AgentChannelRow } from "./agent-channel-core";

/**
 * Makes sure the business's AI agent answers on `channel` (e.g. right after the owner linked WhatsApp by QR code
 * or phone code). Additive only: it never removes a channel and never creates or enables an agent.
 * Returns true when an agent now serves the channel. Never throws.
 */
export async function ensureAgentOnChannel(orgId: string, channel: string): Promise<boolean> {
  try {
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return false;
    const admin = createAdminClient();
    const { data } = await admin.from("ai_agents").select("id, enabled, autopilot_channels").eq("organization_id", orgId).eq("enabled", true).order("created_at").limit(20);
    const agents = (data ?? []) as AgentChannelRow[];
    if (agentCoversChannel(agents, channel)) return true;
    const pick = pickAgentForChannel(agents, channel);
    if (!pick) return false;
    const { error } = await admin.from("ai_agents").update({ autopilot_channels: withChannel(pick.autopilot_channels, channel) }).eq("id", pick.id);
    if (error) {
      console.error("ensureAgentOnChannel failed", error.message);
      return false;
    }
    return true;
  } catch (e) {
    console.error("ensureAgentOnChannel failed", (e as Error).message);
    return false;
  }
}
