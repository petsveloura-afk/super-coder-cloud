import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { buildHistory, type StoredMessage } from "./autopilot-core";
import { buildHandoffSummary } from "./handoff-summary-core";
import type { Lang } from "./intelligence";

/**
 * Wave 63 — the ready summary for the person who takes a conversation over (from the real messages,
 * no AI call). Returns null on any problem — the handoff notification then looks exactly as before.
 */
export async function loadHandoffSummary(conversationId: string, lang: Lang = "he", reason?: string | null): Promise<string | null> {
  try {
    const { data } = await createAdminClient().from("messages").select("direction, body, created_at, meta").eq("conversation_id", conversationId).order("created_at", { ascending: false }).limit(30);
    const rows = ((data ?? []) as (StoredMessage & { meta?: { fallback?: boolean } | null })[]).reverse().filter((m) => !(m.direction === "out" && m.meta?.fallback));
    const history = buildHistory(rows);
    if (!history.some((m) => m.role === "user")) return null;
    return buildHandoffSummary({ history, lang, reason }).text;
  } catch {
    return null;
  }
}
