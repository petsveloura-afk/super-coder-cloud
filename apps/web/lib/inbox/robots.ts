import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isRobotName, isServiceSender } from "./robots-core";

/**
 * E-mail conversations whose latest incoming message is an automatic e-mail (stored with meta.automated by the e-mail
 * ingest — bounces, "noreply", newsletters, service notifications) or whose sender name is clearly a robot.
 * Read-only: used to keep these out of the "waiting for an answer" counter.
 */
export async function robotConversationIds(supabase: SupabaseClient, orgId: string, rows: { id: string; title?: string | null; last_customer_at?: string | null; last_message_preview?: string | null }[]): Promise<string[]> {
  const out = new Set<string>();
  for (const r of rows) if (isRobotName(r.title)) out.add(r.id);
  // service senders on every channel (exchanges, platforms, login codes …) — see robots-core.isServiceSender
  for (const r of rows as { id: string; title?: string | null; last_message_preview?: string | null }[]) if (isServiceSender(r.title, r.last_message_preview)) out.add(r.id);
  const ids = rows.filter((r) => !out.has(r.id)).map((r) => r.id).slice(0, 200);
  if (!ids.length) return [...out];
  const { data } = await supabase
    .from("messages")
    .select("conversation_id, created_at")
    .eq("organization_id", orgId)
    .in("conversation_id", ids)
    .eq("direction", "in")
    .eq("meta->>automated", "true")
    .order("created_at", { ascending: false })
    .limit(400);
  const last = new Map(rows.map((r) => [r.id, r.last_customer_at ? Date.parse(r.last_customer_at) : NaN]));
  for (const m of (data ?? []) as { conversation_id: string; created_at: string }[]) {
    const lc = last.get(m.conversation_id);
    // the automatic message IS the customer's latest message (a real reply later makes the conversation count again)
    if (lc !== undefined && Number.isFinite(lc) && Math.abs(Date.parse(m.created_at) - lc) < 5_000) out.add(m.conversation_id);
  }
  return [...out];
}
