import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { insightMemories } from "./customer-insight-core";
import type { HistoryMsg } from "./brain-pro";

const MAX_MEMORIES = 80; // same cap as agent-actions.ts

/**
 * Wave 63 — saves what the conversation showed (objections, preferences, interests) as customer memory.
 * Best effort: silent on any error (before the memory table exists, over the cap, a duplicate).
 */
export async function rememberFromConversation(input: { orgId: string; contactId: string | null | undefined; conversationId: string; history: HistoryMsg[] }): Promise<number> {
  try {
    if (!input.contactId) return 0;
    const items = insightMemories(input.history);
    if (!items.length) return 0;
    const admin = createAdminClient();
    const { count, error: cErr } = await admin.from("contact_memories").select("id", { count: "exact", head: true }).eq("organization_id", input.orgId).eq("contact_id", input.contactId);
    if (cErr || (count ?? 0) >= MAX_MEMORIES - 5) return 0; // leaves room for the facts the agent saves itself
    let saved = 0;
    for (const it of items) {
      // the unique index (org, contact, lower(fact)) makes a repeat a harmless no-op
      const { error } = await admin.from("contact_memories").insert({ organization_id: input.orgId, contact_id: input.contactId, fact: it.fact, kind: it.kind, source: "agent", conversation_id: input.conversationId });
      if (!error) saved++;
    }
    return saved;
  } catch {
    return 0;
  }
}
