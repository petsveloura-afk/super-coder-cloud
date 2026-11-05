import { createAdminClient } from "@/lib/supabase/admin";
import { ownerLog, type LogRow, type OwnerLogEntry } from "./owner-control-core";

/** wave 70 — the owner's team log (last 7 days, owner language); null on any error (the card is then simply not shown) */
export async function loadOwnerLog(orgId: string, now = Date.now()): Promise<OwnerLogEntry[] | null> {
  try {
    const since = new Date(now - 7 * 86_400_000).toISOString();
    const { data, error } = await createAdminClient()
      .from("team_activity")
      .select("id, member_id, phase, summary, ok, created_at, why:details->>why, autonomy:details->>autonomy, member:details->>member")
      .eq("organization_id", orgId)
      .in("phase", ["execute", "deliver", "approval", "initiative", "system"])
      .gte("created_at", since)
      .order("id", { ascending: false })
      .limit(400);
    if (error) return null;
    return ownerLog((data ?? []) as unknown as LogRow[], 100);
  } catch {
    return null;
  }
}
