import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { dataBlock, neutralise } from "@/lib/ai/prompt";

/**
 * Wave 15 — everything the CRM knows about one customer, across every channel and
 * module, as a <crm_data> block for the AI (insights, co-pilot, segmentation).
 * Works with the signed-in client (RLS decides what is visible) or the admin client.
 */
export async function contactContext(db: SupabaseClient, orgId: string, contactId: string, opts?: { messages?: number }): Promise<{ block: string; name: string; channels: string[] } | null> {
  const { data: c } = await db
    .from("contacts")
    .select("first_name, last_name, email, phone, company_name, job_title, status, source, marketing_consent, created_at, custom_fields")
    .eq("id", contactId)
    .eq("organization_id", orgId)
    .maybeSingle();
  if (!c) return null;
  const [convRes, notesRes, dealsRes, docsRes, apptRes, tagRes] = await Promise.all([
    db.from("conversations").select("id, channel, lead_score, summary, last_message_at").eq("organization_id", orgId).eq("contact_id", contactId).order("last_message_at", { ascending: false, nullsFirst: false }).limit(10),
    db.from("notes").select("body, created_at").eq("organization_id", orgId).eq("contact_id", contactId).order("created_at", { ascending: false }).limit(8),
    db.from("deals").select("title, value, currency, status, created_at").eq("organization_id", orgId).eq("contact_id", contactId).order("created_at", { ascending: false }).limit(8),
    db.from("documents").select("kind, number, status, total, currency, viewed_at, created_at").eq("organization_id", orgId).eq("contact_id", contactId).order("created_at", { ascending: false }).limit(8),
    db.from("appointments").select("title, starts_at, status").eq("organization_id", orgId).eq("contact_id", contactId).order("starts_at", { ascending: false }).limit(5),
    db.from("contact_tags").select("tags(name)").eq("organization_id", orgId).eq("contact_id", contactId).limit(30),
  ]);
  const convs = (convRes.data ?? []) as { id: string; channel: string; lead_score: string | null; summary: string | null }[];
  let transcript = "";
  if (convs.length) {
    const { data: msgs } = await db
      .from("messages")
      .select("conversation_id, direction, body, created_at, ai_agent_id")
      .eq("organization_id", orgId)
      .in("conversation_id", convs.map((x) => x.id))
      .order("created_at", { ascending: false })
      .limit(opts?.messages ?? 40);
    const byConv = new Map(convs.map((x) => [x.id, x.channel]));
    transcript = ((msgs ?? []) as { conversation_id: string; direction: string; body: string; created_at: string; ai_agent_id: string | null }[])
      .reverse()
      .map((m) => `[${m.created_at.slice(0, 16).replace("T", " ")}] (${byConv.get(m.conversation_id)}) ${m.direction === "in" ? "customer" : m.ai_agent_id ? "agent(AI)" : "business"}: ${m.body.replace(/\s+/g, " ").slice(0, 400)}`)
      .join("\n");
  }
  const name = `${c.first_name} ${c.last_name ?? ""}`.trim();
  const tags = ((tagRes.data ?? []) as unknown as { tags: { name: string } | null }[]).map((r) => r.tags?.name).filter(Boolean).join(", ");
  const block = dataBlock({
    name,
    status: c.status as string,
    source: c.source as string,
    company: c.company_name as string | null,
    job_title: c.job_title as string | null,
    has_phone: c.phone ? "yes" : "no",
    has_email: c.email ? "yes" : "no",
    marketing_consent: c.marketing_consent ? "yes" : "no",
    customer_since: String(c.created_at).slice(0, 10),
    tags,
    channels: [...new Set(convs.map((x) => x.channel))].join(", "),
    ai_lead_scores: convs.map((x) => x.lead_score).filter(Boolean).join(", "),
    conversation_summaries: convs.map((x) => x.summary).filter(Boolean).join(" | "),
    deals: ((dealsRes.data ?? []) as { title: string; value: number; currency: string; status: string }[]).map((d) => `${d.title} — ${d.value} ${d.currency} (${d.status})`).join("; "),
    documents: ((docsRes.data ?? []) as { kind: string; number: number; status: string; total: number; currency: string; viewed_at: string | null }[])
      .map((d) => `${d.kind} #${d.number} ${d.total} ${d.currency} ${d.status}${d.viewed_at ? " (viewed)" : ""}`)
      .join("; "),
    appointments: ((apptRes.data ?? []) as { title: string; starts_at: string; status: string }[]).map((a) => `${a.title} ${a.starts_at.slice(0, 16)} (${a.status})`).join("; "),
    notes: ((notesRes.data ?? []) as { body: string; created_at: string }[]).map((n) => `- (${n.created_at.slice(0, 10)}) ${n.body.slice(0, 300)}`).join("\n"),
  }) + (transcript ? `\n<crm_data>\nconversation (oldest first):\n${neutralise(transcript.slice(-9000), 9000)}\n</crm_data>` : "");
  return { block, name, channels: [...new Set(convs.map((x) => x.channel))] };
}
