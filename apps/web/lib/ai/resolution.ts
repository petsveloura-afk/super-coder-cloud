import { createClient } from "@/lib/supabase/server";
import { FEEDBACK_ACTION, summarizeFeedback, type FeedbackLogRow, type FeedbackSummary } from "./reply-feedback-core";
import { resolutionStats, type ResConv, type ResMsg, type ResolutionStats } from "./resolution-core";

/** Wave 69 — loaders for the quality card. Read-only; any failure returns null (the card is simply absent). */
const DAY = 86_400_000;

export async function loadResolution(orgId: string, days: number, now = Date.now()): Promise<ResolutionStats | null> {
  try {
    const since = new Date(now - Math.max(1, days) * DAY).toISOString();
    const supabase = await createClient();
    const { data: cs, error } = await supabase.from("conversations").select("id, status, ai_mode, handoff_at").eq("organization_id", orgId).gte("last_message_at", since).order("last_message_at", { ascending: false }).limit(300);
    if (error || !cs) return null;
    const convs: ResConv[] = (cs as unknown as { id: string; status: string; ai_mode: string | null; handoff_at: string | null }[]).map((c) => ({ id: c.id, status: c.status, aiMode: c.ai_mode, handoffAt: c.handoff_at }));
    const msgs: ResMsg[] = [];
    for (let i = 0; i < convs.length; i += 60) {
      const ids = convs.slice(i, i + 60).map((c) => c.id);
      const { data: ms, error: e2 } = await supabase.from("messages").select("conversation_id, direction, body, ai_agent_id, created_at").eq("organization_id", orgId).in("conversation_id", ids).order("created_at").limit(3000);
      if (e2 || !ms) return null;
      for (const m of ms as unknown as { conversation_id: string; direction: string; body: string | null; ai_agent_id: string | null; created_at: string }[]) {
        msgs.push({ conversationId: m.conversation_id, direction: m.direction, body: m.body ?? "", aiAgentId: m.ai_agent_id, createdAt: m.created_at });
      }
    }
    return resolutionStats(convs, msgs);
  } catch {
    return null;
  }
}

export async function loadFeedback(orgId: string, days: number, now = Date.now()): Promise<FeedbackSummary | null> {
  try {
    const since = new Date(now - Math.max(1, days) * DAY).toISOString();
    const supabase = await createClient();
    const { data, error } = await supabase.from("audit_logs").select("entity_id, actor_id, created_at, metadata").eq("organization_id", orgId).eq("action", FEEDBACK_ACTION).gte("created_at", since).limit(2000);
    if (error || !data) return null;
    return summarizeFeedback(data as unknown as FeedbackLogRow[]);
  } catch {
    return null;
  }
}
