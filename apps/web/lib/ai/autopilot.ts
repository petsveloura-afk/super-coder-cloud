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
  parseAgentTools,
  salesAgentInstructions,
  fallbackMessage,
  wantsHuman,
  welcomeMessage,
  type AgentProfile,
  type AutopilotChannel,
  type LeadData,
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
  lead?: LeadCaptureResult | null;
}

export interface LeadCaptureResult {
  ok: boolean;
  contact_id?: string | null;
  deal_id?: string | null;
  first?: boolean;
  score?: string;
}

export function sharePhoneLabel(locale: string) {
  return locale === "en" ? "📱 Share my phone number" : locale === "ar" ? "📱 مشاركة رقم هاتفي" : "📱 שיתוף מספר הטלפון שלי";
}

/** "typing…" in the customer's app while the agent thinks (Telegram). */
async function typingIndicator(orgId: string, channel: AutopilotChannel, externalId: string) {
  if (channel !== "telegram") return;
  try {
    const { loadAccount } = await import("@/lib/channels/accounts");
    const { telegramCall } = await import("@/lib/channels/providers");
    const acc = await loadAccount(orgId, "telegram");
    if (acc?.secrets.bot_token) await telegramCall(acc.secrets.bot_token, "sendChatAction", { chat_id: externalId, action: "typing" });
  } catch {
    /* cosmetic only */
  }
}

/**
 * The agent's lead tool: saves / enriches the contact, scores it (tags), opens a
 * deal + follow-up task, writes a summary note and notifies the team (in-app,
 * and by e-mail to the owners when e-mail is configured).
 */
export async function captureLead(input: { orgId: string; conversationId: string; lead: LeadData; channel: AutopilotChannel; title: string | null }): Promise<LeadCaptureResult | null> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("ai_capture_lead", { p_conv: input.conversationId, p_data: input.lead });
  if (error) {
    console.error("lead capture failed", error.message);
    return null;
  }
  const r = data as LeadCaptureResult;
  if (r?.first || r?.score === "hot") await emailLeadToOwners(input.orgId, input.conversationId, input.lead, input.channel, input.title).catch(() => {});
  return r;
}

async function emailLeadToOwners(orgId: string, conversationId: string, lead: LeadData, channel: AutopilotChannel, title: string | null) {
  const { emailConfigured, sendEmail } = await import("@/lib/email/send");
  if (!emailConfigured()) return;
  const admin = createAdminClient();
  const { data: members } = await admin.from("organization_members").select("user_id, role").eq("organization_id", orgId).in("role", ["agency_owner", "owner", "admin"]).limit(5);
  const ids = ((members ?? []) as { user_id: string }[]).map((m) => m.user_id);
  if (!ids.length) return;
  const [{ data: profiles }, { data: org }] = await Promise.all([
    admin.from("profiles").select("email, locale").in("id", ids),
    admin.from("organizations").select("name").eq("id", orgId).maybeSingle(),
  ]);
  const { renderEmailHtml } = await import("@/lib/channels/email-core");
  const score = lead.score ?? "warm";
  const badge = score === "hot" ? "🔥" : score === "warm" ? "⭐" : "❄️";
  const link = `${publicEnv.appUrl.replace(/\/$/, "")}/he/inbox?c=${conversationId}`;
  const lines = [
    `${badge} ליד חדש מהסוכן (${channel})`,
    "",
    lead.name || title ? `שם: ${lead.name || title}` : "",
    lead.phone ? `טלפון: ${lead.phone}` : "",
    lead.email ? `מייל: ${lead.email}` : "",
    lead.need ? `מה צריך: ${lead.need}` : "",
    lead.budget ? `תקציב: ${lead.budget}` : "",
    lead.summary ? `\nסיכום: ${lead.summary}` : "",
    `\nלשיחה: ${link}`,
  ].filter((l) => l !== "");
  const text = lines.join("\n");
  for (const p of (profiles ?? []) as { email: string | null }[]) {
    if (!p.email) continue;
    await sendEmail({
      to: p.email,
      subject: `${badge} ליד חדש: ${lead.name || title || ""} ${lead.need ? `· ${lead.need}` : ""}`.trim().slice(0, 150),
      text,
      html: renderEmailHtml(text, { brand: (org?.name as string | undefined) ?? "Super Coder" }),
    });
  }
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
    .select("id, organization_id, channel, title, contact_id, ai_mode, status, external_id, lead_score")
    .eq("id", input.conversationId)
    .maybeSingle();
  if (!conv) return { replied: false, handoff: false, reason: "not_found" };
  if (conv.ai_mode !== "auto") return { replied: false, handoff: false, reason: "human_mode" };
  const channel = conv.channel as string;
  if (!isAutopilotChannel(channel)) return { replied: false, handoff: false, reason: "channel" };
  const orgId = conv.organization_id as string;

  const { data: agent } = await admin
    .from("ai_agents")
    .select("id, name, instructions, provider, model, temperature, language, handoff_rules, greeting, profile, lead_goal")
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
  const baseInstructions = autopilotInstructions({
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
  // wave 7 — business profile, goal, sales method and tools (lead capture, buttons, share-phone)
  const system = `${baseInstructions}\n\n${salesAgentInstructions({
    profile: (agent.profile as AgentProfile | null) ?? null,
    goal: (agent.lead_goal as string | null) ?? "lead",
    channel: ch,
    leadKnown: conv.lead_score ? { score: conv.lead_score as string } : null,
  })}`;
  await typingIndicator(orgId, ch, conv.external_id as string);

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
    // never leave the customer hanging: a polite answer, then the team takes over
    const sorry = formatForChannel(fallbackMessage(locale), ch);
    await sendToConversation(orgId, conv.id as string, sorry, undefined, { aiAgentId: agent.id as string });
    await admin.rpc("ai_handoff", { p_conv: conv.id, p_reason: out.error });
    return { replied: true, handoff: true, reason: out.error, text: sorry };
  }
  const tools = parseAgentTools(out.text);
  void parseAutopilotReply; // (wave 6 parser kept for compatibility; the tools parser is a superset)
  const text = formatForChannel(tools.text || handoffMessage(locale), ch);
  await sendToConversation(orgId, conv.id as string, text, undefined, {
    aiAgentId: agent.id as string,
    meta: tools.buttons.length || tools.askPhone ? { buttons: tools.buttons, ask_phone: tools.askPhone } : undefined,
    rich: { buttons: tools.buttons, askPhone: tools.askPhone, askPhoneLabel: sharePhoneLabel(locale), html: true },
  });
  await admin.from("conversations").update({ last_ai_at: new Date().toISOString() }).eq("id", conv.id);
  let lead: LeadCaptureResult | null = null;
  if (tools.lead) lead = await captureLead({ orgId, conversationId: conv.id as string, lead: tools.lead, channel: ch, title: (conv.title as string | null) ?? null });
  if (tools.handoff) await admin.rpc("ai_handoff", { p_conv: conv.id, p_reason: tools.reason ?? "agent" });
  return { replied: true, handoff: tools.handoff, text, lead };
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
