import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { publicEnv } from "@/lib/env";
import { sendMediaToConversation, sendToConversation } from "@/lib/channels/send-message";
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
  busyMessage,
  commandIntent,
  pickMedia,
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
  /** wave 10: the lead details the agent captured (for team updates) */
  leadData?: LeadData | null;
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
    if (acc?.secrets.bot_token && externalId.startsWith("biz:")) {
      // Telegram Business: "typing…" in the owner's chat with the customer
      const { businessConnectionFor } = await import("@/lib/channels/send-message");
      const connection = await businessConnectionFor(orgId, externalId);
      if (connection) await telegramCall(acc.secrets.bot_token, "sendChatAction", { business_connection_id: connection, chat_id: externalId.slice(4), action: "typing" });
    } else if (acc?.secrets.bot_token) await telegramCall(acc.secrets.bot_token, "sendChatAction", { chat_id: externalId, action: "typing" });
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

export async function handleInboundWithAI(input: { conversationId: string; messageId?: string | null; debounceMs?: number; retry?: boolean }): Promise<AutopilotResult> {
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

  // wave 9: a retry (safety net / in-run retry) never answers twice — skip when the last
  // message is already a real reply (not the short "on it" hold message)
  if (input.retry) {
    const { data: last } = await admin.from("messages").select("direction, meta").eq("conversation_id", input.conversationId).order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (last && last.direction === "out" && (last.meta as { fallback?: boolean } | null)?.fallback !== true) return { replied: false, handoff: false, reason: "already_answered" };
  }

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
    .select("direction, body, created_at, meta")
    .eq("conversation_id", conv.id)
    .order("created_at", { ascending: false })
    .limit(30);
  // "I'm checking…" holding replies are not part of the real conversation
  const history = buildHistory(((rows ?? []) as (StoredMessage & { meta?: { fallback?: boolean } | null })[]).reverse().filter((m) => !(m.direction === "out" && m.meta?.fallback)));
  const lastIn = [...history].reverse().find((m) => m.role === "user")?.content ?? "";
  if (!lastIn) return { replied: false, handoff: false, reason: "empty" };
  const locale = autopilotLocale(agent.language);
  const ch = channel as AutopilotChannel;
  const profile = (agent.profile as AgentProfile | null) ?? {};
  const menu = (profile.menu ?? []).map((b) => b.trim()).filter(Boolean).slice(0, 8);
  // Telegram / chat commands (/start, /menu, /human, /prices …)
  const lastLine = lastIn.split("\n").pop() ?? lastIn;
  const intent = commandIntent(lastLine, locale);
  if (intent.kind === "menu" && menu.length) {
    const text = formatForChannel(locale === "en" ? "Choose an option 👇" : locale === "ar" ? "اختر من القائمة 👇" : "בחרו מהתפריט 👇", ch);
    await sendToConversation(orgId, conv.id as string, text, undefined, { aiAgentId: agent.id as string, meta: { buttons: menu.slice(0, 3) }, rich: { menu, html: true } });
    return { replied: true, handoff: false, text };
  }
  if (intent.kind === "text" && intent.text !== lastLine) {
    const lastUser = [...history].reverse().find((m) => m.role === "user");
    if (lastUser) lastUser.content = lastUser.content.replace(lastLine, intent.text);
  }

  // Telegram "Start" button / a bare greeting command → the welcome message (no AI call needed)
  if (/^\/start\b/i.test(lastIn.trim())) {
    const { data: o } = await admin.from("organizations").select("name").eq("id", orgId).maybeSingle();
    const text = formatForChannel(((agent.greeting as string) ?? "").trim() || welcomeMessage(locale, (o?.name as string | undefined) ?? ""), ch);
    // wave 8: the business's menu buttons under the welcome message
    await sendToConversation(orgId, conv.id as string, text, undefined, {
      aiAgentId: agent.id as string,
      ...(menu.length ? { meta: { buttons: menu.slice(0, 3) }, rich: { menu, buttons: menu.slice(0, 3), html: true } } : {}),
    });
    return { replied: true, handoff: false, text };
  }

  // the customer explicitly asks for a person → hand off right away (no AI call needed)
  if (intent.kind === "human" || wantsHuman(lastLine)) {
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
    // no AI credits left → the team takes over (with a polite answer)
    if (/plan_limit|limit|demo/i.test(out.error)) {
      const sorry = formatForChannel(fallbackMessage(locale), ch);
      await sendToConversation(orgId, conv.id as string, sorry, undefined, { aiAgentId: agent.id as string });
      await admin.rpc("ai_handoff", { p_conv: conv.id, p_reason: out.error });
      return { replied: true, handoff: true, reason: out.error, text: sorry };
    }
    // provider busy: a short "on it" — the conversation stays with the agent and the
    // safety net (cron, every 1–5 min) answers properly; never a second holding message
    if (input.retry) return { replied: false, handoff: false, reason: out.error };
    // wave 9: at most ONE "on it" message per conversation every 15 minutes
    const { data: recentHold } = await admin
      .from("messages")
      .select("id")
      .eq("conversation_id", conv.id)
      .eq("direction", "out")
      .eq("meta->>fallback", "true")
      .gt("created_at", new Date(Date.now() - 15 * 60_000).toISOString())
      .limit(1)
      .maybeSingle();
    const hold = formatForChannel(busyMessage(locale), ch);
    if (!recentHold) await sendToConversation(orgId, conv.id as string, hold, undefined, { aiAgentId: agent.id as string, meta: { fallback: true } });
    // wave 9: when a provider frees up soon, answer from this same run instead of waiting for the cron
    const waitMs = (out as { retryInMs?: number | null }).retryInMs;
    if (typeof waitMs === "number" && waitMs <= 40_000) {
      await sleep(Math.max(waitMs, 3000));
      const again = await handleInboundWithAI({ conversationId: conv.id as string, retry: true });
      if (again.replied) return again;
    }
    return { replied: !recentHold, handoff: false, reason: out.error, text: recentHold ? undefined : hold };
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
  // examples / portfolio images the agent chose to show
  for (const item of pickMedia(out.text, profile.media)) {
    await sendMediaToConversation(orgId, conv.id as string, item, { aiAgentId: agent.id as string });
  }
  let lead: LeadCaptureResult | null = null;
  if (tools.lead) lead = await captureLead({ orgId, conversationId: conv.id as string, lead: tools.lead, channel: ch, title: (conv.title as string | null) ?? null });
  if (tools.handoff) await admin.rpc("ai_handoff", { p_conv: conv.id, p_reason: tools.reason ?? "agent" });
  return { replied: true, handoff: tools.handoff, reason: tools.handoff ? (tools.reason ?? "agent") : undefined, text, lead, leadData: tools.lead ?? null };
}

/** Fire-and-forget after the webhook response was sent (Vercel keeps the function alive). */
export async function scheduleAutopilot(input: { conversationId: string; messageId?: string | null; debounceMs?: number }) {
  try {
    const { after } = await import("next/server");
    after(async () => {
      try {
        const res = await handleInboundWithAI(input);
        await forwardAfterAutopilot(input.conversationId, res);
      } catch (e) {
        console.error("autopilot failed", (e as Error).message);
      }
    });
  } catch {
    // outside a request scope (tests / scripts): run inline
    await handleInboundWithAI(input)
      .then((res) => forwardAfterAutopilot(input.conversationId, res))
      .catch((e) => console.error("autopilot failed", (e as Error).message));
  }
}

/** Safety net (cron): answers customer messages that got no AI reply yet (provider was busy). */
export async function runPendingReplies(budgetMs = 40_000): Promise<{ checked: number; replied: number }> {
  const admin = createAdminClient();
  const started = Date.now();
  const { data } = await admin.rpc("ai_pending_replies", { p_limit: 20 });
  const rows = (data ?? []) as { conversation_id: string }[];
  let replied = 0;
  for (const r of rows) {
    if (Date.now() - started > budgetMs) break;
    try {
      const out = await handleInboundWithAI({ conversationId: r.conversation_id, retry: true });
      if (out.replied) replied++;
      await forwardAfterAutopilot(r.conversation_id, out);
    } catch (e) {
      console.error("pending reply failed", (e as Error).message);
    }
  }
  return { checked: rows.length, replied };
}

/**
 * wave 10 — team updates: after the agent handled a message, the people the business
 * invited (e-mail / Telegram / WhatsApp / SMS) get the exchange, new leads and
 * handoffs. Messages the agent could not take (human mode, no agent) go to them too.
 */
export async function forwardAfterAutopilot(conversationId: string, res: AutopilotResult): Promise<void> {
  try {
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return;
    const skip = ["no_service_key", "not_found", "channel", "already_answered", "superseded", "rate_limited", "empty"];
    if (res.reason && skip.includes(res.reason)) return;
    const busy = Boolean(res.reason && /^ai\.(busy|failed)/.test(res.reason));
    if (busy) return; // the real answer follows — forwarded then
    const admin = createAdminClient();
    const { data: conv } = await admin.from("conversations").select("id, organization_id, channel, title, external_id").eq("id", conversationId).maybeSingle();
    if (!conv) return;
    const { data: lastIn } = await admin.from("messages").select("body").eq("conversation_id", conversationId).eq("direction", "in").order("created_at", { ascending: false }).limit(1).maybeSingle();
    const { forwardToTeam } = await import("@/lib/notify/forward");
    const base = {
      conversationId,
      customer: (conv.title as string | null) ?? null,
      channel: conv.channel as string,
      customerText: (lastIn?.body as string | undefined) ?? null,
      excludeTarget: conv.channel === "telegram" ? String(conv.external_id).replace(/^biz:/, "") : null,
    };
    const orgId = conv.organization_id as string;
    if (res.reason === "human_mode" || res.reason === "no_agent") {
      await forwardToTeam(orgId, "messages", base);
      return;
    }
    if (res.replied && res.text) await forwardToTeam(orgId, "messages", { ...base, agentText: res.text });
    if (res.leadData && (res.leadData.name || res.leadData.phone || res.leadData.email)) await forwardToTeam(orgId, "leads", { ...base, lead: res.leadData });
    if (res.handoff) await forwardToTeam(orgId, "handoff", { ...base, reason: res.reason ?? null });
  } catch (e) {
    console.error("team update failed", (e as Error).message);
  }
}
