import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendToConversation } from "@/lib/channels/send-message";
import { apptWhen } from "@/lib/appointments/reminder-core";
import { matchOption, wallTimeToUtc } from "@/lib/operator/operator-core";
import { formatForChannel, type AutopilotChannel } from "./autopilot-core";
import { bookingText, leadMemories, type AgentAction, type MemoryRow } from "./agent-actions-core";

/**
 * Wave 54 — executes what the customer-facing agent decided to do (service role, after the reply was sent).
 * Every step is best-effort and isolated: a failing action never breaks the conversation.
 */
const MAX_MEMORIES = 80;

type Loc = "he" | "en" | "ar";
const asLoc = (l: string): Loc => (l === "en" || l === "ar" ? l : "he");

/** Memories for the prompt (newest first). Empty before the migration ran. */
export async function loadMemories(orgId: string, contactId: string | null | undefined): Promise<MemoryRow[]> {
  if (!contactId) return [];
  const { data, error } = await createAdminClient().from("contact_memories").select("fact, kind, created_at").eq("organization_id", orgId).eq("contact_id", contactId).order("created_at", { ascending: false }).limit(25);
  return error ? [] : ((data ?? []) as MemoryRow[]);
}

/** Does the business have a bookable meeting type (so the agent may use BOOK)? */
export async function canBook(orgId: string): Promise<boolean> {
  const { count, error } = await createAdminClient().from("appointment_types").select("id", { count: "exact", head: true }).eq("organization_id", orgId).eq("status", "active");
  return !error && (count ?? 0) > 0;
}

async function remember(orgId: string, contactId: string, conversationId: string, items: { fact: string; kind: string; source: "agent" | "lead" }[]): Promise<number> {
  if (!items.length) return 0;
  const admin = createAdminClient();
  const { count } = await admin.from("contact_memories").select("id", { count: "exact", head: true }).eq("organization_id", orgId).eq("contact_id", contactId);
  if ((count ?? 0) >= MAX_MEMORIES) return 0;
  let saved = 0;
  for (const it of items) {
    const { error } = await admin.from("contact_memories").insert({ organization_id: orgId, contact_id: contactId, fact: it.fact, kind: it.kind, source: it.source, conversation_id: conversationId });
    if (!error) saved++;
  }
  return saved;
}

async function teamAssignee(orgId: string, conversationId: string): Promise<string | null> {
  const admin = createAdminClient();
  const { data: conv } = await admin.from("conversations").select("assignee_id").eq("id", conversationId).maybeSingle();
  if (conv?.assignee_id) return conv.assignee_id as string;
  const { data: owner } = await admin.from("organization_members").select("user_id").eq("organization_id", orgId).in("role", ["agency_owner", "owner", "admin"]).order("created_at").limit(1).maybeSingle();
  return (owner?.user_id as string | undefined) ?? null;
}

async function addTag(orgId: string, contactId: string, tag: string): Promise<boolean> {
  const admin = createAdminClient();
  await admin.from("tags").upsert({ organization_id: orgId, name: tag }, { onConflict: "organization_id,name", ignoreDuplicates: true });
  const { data: t } = await admin.from("tags").select("id").eq("organization_id", orgId).eq("name", tag).maybeSingle();
  if (!t) return false;
  const { error } = await admin.from("contact_tags").insert({ organization_id: orgId, contact_id: contactId, tag_id: t.id });
  return !error || error.code === "23505";
}

export interface AgentActionInput {
  orgId: string;
  conversationId: string;
  contactId: string | null;
  channel: AutopilotChannel;
  agentId: string;
  locale: string;
  actions: AgentAction[];
  lead?: { need?: string; budget?: string; name?: string; phone?: string; email?: string } | null;
  customer: { name?: string | null; phone?: string | null; email?: string | null };
}

export async function executeAgentActions(input: AgentActionInput): Promise<{ done: string[] }> {
  const done: string[] = [];
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return { done };
  const admin = createAdminClient();
  const locale = asLoc(input.locale);
  const say = async (text: string) => {
    await sendToConversation(input.orgId, input.conversationId, formatForChannel(text, input.channel), undefined, { aiAgentId: input.agentId, meta: { system: "agent_action" } }).catch(() => undefined);
  };

  // 1) memory: what the agent decided to remember + need / budget from the lead
  if (input.contactId) {
    try {
      const items = [
        ...input.actions.filter((a): a is Extract<AgentAction, { kind: "remember" }> => a.kind === "remember").map((a) => ({ fact: a.fact, kind: "fact", source: "agent" as const })),
        ...leadMemories(input.lead).map((m) => ({ fact: m.fact, kind: m.kind, source: "lead" as const })),
      ];
      const n = await remember(input.orgId, input.contactId, input.conversationId, items);
      if (n) done.push(`remember:${n}`);
    } catch (e) {
      console.error("agent remember failed", (e as Error).message);
    }
  }

  for (const a of input.actions) {
    try {
      if (a.kind === "tag" && input.contactId) {
        if (await addTag(input.orgId, input.contactId, a.tag)) done.push(`tag:${a.tag}`);
      } else if (a.kind === "task") {
        const assignee = await teamAssignee(input.orgId, input.conversationId);
        const { error } = await admin.from("tasks").insert({
          organization_id: input.orgId,
          contact_id: input.contactId,
          title: `🤖 ${a.title}`.slice(0, 200),
          description: (locale === "en" ? `Created by the AI agent from a ${input.channel} conversation.` : locale === "ar" ? `أنشأها وكيل الذكاء الاصطناعي من محادثة ${input.channel}.` : `נוצרה ע"י סוכן ה-AI משיחה ב-${input.channel}.`).slice(0, 5000),
          due_at: new Date(Date.now() + Math.max(a.dueDays, 0) * 86_400_000 + (a.dueDays === 0 ? 2 * 3_600_000 : 0)).toISOString(),
          assignee_id: assignee,
        });
        if (!error) done.push("task");
      } else if (a.kind === "followup") {
        const { data: pendingAgent } = await admin.from("conversation_schedules").select("id").eq("conversation_id", input.conversationId).eq("status", "pending").eq("payload->>source", "agent").limit(1).maybeSingle();
        if (!pendingAgent) {
          const { error } = await admin.from("conversation_schedules").insert({
            organization_id: input.orgId,
            conversation_id: input.conversationId,
            contact_id: input.contactId,
            kind: "scheduled",
            body: a.text.slice(0, 4000),
            payload: { source: "agent" },
            run_at: new Date(Date.now() + a.delayMinutes * 60_000).toISOString(),
            cancel_on_reply: true,
          });
          if (!error) done.push("followup");
        }
      } else if (a.kind === "book") {
        const { data: types } = await admin.from("appointment_types").select("slug, name, timezone").eq("organization_id", input.orgId).eq("status", "active").order("created_at").limit(20);
        const list = ((types ?? []) as { slug: string; name: string; timezone: string | null }[]).map((x) => ({ ...x, label: x.name }));
        const type = (a.service ? matchOption(list, a.service).match : null) ?? list[0] ?? null;
        const tz = type?.timezone || "Asia/Jerusalem";
        const startIso = wallTimeToUtc(a.local, tz);
        const whenText = startIso ? apptWhen(startIso, locale, tz) : a.local.replace("T", " ");
        const name = (input.lead?.name || input.customer.name || "").trim();
        const phone = (input.lead?.phone || input.customer.phone || "").trim();
        const email = (input.lead?.email || input.customer.email || "").trim();
        if (!type || !startIso) {
          // no bookable type: the team confirms by hand
          const assignee = await teamAssignee(input.orgId, input.conversationId);
          await admin.from("tasks").insert({ organization_id: input.orgId, contact_id: input.contactId, title: `🤖 📅 ${whenText}${a.service ? ` — ${a.service}` : ""}`.slice(0, 200), due_at: new Date(Date.now() + 2 * 3_600_000).toISOString(), assignee_id: assignee });
          await say(bookingText(locale, "manual", { when: whenText, service: a.service ?? undefined }));
          done.push("book:manual");
          continue;
        }
        if (!name || (!phone && !email)) {
          await say(bookingText(locale, "details"));
          done.push("book:details");
          continue;
        }
        const { data: res, error } = await admin.rpc("book_appointment_v2", {
          p_slug: type.slug,
          p_start: startIso,
          p_name: name,
          p_email: email,
          p_phone: phone,
          p_notes: locale === "en" ? "Booked by the AI agent in the conversation" : "נקבע ע\"י סוכן ה-AI בשיחה",
          p_meta: { ip_hash: `agent:${input.conversationId}`, source: "agent" },
        });
        const r = (res ?? {}) as { ok?: boolean; error?: string };
        if (!error && r.ok) {
          await say(bookingText(locale, "ok", { when: whenText, service: type.name }));
          done.push("book:ok");
        } else {
          const code = error ? "" : String(r.error ?? "");
          await say(bookingText(locale, code === "booking.detailsRequired" ? "details" : code === "booking.outOfRange" || code === "booking.notAvailable" ? "range" : "taken", { when: whenText }));
          done.push(`book:${code || "error"}`);
        }
      } else if (a.kind === "pay") {
        // wave 59: a secure payment link in the business's own payment account (deposit / order)
        const { canPayOnline, createChatPaymentLink } = await import("@/lib/finance/pay-chat");
        if (await canPayOnline(input.orgId)) {
          const link = await createChatPaymentLink({ orgId: input.orgId, conversationId: input.conversationId, contactId: input.contactId, amount: a.amount, description: a.description, locale });
          if (link) {
            await say(link.text);
            done.push("pay:ok");
          } else done.push("pay:error");
        } else done.push("pay:offline");
      }
    } catch (e) {
      console.error("agent action failed", a.kind, (e as Error).message);
    }
  }
  return { done };
}
