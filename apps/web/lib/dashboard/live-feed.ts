import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Wave 59 — "what the agent is doing right now": the latest real events of the business (AI replies,
 * new leads, phone calls, payments in the chat), newest first. RLS client (the member sees only what the
 * inbox permission allows). Missing tables (before the migration) are simply skipped.
 */
export interface FeedItem {
  id: string;
  kind: "reply" | "lead" | "call" | "paid";
  title: string;
  detail: string;
  at: string;
  href: string;
}

export async function loadLiveFeed(supabase: SupabaseClient, orgId: string, max = 10): Promise<FeedItem[]> {
  const since = new Date(Date.now() - 3 * 86_400_000).toISOString();
  const [replies, leads, calls, paid] = await Promise.all([
    supabase.from("messages").select("id, conversation_id, body, created_at").eq("organization_id", orgId).eq("direction", "out").not("ai_agent_id", "is", null).gte("created_at", since).order("created_at", { ascending: false }).limit(max),
    supabase.from("conversations").select("id, title, channel, lead_score, lead_at").eq("organization_id", orgId).not("lead_at", "is", null).gte("lead_at", since).order("lead_at", { ascending: false }).limit(max),
    supabase.from("voice_calls").select("id, conversation_id, direction, from_number, to_number, duration_sec, created_at").eq("organization_id", orgId).neq("direction", "alert").gte("created_at", since).order("created_at", { ascending: false }).limit(max),
    supabase.from("chat_payments").select("id, conversation_id, amount, currency, description, paid_at").eq("organization_id", orgId).eq("status", "paid").gte("paid_at", since).order("paid_at", { ascending: false }).limit(max),
  ]);
  const items: FeedItem[] = [];
  for (const r of (replies.data ?? []) as { id: string; conversation_id: string; body: string; created_at: string }[])
    items.push({ id: `r${r.id}`, kind: "reply", title: "", detail: (r.body ?? "").replace(/\s+/g, " ").slice(0, 110), at: r.created_at, href: `/inbox?c=${r.conversation_id}` });
  for (const c of (leads.data ?? []) as { id: string; title: string | null; channel: string; lead_score: string | null; lead_at: string }[])
    items.push({ id: `l${c.id}`, kind: "lead", title: (c.title ?? "").slice(0, 60), detail: `${c.lead_score ?? ""}${c.lead_score ? " · " : ""}${c.channel}`, at: c.lead_at, href: `/inbox?c=${c.id}` });
  for (const v of (calls.error ? [] : (calls.data ?? [])) as { id: string; conversation_id: string | null; direction: string; from_number: string | null; to_number: string | null; duration_sec: number | null; created_at: string }[])
    items.push({ id: `c${v.id}`, kind: "call", title: String((v.direction === "in" ? v.from_number : v.to_number) ?? ""), detail: v.duration_sec ? `${Math.floor(v.duration_sec / 60)}:${String(v.duration_sec % 60).padStart(2, "0")}` : "", at: v.created_at, href: v.conversation_id ? `/inbox?c=${v.conversation_id}` : "/phone" });
  for (const p of (paid.error ? [] : (paid.data ?? [])) as { id: string; conversation_id: string | null; amount: number; currency: string; description: string; paid_at: string }[])
    items.push({ id: `p${p.id}`, kind: "paid", title: `${Number(p.amount).toLocaleString("he-IL")} ${p.currency}`, detail: p.description.slice(0, 80), at: p.paid_at, href: p.conversation_id ? `/inbox?c=${p.conversation_id}` : "/finance" });
  return items.sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, max);
}
