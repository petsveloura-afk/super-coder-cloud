import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { publicEnv } from "@/lib/env";
import { sendMediaToConversation, sendToConversation } from "@/lib/channels/send-message";
import { runAISystem } from "./run-system";
import { selfCheckBudgetMs, smartDebounceMs, Timing, withSoftDeadline } from "./speed-core";
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
  cleanCustomerName,
  commandIntent,
  pickMedia,
  DEFAULT_RESUME_MINUTES,
  type AgentProfile,
  type AutopilotChannel,
  type LeadData,
  type StoredMessage,
} from "./autopilot-core";
import {
  analyzeMessage,
  checkReply,
  correctionPrompt,
  criticalHandoffMessage,
  dropUnsupportedSentences,
  extractState,
  factsText,
  situationBrief,
  stopMessage,
} from "./intelligence";
import { normalizeSchedule, nextOpenText, scheduleStatus } from "./schedule";
import { proBrief } from "./brain-pro";
import { agentActionsInstructions, memoryBlock, parseActionMarkers } from "./agent-actions-core";

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
      orgId, // wave 61: falls back to the business's connected mailbox
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

/**
 * Speed upgrade — the entry point keeps its contract; around the reply logic it now keeps
 * "typing…" alive in the customer's app until the answer is out, and logs the reply latency.
 */
export async function handleInboundWithAI(input: { conversationId: string; messageId?: string | null; debounceMs?: number; retry?: boolean; quietRetry?: boolean }): Promise<AutopilotResult> {
  const started = Date.now();
  try {
    return await handleInboundWithAICore(input);
  } finally {
    const { stopTyping } = await import("./typing");
    stopTyping(input.conversationId);
    console.info("autopilot latency", JSON.stringify({ conversation: input.conversationId, ms: Date.now() - started, retry: Boolean(input.retry) }));
  }
}

async function handleInboundWithAICore(input: { conversationId: string; messageId?: string | null; debounceMs?: number; retry?: boolean; quietRetry?: boolean }): Promise<AutopilotResult> {
  const timing = new Timing();
  // true when the agent just took back a conversation it had handed over and nobody from the team answered
  let resumedUnattended = false;
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return { replied: false, handoff: false, reason: "no_service_key" };
  const admin = createAdminClient();
  const { data: conv } = await admin
    .from("conversations")
    .select("id, organization_id, channel, title, contact_id, ai_mode, status, external_id, lead_score")
    .eq("id", input.conversationId)
    .maybeSingle();
  if (!conv) return { replied: false, handoff: false, reason: "not_found" };
  if (conv.ai_mode !== "auto") {
    // wave 12: the owner wrote himself and has been quiet for the agent's "resume after" time → the agent comes back
    const { data: ra } = await admin
      .from("ai_agents")
      .select("profile")
      .eq("organization_id", conv.organization_id as string)
      .eq("enabled", true)
      .contains("autopilot_channels", [conv.channel as string])
      .order("created_at")
      .limit(1)
      .maybeSingle();
    // wave 21: an agent that never set this comes back after 30 minutes of owner silence (0 = never)
    const minutes = Number((ra?.profile as { resume_after_minutes?: number } | null)?.resume_after_minutes ?? DEFAULT_RESUME_MINUTES);
    // wave 57: a conversation that was paused only because of a TECHNICAL hiccup (an empty / broken AI
    // answer, a busy engine) — not by a person and not by a real handoff — comes straight back to the agent
    const { data: noteRow } = await admin.from("conversations").select("ai_note, handoff_at, owner_takeover_at").eq("id", conv.id).maybeSingle();
    const { technicalPauseExtended, unattendedResume } = await import("./autopilot-heal");
    const nr = (noteRow ?? {}) as { ai_note?: string | null; handoff_at?: string | null; owner_takeover_at?: string | null };
    // (also the watchdog's own hand-over after busy engines — "stuck_no_answer" is technical too)
    if (technicalPauseExtended(nr.ai_note ?? null)) {
      await admin.from("conversations").update({ ai_mode: "auto", handoff_at: null, ai_note: null, ai_note_at: null }).eq("id", conv.id).eq("ai_mode", "human");
      conv.ai_mode = "auto";
    }
    // the AGENT handed the conversation over and nobody from the team answered for a while → the agent answers again
    // (before: the customer's next messages got no reply at all until someone pressed "return to agent")
    if (conv.ai_mode !== "auto" && nr.handoff_at && !nr.owner_takeover_at) {
      const { data: teamReply } = await admin
        .from("messages")
        .select("id")
        .eq("conversation_id", conv.id)
        .eq("direction", "out")
        .gt("created_at", nr.handoff_at)
        .or("sent_by.not.is.null,meta->>owner.eq.true")
        .limit(1)
        .maybeSingle();
      const unattendedMinutes = (ra?.profile as { unattended_resume_minutes?: number } | null)?.unattended_resume_minutes;
      if (unattendedResume({ note: nr.ai_note, handoffAt: nr.handoff_at, ownerTakeoverAt: nr.owner_takeover_at, teamAnsweredSince: Boolean(teamReply), minutes: unattendedMinutes, now: Date.now() })) {
        const { data: back } = await admin.from("conversations").update({ ai_mode: "auto", handoff_at: null, ai_note: "resumed_unattended", ai_note_at: new Date().toISOString() }).eq("id", conv.id).eq("ai_mode", "human").select("id");
        if (back?.length) {
          conv.ai_mode = "auto";
          resumedUnattended = true;
          await admin.rpc("emit_event", { p_org: conv.organization_id, p_type: "ai.resumed", p_entity_type: "conversation", p_entity_id: conv.id, p_payload: { conversation_id: conv.id, reason: "team_silent", note: nr.ai_note ?? null } }).then(() => undefined, () => undefined);
        }
      }
    }
    const { maybeResumeAgent } = await import("@/lib/channels/owner");
    if (conv.ai_mode !== "auto" && !(minutes > 0 && (await maybeResumeAgent(conv.id as string, minutes)))) return { replied: false, handoff: false, reason: "human_mode" };
    conv.ai_mode = "auto";
  }
  const channel = conv.channel as string;
  if (!isAutopilotChannel(channel)) return { replied: false, handoff: false, reason: "channel" };
  const orgId = conv.organization_id as string;
  // conversation guard (one state for all channels): opted out, a person owns it / already answered
  // speed upgrade: the guard, the agent and the latest customer line load in parallel (one round trip)
  const { checkGuard } = await import("@/lib/conversations/guard");
  const [g, { data: agentRow }, { data: lastInRow }] = await Promise.all([
    checkGuard(conv.id as string, "ai_reply"),
    admin
      .from("ai_agents")
      .select("id, name, instructions, provider, model, temperature, language, handoff_rules, greeting, profile, lead_goal")
      .eq("organization_id", orgId)
      .eq("enabled", true)
      .contains("autopilot_channels", [channel])
      .order("created_at")
      .limit(1)
      .maybeSingle(),
    admin.from("messages").select("id, body, meta").eq("conversation_id", conv.id).eq("direction", "in").order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (!g.allowed) return { replied: false, handoff: false, reason: `guard:${g.reason}` };
  // not-a-customer filter (additive): newsletters, automatic notifications and clear spam pitches get no answer and no team alert
  {
    const { notCustomerKind } = await import("./spam-core");
    const lastMeta = ((lastInRow as { meta?: { automated?: boolean } | null } | null)?.meta ?? null) as { automated?: boolean } | null;
    const nk = lastInRow ? notCustomerKind({ text: String((lastInRow as { body?: string | null }).body ?? ""), channel, automated: lastMeta?.automated === true, subject: (conv.title as string | null) ?? null }) : null;
    if (nk) return { replied: false, handoff: false, reason: `filtered:${nk}` };
  }
  let agent = agentRow;
  // Facebook Messenger / Instagram / WhatsApp by QR or phone code: an agent created before these channels existed
  // (or by the quick-create button, or ticked only for the official WhatsApp) does not list them — the business's
  // first enabled agent answers there too, and the channel is added to it
  if (!agent && ((channel === "messenger" || channel === "instagram") || channel === "whatsapp_qr")) {
    const { data: fallback } = await admin
      .from("ai_agents")
      .select("id, name, instructions, provider, model, temperature, language, handoff_rules, greeting, profile, lead_goal, autopilot_channels")
      .eq("organization_id", orgId)
      .eq("enabled", true)
      .order("created_at")
      .limit(10);
    const { pickAgentForChannel } = await import("./agent-channel-core");
    const pick = pickAgentForChannel((fallback ?? []) as { id: string; autopilot_channels?: string[] | null }[], channel);
    if (pick) {
      agent = pick as unknown as NonNullable<typeof agentRow>;
      await admin
        .from("ai_agents")
        .update({ autopilot_channels: Array.from(new Set([...(pick.autopilot_channels ?? []), channel])) })
        .eq("id", pick.id)
        .then(() => undefined, () => undefined);
    }
  }
  if (!agent) return { replied: false, handoff: false, reason: "no_agent" };
  timing.mark("load");
  // speed upgrade: "typing…" from now until the answer is sent (stopped by handleInboundWithAI)
  {
    const { startTyping } = await import("./typing");
    void startTyping({ orgId, conversationId: conv.id as string, channel: channel as AutopilotChannel, externalId: conv.external_id as string });
  }
  // speed upgrade: what the reply needs is fetched while we wait for more customer messages
  const gRowP = admin.from("ai_agents").select("guardrails").eq("id", agent.id).maybeSingle();
  const contactP = conv.contact_id ? admin.from("contacts").select("id, first_name, last_name, phone, email").eq("id", conv.contact_id).maybeSingle() : Promise.resolve({ data: null });
  const linksP = Promise.all([
    admin.from("organizations").select("name").eq("id", orgId).maybeSingle(),
    admin.from("appointment_types").select("slug").eq("organization_id", orgId).eq("status", "active").order("created_at").limit(1).maybeSingle(),
    admin.from("forms").select("slug").eq("organization_id", orgId).eq("status", "active").order("created_at").limit(1).maybeSingle(),
    admin.from("sites").select("slug").eq("organization_id", orgId).eq("status", "published").order("created_at").limit(1).maybeSingle(),
  ]);

  // wave 9: a retry (safety net / in-run retry) never answers twice — skip when the last
  // message is already a real reply (not the short "on it" hold message)
  if (input.retry) {
    const { data: last } = await admin.from("messages").select("direction, meta").eq("conversation_id", input.conversationId).order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (last && last.direction === "out" && (last.meta as { fallback?: boolean } | null)?.fallback !== true && (last.meta as { escalation?: boolean } | null)?.escalation !== true) return { replied: false, handoff: false, reason: "already_answered" };
  }

  // debounce: answer only the latest of several quick messages
  const waitMs = smartDebounceMs(input.debounceMs, (lastInRow?.body as string | null) ?? "", process.env);
  if (input.debounceMs && input.debounceMs > 0 && waitMs > 0) {
    await sleep(waitMs);
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
  timing.mark("debounce");

  // wave A4 — one answer per customer message: the webhook run, the safety-net cron, the bridge tick and the watchdog can all pick
  // up the same message at the same moment; only the first one to claim it answers (the others stop here, quietly).
  // Fail-open: when the claim function is not installed yet (migration not run) or errors, the run continues exactly as before.
  if (lastInRow?.id) {
    try {
      const { data: claimed, error: claimError } = await admin.rpc("ai_claim_reply", { p_conversation: conv.id, p_message: lastInRow.id, p_ttl_seconds: 90 });
      if (!claimError && claimed === false) return { replied: false, handoff: false, reason: "already_answered" };
    } catch {
      /* no claim → the run goes on as before */
    }
  }

  // loop / abuse protection
  const [{ data: allowed }, { data: rows }] = await Promise.all([
    admin.rpc("public_rate_limit", { p_bucket: `autopilot:${conv.id}`, p_limit: 30, p_window_seconds: 3600 }),
    // resilient read (additive): the conversation history is retried on a transient database error instead of failing the reply
    (await import("@/lib/db/resilient")).withDbRetry(
      () =>
        admin
          .from("messages")
          .select("direction, body, created_at, meta")
          .eq("conversation_id", conv.id)
          .order("created_at", { ascending: false })
          .limit(30),
      { attempts: 3, budgetMs: 2500, label: "autopilot.history" },
    ),
  ]);
  if (allowed === false) return { replied: false, handoff: false, reason: "rate_limited" };
  // "I'm checking…" holding replies are not part of the real conversation
  const history = buildHistory(((rows ?? []) as (StoredMessage & { meta?: { fallback?: boolean; escalation?: boolean } | null })[]).reverse().filter((m) => !(m.direction === "out" && (m.meta?.fallback || m.meta?.escalation))));
  const lastIn = [...history].reverse().find((m) => m.role === "user")?.content ?? "";
  if (!lastIn) return { replied: false, handoff: false, reason: "empty" };
  const locale = autopilotLocale(agent.language);
  const ch = channel as AutopilotChannel;
  const profile = (agent.profile as AgentProfile | null) ?? {};
  const menu = (profile.menu ?? []).map((b) => b.trim()).filter(Boolean).slice(0, 8);
  // wave 59: the customer answered a review question ("how was it? 1–5") → the right reply, no AI call.
  // Checked only when the message looks like a rating (no extra wait for ordinary messages).
  if (conv.contact_id) {
    const { parseRating } = await import("@/lib/agents/review-gate-core");
    if (parseRating(lastIn) !== null) {
      const { handleReviewReply } = await import("@/lib/agents/review-gate");
      const gateText = await handleReviewReply({ orgId, contactId: conv.contact_id as string, conversationId: conv.id as string, text: lastIn, locale, agentId: agent.id as string, channel: ch });
      if (gateText) return { replied: true, handoff: false, text: gateText };
    }
  }
  // Telegram / chat commands (/start, /menu, /human, /prices …)
  const lastLine = lastIn.split("\n").pop() ?? lastIn;
  const intent = commandIntent(lastLine, locale);
  if (intent.kind === "menu" && menu.length) {
    const text = formatForChannel(locale === "en" ? "Choose an option 👇" : locale === "ar" ? "اختر من القائمة 👇" : "בחרו מהתפריט 👇", ch);
    await sendToConversation(orgId, conv.id as string, text, undefined, { aiAgentId: agent.id as string, meta: { buttons: menu.slice(0, 3) }, rich: { menu, html: true } });
    return { replied: true, handoff: false, text };
  }
  // wave 21: "2" after a numbered list of choices (WhatsApp shows buttons as "1. … 2. …") = that choice
  {
    const pick = /^\s*([1-9])\s*[.)]?\s*$/.exec(lastLine);
    if (pick) {
      const lastOut = ((rows ?? []) as { direction: string; meta?: { buttons?: string[]; fallback?: boolean } | null }[]).find((m) => m.direction === "out" && !m.meta?.fallback);
      const choice = lastOut?.meta?.buttons?.[Number(pick[1]) - 1];
      const lastUser = [...history].reverse().find((m) => m.role === "user");
      if (choice && lastUser) lastUser.content = lastUser.content.replace(/[1-9]\s*[.)]?\s*$/, choice);
    }
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

  // wave 15 — is the business open right now? (drives the "closed → deliveries / reservation" wording)
  const sched = normalizeSchedule(profile.schedule ?? null);
  const hoursContext = sched ? (() => { const st = scheduleStatus(sched); return { open: st.open, afterHours: sched.after_hours, nextOpen: st.open ? undefined : nextOpenText(st, locale) }; })() : null;
  // wave 15 — understand the message first (language, mood, intent); cheap, no AI call
  const analysis = analyzeMessage(lastLine);
  const state = extractState(history);
  const replyLocale = analysis.lang ?? locale;
  // the customer asks to stop: confirm once, never message again (follow-ups are switched off)
  if (analysis.intents.includes("unsubscribe")) {
    const text = formatForChannel(stopMessage(replyLocale), ch);
    await sendToConversation(orgId, conv.id as string, text, undefined, { aiAgentId: agent.id as string });
    await admin.from("conversations").update({ followup_count: 9 }).eq("id", conv.id).then(() => undefined, () => undefined);
    // waves 15-18: one state for all channels — the request to stop also opts the customer out everywhere
    // (every channel of this contact, campaigns, and anything already scheduled to him)
    {
      const contactId = (conv.contact_id as string | null) ?? null;
      const scope = admin.from("conversations").update({ opt_out: true }).eq("organization_id", orgId);
      await (contactId ? scope.or(`id.eq.${conv.id},contact_id.eq.${contactId}`) : scope.eq("id", conv.id)).then(() => undefined, () => undefined);
      if (contactId) await admin.from("contacts").update({ opted_out_at: new Date().toISOString(), marketing_consent: false }).eq("id", contactId).then(() => undefined, () => undefined);
      await admin.rpc("cancel_pending_schedules", { p_org: orgId, p_conversation: conv.id, p_reason: "opted_out", p_kinds: null, p_only_cancel_on_reply: false }).then(() => undefined, () => undefined);
    }
    return { replied: true, handoff: false, reason: "customer_stop", text };
  }
  // legal threats / threats of harm: a person takes over immediately, no AI improvisation
  if (analysis.critical) {
    const text = formatForChannel(criticalHandoffMessage(replyLocale), ch);
    await sendToConversation(orgId, conv.id as string, text, undefined, { aiAgentId: agent.id as string });
    await admin.rpc("ai_handoff", { p_conv: conv.id, p_reason: "critical:legal_or_threat" });
    return { replied: true, handoff: true, reason: "critical:legal_or_threat", text };
  }
  // wave 16: guardrails (angry customer, budget per conversation), flows, knowledge base
  const { data: gRow } = await gRowP;
  const { normalizeGuardrails, isAngry, guardrailHandoffText } = await import("./guardrails");
  const rails = normalizeGuardrails((gRow as { guardrails?: unknown } | null)?.guardrails);
  // speed upgrade: the help-center search runs while the flows / customer details are checked
  const kbP = rails.kb ? admin.rpc("kb_search", { p_org: orgId, p_query: lastLine.slice(0, 300), p_limit: 3 }) : null;
  if (rails.angry_handoff && isAngry(lastLine)) {
    const text = formatForChannel(guardrailHandoffText(locale, "angry"), ch);
    await sendToConversation(orgId, conv.id as string, text, undefined, { aiAgentId: agent.id as string, meta: { system: "guardrail" } });
    await admin.rpc("ai_handoff", { p_conv: conv.id, p_reason: "angry_customer" });
    return { replied: true, handoff: true, reason: "angry_customer", text };
  }
  if (rails.max_replies_per_day > 0) {
    const { data: used } = await admin.rpc("ai_replies_today", { p_conversation: conv.id });
    if (Number(used ?? 0) >= rails.max_replies_per_day) {
      const text = formatForChannel(guardrailHandoffText(locale, "budget"), ch);
      await sendToConversation(orgId, conv.id as string, text, undefined, { aiAgentId: agent.id as string, meta: { system: "guardrail" } });
      await admin.rpc("ai_handoff", { p_conv: conv.id, p_reason: "ai_budget" });
      return { replied: true, handoff: true, reason: "ai_budget", text };
    }
  }
  {
    const { runConversationFlow } = await import("./flows");
    const flowRes = await runConversationFlow({ orgId, conversationId: conv.id as string, agentId: agent.id as string, contactId: (conv.contact_id as string | null) ?? null, channel: ch, text: lastLine, locale });
    if (flowRes.handled) return { replied: true, handoff: flowRes.handoff, reason: flowRes.handoff ? "flow_handoff" : undefined, text: flowRes.text };
  }

  // customer details — and fill in a phone / e-mail the customer just typed
  let customer: { name?: string | null; phone?: string | null; email?: string | null } = { name: cleanCustomerName(conv.title as string | null) };
  if (conv.contact_id) {
    const { data: c } = (await contactP) as { data: { id: string; first_name: string | null; last_name: string | null; phone: string | null; email: string | null } | null };
    if (c) {
      customer = { name: cleanCustomerName(`${c.first_name ?? ""} ${c.last_name ?? ""}`) ?? customer.name ?? null, phone: (c.phone as string | null) ?? null, email: (c.email as string | null) ?? null };
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

  const [{ data: org }, { data: booking }, { data: form }, { data: site }] = await linksP;
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
  // wave 54 — long-term memory about this customer + the action tools (task, tag, follow-up, booking)
  const { loadMemories, canBook } = await import("./agent-actions");
  // wave 57: the funnel state loads in the same round trip (no extra wait before the answer)
  const salesStateP = import("./sales-state").then((m) => m.loadSalesState(conv.id as string)).catch(() => null);
  // wave 59: + can the agent send a payment link (the business's own Stripe / PayPal is connected)
  const { canPayOnline } = await import("@/lib/finance/pay-chat");
  // fast context cache (additive): "can book" / "can take payment" are business-level facts that change rarely — read once per
  // 30s per business instead of on every customer message (a cache failure falls back to the real read)
  const { cached } = await import("@/lib/cache/ttl-cache");
  const [memories, bookable, payable] = await Promise.all([
    loadMemories(orgId, (conv.contact_id as string | null) ?? null).catch(() => []),
    cached(`ap:canBook:${orgId}`, 30_000, () => canBook(orgId)).catch(() => canBook(orgId).catch(() => false)),
    cached(`ap:canPay:${orgId}`, 30_000, () => canPayOnline(orgId)).catch(() => canPayOnline(orgId).catch(() => false)),
  ]);
  const actionsSection = [memoryBlock(memories), agentActionsInstructions({ canBook: bookable, hasContact: Boolean(conv.contact_id), canPay: payable })].filter(Boolean).join("\n\n");
  // wave 55 — the conversation's sales funnel state and the precise goal of this reply
  const { loadSalesState } = await import("./sales-state");
  const { salesStateBrief } = await import("./sales-state-core");
  void loadSalesState; // (kept: the same loader, started above in parallel)
  const salesStateBefore = await salesStateP;
  const salesSection = salesStateBrief(salesStateBefore);
  // wave 59: A/B test of the opening line — only on the first reply of a conversation
  let openerPick: { variant: 0 | 1; text: string } | null = null;
  let openerLine = "";
  if (!history.some((m) => m.role === "assistant")) {
    const { openersOf, chooseOpener, openerInstruction } = await import("./opener-ab-core");
    const openers = openersOf(profile as { openers?: unknown });
    if (openers.length) {
      const { loadOpenerStats } = await import("./opener-ab");
      openerPick = chooseOpener(conv.id as string, openers, openers.length > 1 ? await loadOpenerStats(orgId).catch(() => null) : null);
      if (openerPick) openerLine = `\n\n${openerInstruction(openerPick.text)}`;
    }
  }
  // wave 63 — social intelligence: mood trend, sensitive moments, time (Shabbat / holidays / night), knowledge gaps.
  // Silent: on any problem the prompt is exactly what it was before.
  let socialSection = "";
  let socialFlags = { noSelling: false, noEmoji: false };
  try {
    const { socialBrief } = await import("./social-intel-core");
    const { similarity } = await import("./intelligence");
    const sb = socialBrief({ history, text: lastIn, facts: factsText({ instructions: agent.instructions as string, profile: profile as Record<string, unknown> }), tz: sched?.tz, lang: replyLocale, similarity });
    if (sb.text) socialSection = `\n\n${sb.text}`;
    socialFlags = { noSelling: sb.noSelling, noEmoji: sb.noEmoji };
  } catch {
    /* never blocks the reply */
  }
  // sales psychology engine (additive): numeric sentiment + trend, deep objections and the persuasion tactics that fit this
  // moment — bound to the business's real facts (proofs read from the agent's own profile / instructions). Never blocks.
  let psychologySection = "";
  try {
    const { salesPsychology, proofsFromFacts } = await import("./sales-psychology-core");
    const factsText = `${String(agent.instructions ?? "")}\n${JSON.stringify(agent.profile ?? {})}`;
    const sp = salesPsychology({ history, proofs: proofsFromFacts(factsText) });
    if (sp.brief) psychologySection = `\n\n${sp.brief}`;
  } catch {
    /* never blocks the reply */
  }
  // wave 7 — business profile, goal, sales method and tools (lead capture, buttons, share-phone)
  const system = `${baseInstructions}\n\n${salesAgentInstructions({
    profile: (agent.profile as AgentProfile | null) ?? null,
    goal: (agent.lead_goal as string | null) ?? "lead",
    channel: ch,
    leadKnown: conv.lead_score ? { score: conv.lead_score as string } : null,
    locale,
  })}\n\n${situationBrief({ analysis, state, channel: ch, hours: hoursContext })}\n\n${proBrief({ text: lastIn, history })}${psychologySection}\n\n${actionsSection}\n\n${salesSection}${socialSection}${openerLine}${resumedUnattended ? `\n\n${(await import("./autopilot-heal")).resumedNote(replyLocale)}` : ""}`;
  void typingIndicator(orgId, ch, conv.external_id as string); // speed upgrade: never waited for (the typing loop already runs)
  // wave 16: help-center answers (knowledge base) for this question
  let kb = "";
  if (rails.kb && kbP) {
    const { data: hits } = await kbP;
    const { kbBlock } = await import("./guardrails");
    kb = kbBlock(((hits ?? []) as { title: string; body: string }[]) ?? []);
  }

  timing.mark("prepare");
  const out = await runAISystem({
    orgId,
    feature: "autopilot",
    agentId: agent.id as string,
    provider: agent.provider as "openai" | "anthropic" | "gemini",
    model: agent.model as string,
    system: kb ? `${system}\n\n${kb}` : system,
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
    // wave 21: a provider that frees up within seconds → the customer only sees "typing…", no hold message
    {
      const soon = (out as { retryInMs?: number | null }).retryInMs;
      if (!input.quietRetry && typeof soon === "number" && soon <= 9_000) {
        await sleep(Math.max(soon, 1_500));
        const quiet = await handleInboundWithAI({ conversationId: conv.id as string, retry: true, quietRetry: true });
        if (quiet.replied) return quiet;
      }
    }
    // the customer is owed a real AI answer, not a template: a few quiet retries (the typing indicator keeps running)
    // come BEFORE any "on it" message, and the template is only sent when the engines stay unavailable for ~25 seconds
    {
      const quietUntil = Date.now() + 25_000;
      let wait = (out as { retryInMs?: number | null }).retryInMs ?? null;
      for (let q = 0; q < 3 && Date.now() < quietUntil; q++) {
        const pause = Math.min(Math.max(typeof wait === "number" ? wait : 5_000, 3_000), 10_000);
        if (Date.now() + pause > quietUntil + 2_000) break;
        await sleep(pause);
        const quietAgain = await handleInboundWithAI({ conversationId: conv.id as string, retry: true, quietRetry: true });
        if (quietAgain.replied || quietAgain.reason === "already_answered" || quietAgain.reason === "human_mode" || quietAgain.reason?.startsWith("guard:")) return quietAgain;
        wait = null;
      }
    }
    await admin.from("conversations").update({ ai_note: "ai_busy", ai_note_at: new Date().toISOString() }).eq("id", conv.id).then(() => undefined, () => undefined);
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
    // wave 21: a ladder of retries inside this run (the webhook may run 120s) — the real answer follows
    // the hold message within about a minute; the bridge heartbeat (every 30s) covers anything left
    const ladderUntil = Date.now() + 80_000;
    let waitMs = (out as { retryInMs?: number | null }).retryInMs ?? null;
    for (let attempt = 0; attempt < 6 && Date.now() < ladderUntil; attempt++) {
      const pause = Math.min(Math.max(typeof waitMs === "number" ? waitMs : [5_000, 10_000, 15_000, 20_000, 20_000, 20_000][attempt]!, 3_000), 25_000);
      if (Date.now() + pause > ladderUntil) break;
      await sleep(pause);
      const again = await handleInboundWithAI({ conversationId: conv.id as string, retry: true });
      if (again.replied || again.reason === "already_answered" || again.reason === "human_mode" || again.reason?.startsWith("guard:")) return again.replied ? again : { replied: !recentHold, handoff: false, reason: again.reason, text: recentHold ? undefined : hold };
      waitMs = null;
    }
    return { replied: !recentHold, handoff: false, reason: out.error, text: recentHold ? undefined : hold };
  }
  timing.mark("ai");
  // wave 15 — the agent checks its own answer (invented prices, repetition, leaks, empty text)
  // and gets exactly one chance to fix it; whatever is still wrong is removed or handed to a person
  // wave 54: the action markers are taken out first (the customer never sees them)
  let actionMarkers = parseActionMarkers(out.text);
  let answer = actionMarkers.text;
  let unsupportedLeft: string[] = [];
  {
    const facts = factsText({ instructions: agent.instructions as string, profile: profile as Record<string, unknown> });
    const previous = history.filter((m) => m.role === "assistant").map((m) => m.content);
    const first = parseAgentTools(answer);
    const check = checkReply({ reply: first.text, facts, previousAssistant: previous, allowEmpty: first.handoff, customerText: lastIn });
    // wave 63: extra checks (invented discount / warranty / response time, robotic wording, wrong language, emoji or selling to an upset customer)
    let extraIssues: import("./reply-quality-core").QualityIssue[] = [];
    try {
      const { qualityIssues } = await import("./reply-quality-core");
      extraIssues = qualityIssues({ reply: first.text, customerText: lastIn, facts, mood: analysis.mood, customerLang: analysis.lang, careful: socialFlags.noEmoji });
    } catch {
      /* the original check still runs */
    }
    if (!check.ok || extraIssues.length) {
      // speed upgrade: the correction gets a time budget (AI_SELF_CHECK_MS, default 7s); after it the
      // checked first answer is used (invented prices are still removed below)
      const fixed = await withSoftDeadline(
        runAISystem({
          orgId,
          feature: "autopilot",
          agentId: agent.id as string,
          provider: agent.provider as "openai" | "anthropic" | "gemini",
          model: agent.model as string,
          system,
          messages: [...history, { role: "assistant", content: answer.trim() || "(no answer)" }, { role: "user", content: await (async () => { try { const { combinedCorrectionPrompt } = await import("./reply-quality-core"); return combinedCorrectionPrompt(correctionPrompt(check), extraIssues, analysis.lang ?? replyLocale); } catch { return correctionPrompt(check); } })() }],
          temperature: Math.min(0.5, Number(agent.temperature ?? 0.4) + 0.1),
          maxTokens: ch === "email" ? 1200 : 600,
        }),
        // Facebook / Instagram: people expect an answer within seconds — a shorter correction budget there
        ch === "messenger" || ch === "instagram" ? Math.min(selfCheckBudgetMs(process.env), 4500) : selfCheckBudgetMs(process.env),
        { ok: false, error: "ai.self_check_timeout" } as Awaited<ReturnType<typeof runAISystem>>,
      );
      timing.mark("self_check");
      if (fixed.ok) {
        const fixedMarkers = parseActionMarkers(fixed.text);
        const again = checkReply({ reply: parseAgentTools(fixedMarkers.text).text, facts, previousAssistant: previous, allowEmpty: parseAgentTools(fixedMarkers.text).handoff, customerText: lastIn });
        let extraAfter = extraIssues;
        try {
          const { qualityIssues } = await import("./reply-quality-core");
          extraAfter = qualityIssues({ reply: parseAgentTools(fixedMarkers.text).text, customerText: lastIn, facts, mood: analysis.mood, customerLang: analysis.lang, careful: socialFlags.noEmoji });
        } catch {
          /* keep the old comparison */
        }
        if ((!check.ok && (again.ok || again.issues.length < check.issues.length)) || (check.ok && again.ok && extraAfter.length < extraIssues.length)) {
          answer = fixedMarkers.text;
          if (fixedMarkers.actions.length) actionMarkers = fixedMarkers;
        }
      }
    }
    const last = parseAgentTools(answer);
    const finalCheck = checkReply({ reply: last.text, facts, previousAssistant: previous, allowEmpty: last.handoff, customerText: lastIn });
    unsupportedLeft = finalCheck.unsupported;
  }
  const tools = parseAgentTools(answer);
  if (unsupportedLeft.length) tools.text = dropUnsupportedSentences(tools.text, unsupportedLeft);
  // wave 63: last line of defence for a discount percentage the business never gave
  try {
    const { inventedPercents } = await import("./reply-quality-core");
    const badPct = inventedPercents(tools.text, factsText({ instructions: agent.instructions as string, profile: profile as Record<string, unknown> }), lastIn);
    if (badPct.length) {
      const cleaned = dropUnsupportedSentences(tools.text, badPct);
      if (cleaned.trim()) tools.text = cleaned;
    }
  } catch {
    /* the reply goes out as it was */
  }
  // wave 57: a control line the parsers did not recognise ("[[FOLLOW-UP …]]", "[[TASK - …]]") is never shown to the customer
  {
    const { stripStrayMarkers } = await import("./autopilot-heal");
    tools.text = stripStrayMarkers(tools.text);
  }
  // wave 57: an empty answer gets one more quick try with the compact prompt (no extra sections) —
  // a technical hiccup must never pause the conversation and wait for "return to agent"
  if (!tools.text && !tools.handoff) {
    const retry = await withSoftDeadline(
      runAISystem({
        orgId,
        feature: "autopilot",
        agentId: agent.id as string,
        provider: agent.provider as "openai" | "anthropic" | "gemini",
        model: agent.model as string,
        system: `${baseInstructions}\n\n${salesAgentInstructions({ profile: (agent.profile as AgentProfile | null) ?? null, goal: (agent.lead_goal as string | null) ?? "lead", channel: ch, leadKnown: conv.lead_score ? { score: conv.lead_score as string } : null, locale })}`,
        messages: history,
        temperature: Number(agent.temperature ?? 0.4),
        maxTokens: ch === "email" ? 1200 : 600,
      }),
      ch === "messenger" || ch === "instagram" ? 6000 : 9000,
      { ok: false, error: "ai.empty_retry_timeout" } as Awaited<ReturnType<typeof runAISystem>>,
    );
    if (retry.ok) {
      const { stripStrayMarkers } = await import("./autopilot-heal");
      const retryMarkers = parseActionMarkers(retry.text);
      const retryTools = parseAgentTools(retryMarkers.text);
      retryTools.text = stripStrayMarkers(retryTools.text);
      // the quick retry passes the same price check as the first answer — an invented price never goes out this way either
      {
        const factsForRetry = factsText({ instructions: agent.instructions as string, profile: profile as Record<string, unknown> });
        const rc = checkReply({ reply: retryTools.text, facts: factsForRetry, previousAssistant: history.filter((m) => m.role === "assistant").map((m) => m.content), allowEmpty: retryTools.handoff, customerText: lastIn });
        if (rc.unsupported.length) {
          retryTools.text = dropUnsupportedSentences(retryTools.text, rc.unsupported);
          if (!retryTools.text.trim()) {
            // nothing true is left to say: the honest "let me check with the team" — the team gets it; the agent returns if nobody answers
            const safe = formatForChannel(guardrailHandoffText(locale, "check"), ch);
            await sendToConversation(orgId, conv.id as string, safe, undefined, { aiAgentId: agent.id as string, meta: { system: "guardrail", blocked: "price", draft: retry.text.slice(0, 1500) } });
            await admin.rpc("ai_handoff", { p_conv: conv.id, p_reason: "guardrail_price" });
            return { replied: true, handoff: true, reason: "guardrail_price", text: safe };
          }
        }
      }
      if (retryTools.text || retryTools.handoff) {
        Object.assign(tools, retryTools);
        if (retryMarkers.actions.length) actionMarkers = retryMarkers;
      }
    }
    if (!tools.text && !tools.handoff) {
      // still nothing: a short "on it" and the safety net answers properly — the agent keeps the conversation
      const { data: recentHold } = await admin.from("messages").select("id").eq("conversation_id", conv.id).eq("direction", "out").eq("meta->>fallback", "true").gt("created_at", new Date(Date.now() - 15 * 60_000).toISOString()).limit(1).maybeSingle();
      await admin.from("conversations").update({ ai_note: "ai_busy", ai_note_at: new Date().toISOString() }).eq("id", conv.id).then(() => undefined, () => undefined);
      if (input.retry) return { replied: false, handoff: false, reason: "empty_answer" };
      const hold = formatForChannel(busyMessage(locale), ch);
      if (!recentHold) await sendToConversation(orgId, conv.id as string, hold, undefined, { aiAgentId: agent.id as string, meta: { fallback: true } });
      return { replied: !recentHold, handoff: false, reason: "empty_answer", text: recentHold ? undefined : hold };
    }
  }
  void parseAutopilotReply; // (wave 6 parser kept for compatibility; the tools parser is a superset)
  // an empty answer must never be sent as "I passed you to the team" without really doing it
  if (!tools.text && !tools.handoff) {
    tools.text = fallbackMessage(replyLocale);
    tools.handoff = true;
    tools.reason = "empty_answer";
  }
  // wave 16: never send a forbidden phrase or a price that is not in the business data
  {
    const { bannedHit, unknownPrices } = await import("./guardrails");
    // wave 57: what the customer said and what we remember about them (their budget, a price they saw) is known too
    const known = [JSON.stringify(agent.profile ?? {}), String(agent.instructions ?? ""), kb, lastIn, memories.map((m) => m.fact).join("\n")].join("\n");
    const hit = bannedHit(tools.text, rails.banned);
    const badPrices = rails.price_guard ? unknownPrices(tools.text, known) : [];
    if (hit || badPrices.length) {
      const safe = formatForChannel(guardrailHandoffText(locale, "check"), ch);
      await sendToConversation(orgId, conv.id as string, safe, undefined, { aiAgentId: agent.id as string, meta: { system: "guardrail", blocked: hit ? "banned" : "price", draft: tools.text.slice(0, 1500) } });
      await admin.rpc("ai_handoff", { p_conv: conv.id, p_reason: hit ? "guardrail_banned" : "guardrail_price" });
      return { replied: true, handoff: true, reason: hit ? "guardrail_banned" : "guardrail_price", text: safe };
    }
  }
  // wave A1: customer-ready guard — the model's own thinking and internal notes never reach the customer; text that is not ready
  // (unfilled placeholder, raw JSON, leaked instructions…) takes the same honest "let me check with the team" path as a banned phrase,
  // so the customer is never left in silence and the team gets the draft
  if (tools.text.trim()) {
    try {
      const { assessCustomerText, outboundGuardMode, heldRecord } = await import("./outbound-guard-core");
      const guardMode = outboundGuardMode(process.env.OUTBOUND_GUARD);
      if (guardMode !== "off") {
        const a = assessCustomerText(tools.text);
        if (a.ok) tools.text = a.text;
        else if (guardMode === "clean") tools.text = a.text || tools.text;
        else {
          // wave A4 — an unready draft is REPAIRED, never turned into a hand-over by itself (hand-overs stay with the agent's own settings:
          // hand-over rules, angry customer, budget, banned words, price check, a customer asking for a person).
          // 1) the agent rewrites the message once (same way the self-check already does)  2) otherwise the unready sentences are dropped
          // 3) otherwise the agent keeps the conversation: a short "on it", the owners are told once, the safety net answers again
          console.warn("guardrail_unready", JSON.stringify({ conversation: conv.id, reasons: heldRecord(a, tools.text).reasons }));
          let candidate = "";
          try {
            const redo = await withSoftDeadline(
              runAISystem({
                orgId,
                feature: "autopilot",
                agentId: agent.id as string,
                provider: agent.provider as "openai" | "anthropic" | "gemini",
                model: agent.model as string,
                system: kb ? `${system}\n\n${kb}` : system,
                messages: [
                  ...history,
                  { role: "assistant", content: tools.text.slice(0, 1500) },
                  { role: "user", content: "(internal check, not from the customer) Your last draft cannot be sent as it is: it contains something that is not for a customer (an unfilled placeholder such as [name] or {{x}}, a template word in brackets, an internal note, raw data or part of your instructions). Write the final message again, in the customer's language and with the same facts, as plain text for the customer only: no placeholders, no brackets with template words, no notes. If you do not know a detail, ask the customer for it or leave it out." },
                ],
                temperature: Math.min(0.5, Number(agent.temperature ?? 0.4) + 0.1),
                maxTokens: ch === "email" ? 1200 : 600,
              }),
              ch === "messenger" || ch === "instagram" ? Math.min(selfCheckBudgetMs(process.env), 4500) : selfCheckBudgetMs(process.env),
              { ok: false, error: "ai.self_check_timeout" } as Awaited<ReturnType<typeof runAISystem>>,
            );
            if (redo.ok) {
              const { stripStrayMarkers } = await import("./autopilot-heal");
              const redoText = stripStrayMarkers(parseAgentTools(parseActionMarkers(redo.text).text).text);
              const b = assessCustomerText(redoText);
              if (b.ok && b.text) candidate = b.text;
            }
          } catch {
            /* the next step takes over */
          }
          if (!candidate) {
            const kept = (a.text || "").split(/(?<=[.!?؟\n])\s+/).filter((x) => x.trim() && assessCustomerText(x).ok).join(" ").trim();
            if (kept && assessCustomerText(kept).ok) candidate = kept;
          }
          // whatever replaces the draft passes the same banned-phrase and price checks as any other answer
          if (candidate) {
            const { bannedHit, unknownPrices } = await import("./guardrails");
            const known = [JSON.stringify(agent.profile ?? {}), String(agent.instructions ?? ""), kb, lastIn, memories.map((m) => m.fact).join("\n")].join("\n");
            if (bannedHit(candidate, rails.banned) || (rails.price_guard && unknownPrices(candidate, known).length)) candidate = "";
          }
          if (candidate) tools.text = candidate;
          else if (tools.handoff) tools.text = ""; // the agent itself decided to hand over → the normal hand-over message below
          else {
            const { data: recentHold } = await admin.from("messages").select("id").eq("conversation_id", conv.id).eq("direction", "out").eq("meta->>fallback", "true").gt("created_at", new Date(Date.now() - 15 * 60_000).toISOString()).limit(1).maybeSingle();
            await admin.from("conversations").update({ ai_note: "ai_busy", ai_note_at: new Date().toISOString() }).eq("id", conv.id).then(() => undefined, () => undefined);
            try {
              const { notifyHeldMessage } = await import("@/lib/channels/send-message");
              await notifyHeldMessage(orgId, conv.id as string);
            } catch {
              /* the owners' note is best effort */
            }
            if (input.retry) return { replied: false, handoff: false, reason: "empty_answer" };
            const hold = formatForChannel(busyMessage(locale), ch);
            if (!recentHold) await sendToConversation(orgId, conv.id as string, hold, undefined, { aiAgentId: agent.id as string, meta: { fallback: true } });
            return { replied: !recentHold, handoff: false, reason: "empty_answer", text: recentHold ? undefined : hold };
          }
        }
      }
    } catch {
      /* the reply goes out as it was */
    }
  }
  // wave A4 — last look before sending: when somebody (another run, or a person from the team) already answered this customer
  // message while the answer was being written, this answer is dropped instead of sent as a second one
  try {
    const { data: recent } = await admin.from("messages").select("direction, status, meta").eq("conversation_id", conv.id).order("created_at", { ascending: false }).limit(8);
    for (const m of (recent ?? []) as { direction: string; status: string | null; meta: { fallback?: boolean; escalation?: boolean } | null }[]) {
      if (m.direction === "in") break;
      if (m.direction === "out" && m.status !== "failed" && m.meta?.fallback !== true && m.meta?.escalation !== true) return { replied: false, handoff: false, reason: "already_answered" };
    }
  } catch {
    /* the reply goes out as it was */
  }
  const text = formatForChannel(tools.text || handoffMessage(locale), ch);
  timing.mark("check");
  await sendToConversation(orgId, conv.id as string, text, undefined, {
    aiAgentId: agent.id as string,
    // speed upgrade: how long this reply took, per stage (shown in the inbox as ⚡)
    meta: { ...(tools.buttons.length || tools.askPhone ? { buttons: tools.buttons, ask_phone: tools.askPhone } : {}), timing: timing.toJSON(), engine: out.provider ?? null },
    rich: { buttons: tools.buttons, askPhone: tools.askPhone, askPhoneLabel: sharePhoneLabel(locale), html: true },
  });
  {
    const { stopTyping } = await import("./typing");
    stopTyping(conv.id as string);
  }
  // speed upgrade: the bookkeeping after the answer runs in parallel
  await Promise.all([
    admin.from("conversations").update({ last_ai_at: new Date().toISOString() }).eq("id", conv.id),
    // wave 15: remember the customer's mood and main intent for the inbox (ignored until the migration ran)
    admin.from("conversations").update({ sentiment: analysis.mood, last_intent: analysis.intents[0] ?? null }).eq("id", conv.id).then(() => undefined, () => undefined),
  ]);
  // wave 16: the customer sent a voice note → also answer with a voice note (when enabled)
  // wave 22: on every channel that carries voice (Telegram bot / Business / personal, WhatsApp QR / Cloud),
  // as a real voice message (OGG/Opus) when possible
  const { voiceChannel } = await import("./voice-note-core");
  if (rails.voice_replies && voiceChannel(ch)) {
    const { data: lastMsg } = await admin.from("messages").select("meta").eq("conversation_id", conv.id).eq("direction", "in").order("created_at", { ascending: false }).limit(1).maybeSingle();
    // wave 55: voice answers are a paid feature (plan "voice_notes" or its free trial)
    const { orgHasFeatureAdmin } = await import("@/lib/billing/features");
    const voicePaid = await orgHasFeatureAdmin(orgId, "voice_notes").catch(() => false);
    if (voicePaid && typeof (lastMsg?.meta as { transcript?: string } | null)?.transcript === "string") {
      const { ttsConfigured } = await import("./tts");
      if (ttsConfigured()) {
        const { synthesizeVoiceNote, deliverVoiceNote } = await import("./voice-note");
        // wave 55: speak with this agent's voice persona (falls back to the default voice)
        const { loadVoicePersona } = await import("./voice-persona");
        const persona = await loadVoicePersona(agent.id as string);
        const audio = await synthesizeVoiceNote(tools.text, locale, persona);
        if (audio) await deliverVoiceNote({ orgId, channel: ch, externalId: conv.external_id as string, conversationId: conv.id as string, audio });
      }
    }
  }
  // examples / portfolio images the agent chose to show
  for (const item of pickMedia(answer, profile.media)) {
    await sendMediaToConversation(orgId, conv.id as string, item, { aiAgentId: agent.id as string });
  }
  let lead: LeadCaptureResult | null = null;
  if (tools.lead) lead = await captureLead({ orgId, conversationId: conv.id as string, lead: tools.lead, channel: ch, title: (conv.title as string | null) ?? null });
  // wave 54: memory + actions (task, tag, follow-up, booking) — never blocks or breaks the reply
  let actionsDone: string[] = [];
  if (actionMarkers.actions.length || tools.lead) {
    const { executeAgentActions } = await import("./agent-actions");
    actionsDone = await executeAgentActions({
      orgId,
      conversationId: conv.id as string,
      contactId: lead?.contact_id ?? ((conv.contact_id as string | null) ?? null),
      channel: ch,
      agentId: agent.id as string,
      locale: replyLocale,
      actions: actionMarkers.actions,
      lead: tools.lead,
      customer,
    })
      .then((r) => r.done)
      .catch((e) => {
        console.error("agent actions failed", (e as Error).message);
        return [] as string[];
      });
  }
  // wave 63: what the conversation showed (objections, preferences, interests) becomes customer memory — best effort
  void import("./customer-insight")
    .then((m) => m.rememberFromConversation({ orgId, contactId: lead?.contact_id ?? ((conv.contact_id as string | null) ?? null), conversationId: conv.id as string, history }))
    .catch(() => undefined);
  // wave 55 — move the funnel state forward from what really happened in this turn (CRM synced)
  try {
    const { nextSalesState } = await import("./sales-state-core");
    const { applySalesTransition } = await import("./sales-state");
    const transition = nextSalesState({
      current: salesStateBefore,
      text: lastIn,
      history,
      leadCaptured: Boolean(lead?.contact_id),
      bookingRequested: actionMarkers.actions.some((a) => a.kind === "book"),
      booked: actionsDone.includes("book:ok"),
      handoff: Boolean(tools.handoff),
    });
    await applySalesTransition({ orgId, conversationId: conv.id as string, contactId: lead?.contact_id ?? ((conv.contact_id as string | null) ?? null), from: salesStateBefore, transition });
  } catch (e) {
    console.error("sales state failed", (e as Error).message);
  }
  if (openerPick) {
    const { markOpener } = await import("./opener-ab");
    await markOpener(conv.id as string, openerPick.variant);
  }
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
    // not-a-customer filter: newsletters / spam do not wake the team
    if (res.reason?.startsWith("filtered:")) return;
    const busy = Boolean(res.reason && /^ai\.(busy|failed)/.test(res.reason));
    if (busy) return; // the real answer follows — forwarded then
    const admin = createAdminClient();
    const { data: conv } = await admin.from("conversations").select("id, organization_id, channel, title, external_id").eq("id", conversationId).maybeSingle();
    if (!conv) return;
    const { data: lastIn } = await admin.from("messages").select("id, body").eq("conversation_id", conversationId).eq("direction", "in").order("created_at", { ascending: false }).limit(1).maybeSingle();
    const { forwardToTeam } = await import("@/lib/notify/forward");
    const base = {
      conversationId,
      // never-lost alerts: the customer message this alert is about (one delivery record per recipient → retries, no duplicates)
      messageId: (lastIn?.id as string | undefined) ?? null,
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
    if (res.handoff) {
      // wave 63: the person who takes over gets a ready summary (silent: without it the update looks as before)
      const summary = await import("./handoff-summary").then((m) => m.loadHandoffSummary(conversationId, "he", res.reason ?? null)).catch(() => null);
      await forwardToTeam(orgId, "handoff", { ...base, reason: res.reason ?? null, ...(summary ? { summary } : {}) });
    }
    // wave 16: urgent phone call to the on-duty team member — hot lead / angry customer / asked for a person
    if (res.handoff) {
      const { data: hot } = await admin.from("conversations").select("lead_score").eq("id", conversationId).maybeSingle();
      const urgent = hot?.lead_score === "hot" || ["angry_customer", "customer_asked", "phone_human"].includes(res.reason ?? "customer_asked");
      if (urgent) {
        const { data: callers } = await admin.from("notify_recipients").select("id").eq("organization_id", orgId).eq("kind", "call").eq("enabled", true).contains("events", ["escalation"]).limit(1);
        if (callers?.length) {
          await admin.from("jobs").insert({ organization_id: orgId, kind: "call", payload: { customer: base.customer, reason: res.reason ?? "handoff", conversation_id: conversationId } });
          const { kickJobs } = await import("@/lib/jobs/kick");
          kickJobs();
        }
      }
    }
  } catch (e) {
    console.error("team update failed", (e as Error).message);
  }
}
