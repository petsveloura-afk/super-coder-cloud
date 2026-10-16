import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { publicEnv } from "@/lib/env";
import { sendToConversation } from "@/lib/channels/send-message";
import { runAISystem } from "./run-system";
import {
  autopilotInstructions,
  buildHistory,
  extractContactInfo,
  formatForChannel,
  handoffMessage,
  isAutopilotChannel,
  parseAutopilotReply,
  wantsHuman,
  welcomeMessage,
  type AutopilotChannel,
  type StoredMessage,
} from "./autopilot-core";

/**
 * AI autopilot — the business's AI agent answers customers automatically on
 * every connected channel (website chat, WhatsApp, Telegram, SMS, e-mail).
 *
 *   • only while the conversation is in "auto" mode — a human reply from the
 *     inbox or a handoff switches it to "human" (the team takes over);
 *   • one agent per channel (the first enabled agent that lists the channel);
 *   • debounced: several quick messages get one answer;
 *   • loop-safe: at most 30 automatic replies per conversation per hour;
 *   • metered: uses the workspace's AI credits (plan limits apply);
 *   • when the AI is unavailable (no credits, provider down) the conversation
 *     is handed to the team instead of leaving the customer unanswered.
 */

export interface AutopilotResult {
  replied: boolean;
  handoff: boolean;
  reason?: string;
  text?: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function autopilotLocale(lang: unknown): "he" | "ar" | "en" {
  return lang === "ar" || lang === "en" ? lang : "he";
}

export async function handleInboundWithAI(input: { conversationId: string; messageId?: string | null; debounceMs?: number }): Promise<AutopilotResult> {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return { replied: false, handoff: false, reason: "no_service_key" };
  const admin = createAdminClient();
  const { data: conv } = await admin
    .from("conversations")
    .select("id, organization_id, channel, title, contact_id, ai_mode, status")
    .eq("id", input.conversationId)
    .maybeSingle();
  if (!conv) return { replied: false, handoff: false, reason: "not_found" };
  if (conv.ai_mode !== "auto") return { replied: false, handoff: false, reason: "human_mode" };
  const channel = conv.channel as string;
  if (!isAutopilotChannel(channel)) return { replied: false, handoff: false, reason: "channel" };
  const orgId = conv.organization_id as string;

  const { data: agent } = await admin
    .from("ai_agents")
    .select("id, name, instructions, provider, model, temperature, language, handoff_rules, greeting")
    .eq("organization_id", orgId)
    .eq("enabled", true)
    .contains("autopilot_channels", [channel])
    .order("created_at")
    .limit(1)
    .maybeSingle();
  if (!agent) return { replied: false, handoff: false, reason: "no_agent" };

  // debounce: answer only the latest of several quick messages
  if (input.debounceMs && input.debounceMs > 0) {
    await sleep(input.debounceMs);
    const { data: latest } = await admin
      .from("messages")
      .select("id")
      .eq("conversation_id", conv.id)
      .eq("direction", "in")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (input.messageId && latest && latest.id !== input.messageId) return { replied: false, handoff: false, reason: "superseded" };
    const { data: again } = await admin.from("conversations").select("ai_mode").eq("id", conv.id).maybeSingle();
    if (again?.ai_mode !== "auto") return { replied: false, handoff: false, reason: "human_mode" };
  }

  // loop / abuse protection
  const { data: allowed } = await admin.rpc("public_rate_limit", { p_bucket: `autopilot:${conv.id}`, p_limit: 30, p_window_seconds: 3600 });
  if (allowed === false) return { replied: false, handoff: false, reason: "rate_limited" };

  const { data: rows } = await admin
    .from("messages")
    .select("direction, body, created_at")
    .eq("conversation_id", conv.id)
    .order("created_at", { ascending: false })
    .limit(30);
  const history = buildHistory(((rows ?? []) as StoredMessage[]).reverse());
  const lastIn = [...history].reverse().find((m) => m.role === "user")?.content ?? "";
  if (!lastIn) return { replied: false, handoff: false, reason: "empty" };
  const locale = autopilotLocale(agent.language);
  const ch = channel as AutopilotChannel;

  // Telegram "Start" button / a bare greeting command → the welcome message (no AI call needed)
  if (/^\/start\b/i.test(lastIn.trim())) {
    const { data: o } = await admin.from("organizations").select("name").eq("id", orgId).maybeSingle();
    const text = formatForChannel(((agent.greeting as string) ?? "").trim() || welcomeMessage(locale, (o?.name as string | undefined) ?? ""), ch);
    await sendToConversation(orgId, conv.id as string, text, undefined, { aiAgentId: agent.id as string });
    return { replied: true, handoff: false, text };
  }

  // the customer explicitly asks for a person → hand off right away (no AI call needed)
  if (wantsHuman(lastIn)) {
    const text = handoffMessage(locale);
    await sendToConversation(orgId, conv.id as string, text, undefined, { aiAgentId: agent.id as string });
    await admin.rpc("ai_handoff", { p_conv: conv.id, p_reason: "customer_asked" });
    return { replied: true, handoff: true, text };
  }

  // customer details — and fill in a phone / e-mail the customer just typed
  let customer: { name?: string | null; phone?: string | null; email?: string | null } = { name: (conv.title as string | null) ?? null };
  if (conv.contact_id) {
    const { data: c } = await admin.from("contacts").select("id, first_name, last_name, phone, email").eq("id", conv.contact_id).maybeSingle();
    if (c) {
      customer = { name: `${c.first_name ?? ""} ${c.last_name ?? ""}`.trim() || null, phone: (c.phone as string | null) ?? null, email: (c.email as string | null) ?? null };
      const info = extractContactInfo(lastIn);
      const patch: Record<string, string> = {};
      if (info.phone && !c.phone) patch.phone = info.phone;
      if (info.email && !c.email) patch.email = info.email;
      if (Object.keys(patch).length) {
        const { error } = await admin.from("contacts").update(patch).eq("id", c.id);
        if (!error) customer = { ...customer, ...patch };
      }
    }
  }

  const [{ data: org }, { data: booking }, { data: form }, { data: site }] = await Promise.all([
    admin.from("organizations").select("name").eq("id", orgId).maybeSingle(),
    admin.from("appointment_types").select("slug").eq("organization_id", orgId).eq("status", "active").order("created_at").limit(1).maybeSingle(),
    admin.from("forms").select("slug").eq("organization_id", orgId).eq("status", "active").order("created_at").limit(1).maybeSingle(),
    admin.from("sites").select("slug").eq("organization_id", orgId).eq("status", "published").order("created_at").limit(1).maybeSingle(),
  ]);
  const base = publicEnv.appUrl.replace(/\/$/, "");
  const system = autopilotInstructions({
    agentName: (agent.name as string) || "Assistant",
    orgName: (org?.name as string | undefined) ?? "",
    businessInstructions: ((agent.instructions as string) ?? "").slice(0, 8000),
    handoffRules: ((agent.handoff_rules as string) ?? "").slice(0, 2000),
    channel: ch,
    customer,
    links: {
      booking: booking?.slug ? `${base}/${locale}/book/${booking.slug}` : null,
      form: form?.slug ? `${base}/${locale}/f/${form.slug}` : null,
      website: site?.slug ? `${base}/${locale}/s/${site.slug}` : null,
    },
  });

  const out = await runAISystem({
    orgId,
    feature: "autopilot",
    agentId: agent.id as string,
    provider: agent.provider as "openai" | "anthropic" | "gemini",
    model: agent.model as string,
    system,
    messages: history,
    temperature: Number(agent.temperature ?? 0.4),
    maxTokens: ch === "email" ? 1200 : 600,
  });
  if (!out.ok) {
    // never leave the customer hanging silently: the team takes over
    await admin.rpc("ai_handoff", { p_conv: conv.id, p_reason: out.error });
    return { replied: false, handoff: true, reason: out.error };
  }
  const reply = parseAutopilotReply(out.text);
  const text = formatForChannel(reply.text || handoffMessage(locale), ch);
  await sendToConversation(orgId, conv.id as string, text, undefined, { aiAgentId: agent.id as string });
  if (reply.handoff) await admin.rpc("ai_handoff", { p_conv: conv.id, p_reason: reply.reason ?? "agent" });
  return { replied: true, handoff: reply.handoff, text };
}

/** Fire-and-forget after the webhook response was sent (Vercel keeps the function alive). */
export async function scheduleAutopilot(input: { conversationId: string; messageId?: string | null; debounceMs?: number }) {
  try {
    const { after } = await import("next/server");
    after(async () => {
      try {
        await handleInboundWithAI(input);
      } catch (e) {
        console.error("autopilot failed", (e as Error).message);
      }
    });
  } catch {
    // outside a request scope (tests / scripts): run inline
    await handleInboundWithAI(input).catch((e) => console.error("autopilot failed", (e as Error).message));
  }
}
