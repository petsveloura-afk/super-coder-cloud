import { createAdminClient } from "@/lib/supabase/admin";
import { summarizeDay, type DayHealth, type DayProviderRow } from "./day-health-core";

/** wave 68 — the data of the "today's health" card; null on any error (the card is then simply not shown) */
export async function loadDayHealth(orgId: string, now = Date.now()): Promise<DayHealth | null> {
  try {
    const since = new Date(now - 24 * 3_600_000).toISOString();
    const { data } = await createAdminClient().from("team_tasks").select("status, error, finished_at").eq("organization_id", orgId).in("status", ["done", "failed"]).gte("finished_at", since).limit(2000);
    const { reasonCode } = await import("./tool-failure-core");
    let providers: DayProviderRow[] = [];
    try {
      providers = (await import("@/lib/ai/provider-health")).healthRows(now);
    } catch {
      /* the provider part is optional */
    }
    return summarizeDay((data ?? []) as { status: string; error: string | null; finished_at: string | null }[], now, reasonCode, providers);
  } catch {
    return null;
  }
}
