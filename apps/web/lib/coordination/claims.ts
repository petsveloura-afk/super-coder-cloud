import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Lane } from "./core";

/**
 * Claims a customer (or deal) for a purpose before an agent acts. Fail-open by design: when the migration is not there yet or the
 * database is unreachable, the agent goes on exactly as before (the conversation guard still protects the customer).
 */
export async function claimEntity(input: { orgId: string; entityType: "contact" | "deal" | "invoice" | "conversation"; entityId: string; lane: Lane; owner: string; minutes: number; note?: string | null; force?: boolean }): Promise<{ granted: boolean; holder: string | null }> {
  if (!/^[0-9a-f-]{36}$/i.test(input.entityId)) return { granted: true, holder: null };
  try {
    const { data, error } = await createAdminClient().rpc("agent_claim", {
      p_org: input.orgId,
      p_entity_type: input.entityType,
      p_entity_id: input.entityId,
      p_lane: input.lane,
      p_owner: input.owner,
      p_minutes: input.minutes,
      p_note: input.note ?? null,
      p_force: Boolean(input.force),
    });
    if (error) return { granted: true, holder: null };
    const d = (data ?? {}) as { granted?: boolean; holder?: string };
    return { granted: d.granted !== false, holder: d.holder ?? null };
  } catch {
    return { granted: true, holder: null };
  }
}

/** live claims on one customer (for the employee's contact brief); [] when unavailable */
export async function claimsOn(orgId: string, entityType: "contact" | "deal", entityId: string): Promise<{ lane: string; owner: string; until: string }[]> {
  try {
    const { data, error } = await createAdminClient().from("agent_claims").select("lane, owner, until").eq("organization_id", orgId).eq("entity_type", entityType).eq("entity_id", entityId).gt("until", new Date().toISOString()).limit(5);
    return error ? [] : ((data ?? []) as { lane: string; owner: string; until: string }[]);
  } catch {
    return [];
  }
}

/** gives a fresh claim back when the agent did not act after all (best-effort) */
export async function releaseEntity(input: { orgId: string; entityType: "contact" | "deal" | "invoice" | "conversation"; entityId: string; lane: Lane; owner: string }): Promise<void> {
  if (!/^[0-9a-f-]{36}$/i.test(input.entityId)) return;
  try {
    await createAdminClient().rpc("agent_release", { p_org: input.orgId, p_entity_type: input.entityType, p_entity_id: input.entityId, p_lane: input.lane, p_owner: input.owner });
  } catch {
    /* the claim simply expires */
  }
}
