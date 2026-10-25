import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { waitingMinutes, type SlaInput } from "@/lib/inbox/sla";
import { STALE_DAYS } from "@/lib/deals/insights";
import { nextActions, type NextAction } from "@/lib/dashboard/next-actions-core";

/** Wave 24 — loads the counts behind "what to do now". Every query is RLS-protected; failures count as 0. */
export async function loadNextActions(
  supabase: SupabaseClient,
  orgId: string,
  can: { inbox: boolean; deals: boolean; integrations: boolean; ai: boolean },
  overdueTasks: number,
): Promise<NextAction[]> {
  const n = (r: { count: number | null }) => r.count ?? 0;
  const today = new Date().toISOString().slice(0, 10);
  const staleBefore = new Date(Date.now() - STALE_DAYS * 86_400_000).toISOString();
  const none = Promise.resolve({ count: 0, data: [] as SlaInput[] });
  const convs = () => supabase.from("conversations").select("id", { count: "exact", head: true }).eq("organization_id", orgId).eq("status", "open");
  const deals = () => supabase.from("deals").select("id", { count: "exact", head: true }).eq("organization_id", orgId).eq("status", "open");
  const [open, human, hot, stale, late, ch, ag] = await Promise.all([
    can.inbox ? supabase.from("conversations").select("status, last_customer_at, last_human_at, last_ai_at, last_auto_at").eq("organization_id", orgId).eq("status", "open").not("last_customer_at", "is", null).order("last_customer_at", { ascending: false }).limit(500) : none,
    can.inbox ? convs().eq("ai_mode", "human") : none,
    can.inbox ? convs().eq("lead_score", "hot") : none,
    can.deals ? deals().lt("updated_at", staleBefore) : none,
    can.deals ? deals().lt("expected_close_date", today) : none,
    can.integrations ? supabase.from("channel_accounts").select("id", { count: "exact", head: true }).eq("organization_id", orgId) : Promise.resolve(null),
    can.ai ? supabase.from("ai_agents").select("id", { count: "exact", head: true }).eq("organization_id", orgId) : Promise.resolve(null),
  ]);
  const now = Date.now();
  const waiting = ((open.data ?? []) as SlaInput[]).filter((c) => waitingMinutes(c, now) !== null).length;
  return nextActions({
    waiting,
    needsHuman: n(human),
    hotLeads: n(hot),
    overdueTasks,
    staleDeals: n(stale),
    overdueDeals: n(late),
    channels: ch && !ch.error ? n(ch) : null,
    agents: ag && !ag.error ? n(ag) : null,
  });
}
