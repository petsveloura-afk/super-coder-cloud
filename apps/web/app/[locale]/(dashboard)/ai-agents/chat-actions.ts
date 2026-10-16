"use server";

import { z } from "zod";
import { uuidSchema } from "@scc/shared/validators";
import { getOrgContext } from "@/lib/auth";
import { isLocale, type Locale } from "@/lib/i18n/config";
import { createClient } from "@/lib/supabase/server";
import { contactSearchFilter } from "@/lib/search";
import { baseSystem, dataBlock, neutralise } from "@/lib/ai/prompt";
import { runAI } from "@/lib/ai/run";
import { parseAgentReply, siteToolInstructions } from "@/lib/ai/agent-markers";
import { aiSiteCaps, buildSiteWithAI, type BuiltSite } from "@/lib/ai/site-builder";
import type { AIMessage } from "@/lib/ai/providers";

/**
 * AI studio v2 — persistent conversations with tools.
 *  • messages are stored (ai_conversations / ai_messages, RLS by ai.use) → survive refresh
 *  • long context: the last 30 messages are sent to the model
 *  • tools: CRM lookup (existing) + website builder (landing page on every plan, full site + AI image on paid plans)
 * The previous agentChatAction stays available unchanged.
 */
export interface ChatMessage {
  id?: number;
  role: "user" | "assistant";
  content: string;
  meta?: { site?: BuiltSite; siteError?: string };
  created_at?: string;
}

export interface ConversationSummary {
  id: string;
  agent_id: string | null;
  title: string;
  updated_at: string;
}

type Result<T> = { ok: true; data: T } | { ok: false; error: string };
const loc = (l: unknown): Locale => (isLocale(l) ? l : "he");

export async function listConversationsAction(input: { locale: string; agentId: string }): Promise<Result<ConversationSummary[]>> {
  const ctx = await getOrgContext(loc(input.locale));
  if (!ctx.can("ai.use")) return { ok: false, error: "errors.forbidden" };
  const agentId = uuidSchema.safeParse(input.agentId);
  if (!agentId.success) return { ok: false, error: "validation.invalidId" };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("ai_conversations")
    .select("id, agent_id, title, updated_at")
    .eq("organization_id", ctx.org.id)
    .eq("agent_id", agentId.data)
    .order("updated_at", { ascending: false })
    .limit(40);
  if (error) return { ok: false, error: "errors.generic" };
  return { ok: true, data: (data ?? []) as ConversationSummary[] };
}

export async function loadConversationAction(input: { locale: string; conversationId: string }): Promise<Result<ChatMessage[]>> {
  const ctx = await getOrgContext(loc(input.locale));
  if (!ctx.can("ai.use")) return { ok: false, error: "errors.forbidden" };
  const id = uuidSchema.safeParse(input.conversationId);
  if (!id.success) return { ok: false, error: "validation.invalidId" };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("ai_messages")
    .select("id, role, content, meta, created_at")
    .eq("organization_id", ctx.org.id)
    .eq("conversation_id", id.data)
    .order("id", { ascending: true })
    .limit(400);
  if (error) return { ok: false, error: "errors.generic" };
  return { ok: true, data: (data ?? []) as ChatMessage[] };
}

export async function deleteConversationAction(input: { locale: string; conversationId: string }): Promise<Result<null>> {
  const ctx = await getOrgContext(loc(input.locale));
  const id = uuidSchema.safeParse(input.conversationId);
  if (!id.success) return { ok: false, error: "validation.invalidId" };
  const supabase = await createClient();
  const { error } = await supabase.from("ai_conversations").delete().eq("id", id.data).eq("organization_id", ctx.org.id);
  if (error) return { ok: false, error: "errors.generic" };
  return { ok: true, data: null };
}

const sendSchema = z.object({
  agentId: uuidSchema,
  conversationId: uuidSchema.optional().nullable(),
  message: z.string().trim().min(1).max(4000),
});

export async function sendAgentMessageAction(input: {
  locale: string;
  agentId: string;
  conversationId?: string | null;
  message: string;
}): Promise<Result<{ conversationId: string; user: ChatMessage; assistant: ChatMessage }>> {
  const locale = loc(input.locale);
  const ctx = await getOrgContext(locale);
  if (!ctx.can("ai.use")) return { ok: false, error: "errors.forbidden" };
  const parsed = sendSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "validation.required" };
  const { agentId, message } = parsed.data;
  const supabase = await createClient();

  const { data: agent } = await supabase
    .from("ai_agents")
    .select("id, name, instructions, provider, model, temperature, language, enabled, allowed_tools")
    .eq("id", agentId)
    .eq("organization_id", ctx.org.id)
    .maybeSingle();
  if (!agent) return { ok: false, error: "errors.notFound" };
  if (!agent.enabled) return { ok: false, error: "ai.agentDisabled" };
  const tools = (agent.allowed_tools as string[]) ?? [];

  // existing conversation (must belong to this org + agent) or a new one created on first success
  let conversationId = parsed.data.conversationId ?? null;
  let history: AIMessage[] = [];
  if (conversationId) {
    const { data: conv } = await supabase.from("ai_conversations").select("id").eq("id", conversationId).eq("organization_id", ctx.org.id).eq("agent_id", agentId).maybeSingle();
    if (!conv) conversationId = null;
    else {
      const { data: past } = await supabase
        .from("ai_messages")
        .select("role, content")
        .eq("conversation_id", conversationId)
        .eq("organization_id", ctx.org.id)
        .order("id", { ascending: false })
        .limit(30);
      history = ((past ?? []) as AIMessage[]).reverse().map((m) => ({ role: m.role, content: m.content.slice(0, 4000) }));
    }
  }

  // Tool: CRM lookup — RLS-scoped search of this organization's contacts only.
  let context = "";
  if (tools.includes("crm_lookup")) {
    const filter = contactSearchFilter(message);
    if (filter) {
      const { data: hits } = await supabase
        .from("contacts")
        .select("first_name, last_name, company_name, status, source, created_at")
        .eq("organization_id", ctx.org.id)
        .or(filter)
        .limit(5);
      if (hits?.length) {
        context = "\n\nRelevant CRM records:\n" + hits.map((h) => dataBlock({ name: `${h.first_name} ${h.last_name ?? ""}`, company: h.company_name, status: h.status, source: h.source, created_at: h.created_at })).join("\n");
      }
    }
  }

  const canBuild = tools.includes("site_builder") && ctx.can("websites.manage");
  const caps = canBuild ? await aiSiteCaps(ctx.org.id) : { full: false, images: false, plan: "free" };
  const agentLocale = (isLocale(agent.language) ? agent.language : locale) as Locale;
  const system = baseSystem(
    agentLocale,
    [
      `You are "${neutralise(agent.name, 80)}", an AI agent configured by the business. Business instructions:\n${neutralise(agent.instructions as string, 8000)}`,
      "Hold a natural, complete conversation: remember everything said earlier in this chat, ask focused follow-up questions, and give thorough, well-structured answers (short paragraphs, bullet lists where useful).",
      siteToolInstructions({ canBuild, full: caps.full, images: caps.images }),
    ]
      .filter(Boolean)
      .join("\n\n"),
  );
  const out = await runAI({
    orgId: ctx.org.id,
    feature: "agent_chat",
    agentId: agent.id as string,
    provider: agent.provider as "openai" | "anthropic" | "gemini",
    model: agent.model as string,
    system,
    messages: [...history, { role: "user", content: message + context }],
    temperature: Number(agent.temperature),
    maxTokens: 1500,
  });
  if (!out.ok) return { ok: false, error: out.error };

  const reply = parseAgentReply(out.text);
  const meta: ChatMessage["meta"] = {};
  if (reply.buildSite && canBuild) {
    const built = await buildSiteWithAI({
      orgId: ctx.org.id,
      userId: ctx.userId,
      locale: agentLocale,
      brief: [...history.filter((m) => m.role === "user").map((m) => m.content), message].join("\n").slice(-3000),
      wantFull: reply.buildSite === "full",
      conversation: [...history, { role: "user", content: message }, { role: "assistant", content: reply.text }],
      provider: agent.provider as "openai" | "anthropic" | "gemini",
      agentId: agent.id as string,
    });
    if (built.ok) meta.site = built.site;
    else meta.siteError = built.error;
  }
  const answer = reply.text || (meta.site ? "✓" : "…");

  if (!conversationId) {
    const { data: conv, error } = await supabase
      .from("ai_conversations")
      .insert({ organization_id: ctx.org.id, agent_id: agentId, created_by: ctx.userId, channel: "studio" })
      .select("id")
      .single();
    if (error || !conv) return { ok: false, error: "errors.generic" };
    conversationId = conv.id as string;
  }
  const { data: saved, error: saveError } = await supabase
    .from("ai_messages")
    .insert([
      { organization_id: ctx.org.id, conversation_id: conversationId, role: "user", content: message, meta: {} },
      { organization_id: ctx.org.id, conversation_id: conversationId, role: "assistant", content: answer, meta },
    ])
    .select("id, role, content, meta, created_at")
    .order("id", { ascending: true });
  if (saveError || !saved || saved.length < 2) return { ok: false, error: "errors.generic" };
  return { ok: true, data: { conversationId, user: saved[0] as ChatMessage, assistant: saved[1] as ChatMessage } };
}
