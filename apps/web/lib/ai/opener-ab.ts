import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { OpenerStats } from "./opener-ab-core";

/**
 * Wave 59 — A/B opening line: how many conversations started with each opener in the last 60 days and how
 * many of them became a lead. Null before the migration ran (the test simply does not start).
 */
export async function loadOpenerStats(orgId: string, client = createAdminClient()): Promise<OpenerStats | null> {
  const since = new Date(Date.now() - 60 * 86_400_000).toISOString();
  const count = async (variant: 0 | 1, leads: boolean) => {
    let q = client.from("conversations").select("id", { count: "exact", head: true }).eq("organization_id", orgId).eq("opener_variant", variant).gte("created_at", since);
    if (leads) q = q.not("lead_at", "is", null);
    const { count: n, error } = await q;
    if (error) throw error;
    return n ?? 0;
  };
  try {
    const [n0, n1, l0, l1] = await Promise.all([count(0, false), count(1, false), count(0, true), count(1, true)]);
    return { n: [n0, n1], leads: [l0, l1] };
  } catch {
    return null;
  }
}

/** Remembers which opener this conversation got (best-effort). */
export async function markOpener(conversationId: string, variant: 0 | 1): Promise<void> {
  await createAdminClient()
    .from("conversations")
    .update({ opener_variant: variant })
    .eq("id", conversationId)
    .is("opener_variant", null)
    .then(
      () => undefined,
      () => undefined,
    );
}
