import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendToConversation } from "@/lib/channels/send-message";
import { runAISystem } from "./run-system";
import { autopilotLocale, sharePhoneLabel } from "./autopilot";
import { buildHistory, formatForChannel, parseAgentTools, salesAgentInstructions, type AgentProfile, type AutopilotChannel, type StoredMessage } from "./autopilot-core";

/**
 * Automatic follow-ups: when the agent answered last and the customer went quiet
 * for the agent's follow-up delay, the agent sends ONE short, personal nudge
 * (never on the website chat; WhatsApp only inside Meta's 24-hour window).
 * Called every few minutes by the jobs workflow / the bridge heartbeat.
 */
export async function runFollowups(budgetMs = 40_000): Promise<{ checked: number; sent: number }> {
  const admin = createAdminClient();
  const started = Date.now();
  // conversation guard: consent, ownership, "a person already answered", attempts (falls back before the migration)
  const guarded = await admin.rpc("ai_followup_candidates_guarded", { p_limit: 20 });
  const { data } = guarded.error ? await admin.rpc("ai_followup_candidates", { p_limit: 20 }) : guarded;
  const rows = (data ?? []) as { conversation_id: string; organization_id: string; agent_id: string; channel: string }[];
  let sent = 0;
  for (const r of rows) {
    if (Date.now() - started > budgetMs) break;
    // claim first (no double follow-ups when two runs overlap)
    const { data: claimed } = await admin
      .from("conversations")
      .update({ followup_count: 1 })
      .eq("id", r.conversation_id)
      .eq("followup_count", 0)
      .eq("ai_mode", "auto")
      .select("id, title")
      .maybeSingle();
    if (!claimed) continue;
    const { checkGuard } = await import("@/lib/conversations/guard");
    if (!(await checkGuard(r.conversation_id, "followup")).allowed) continue;
    const [{ data: agent }, { data: msgs }, { data: org }] = await Promise.all([
      admin.from("ai_agents").select("id, name, instructions, provider, model, temperature, language, profile, lead_goal").eq("id", r.agent_id).maybeSingle(),
      admin.from("messages").select("direction, body").eq("conversation_id", r.conversation_id).order("created_at", { ascending: false }).limit(20),
      admin.from("organizations").select("name").eq("id", r.organization_id).maybeSingle(),
    ]);
    if (!agent) continue;
    const ch = r.channel as AutopilotChannel;
    const locale = autopilotLocale(agent.language);
    const history = buildHistory(((msgs ?? []) as StoredMessage[]).reverse());
    if (!history.length) continue;
    const system = [
      `You are "${agent.name}", the assistant of "${(org?.name as string | undefined) ?? ""}". Business instructions:\n${((agent.instructions as string) ?? "").slice(0, 6000)}`,
      salesAgentInstructions({ profile: (agent.profile as AgentProfile | null) ?? null, goal: (agent.lead_goal as string | null) ?? "lead", channel: ch }),
      "The customer has not answered your last message for a while. Write ONE short, warm, personal follow-up (1–2 sentences) in the customer's language that refers to what they wanted and offers an easy next step. No pressure, no repeated text, no greeting formulas like 'Dear customer'.",
    ].join("\n\n");
    const out = await runAISystem({
      orgId: r.organization_id,
      feature: "autopilot",
      agentId: agent.id as string,
      provider: agent.provider as "openai" | "anthropic" | "gemini",
      model: agent.model as string,
      system,
      messages: [...history, { role: "user", content: "(no reply from the customer yet — write the follow-up now)" }],
      temperature: 0.6,
      maxTokens: 300,
    });
    if (!out.ok) continue;
    const tools = parseAgentTools(out.text);
    if (!tools.text) continue;
    await sendToConversation(r.organization_id, r.conversation_id, formatForChannel(tools.text, ch), undefined, {
      aiAgentId: agent.id as string,
      meta: { followup: true, ...(tools.buttons.length ? { buttons: tools.buttons } : {}) },
      rich: { buttons: tools.buttons, askPhone: tools.askPhone, askPhoneLabel: sharePhoneLabel(locale), html: true },
    });
    // the planned follow-up of the same silence is no longer needed
    await admin.rpc("cancel_pending_schedules", { p_org: r.organization_id, p_conversation: r.conversation_id, p_reason: "followup_sent", p_kinds: ["followup"], p_only_cancel_on_reply: false }).then(() => undefined, () => undefined);
    sent++;
  }
  return { checked: rows.length, sent };
}

/**
 * Conversation guard — one follow-up for a planned item (conversation_schedules):
 * the agent of the conversation's channel writes a short personal nudge and sends it.
 * The caller already checked outbound_guard. Returns the stored message id.
 */
export async function sendAgentFollowup(conversationId: string, opts: { scheduleId?: string; step?: number } = {}): Promise<{ ok: boolean; messageId?: string; error?: string }> {
  const admin = createAdminClient();
  const { data: conv } = await admin.from("conversations").select("id, organization_id, channel, contact_id, lead_score").eq("id", conversationId).maybeSingle();
  if (!conv) return { ok: false, error: "not_found" };
  const ch = conv.channel as AutopilotChannel;
  const [{ data: agent }, { data: msgs }, { data: org }, { data: moodRow }] = await Promise.all([
    admin.from("ai_agents").select("id, name, instructions, provider, model, temperature, language, profile, lead_goal").eq("organization_id", conv.organization_id).eq("enabled", true).contains("autopilot_channels", [conv.channel as string]).order("created_at").limit(1).maybeSingle(),
    admin.from("messages").select("direction, body").eq("conversation_id", conversationId).order("created_at", { ascending: false }).limit(20),
    admin.from("organizations").select("name").eq("id", conv.organization_id).maybeSingle(),
    // wave 16: the customer's mood / buying stage shapes the follow-up
    conv.contact_id
      ? admin.from("contact_insights").select("sentiment, stage, ai").eq("contact_id", conv.contact_id as string).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  if (!agent) return { ok: false, error: "no_agent" };
  const ins = moodRow as { sentiment?: string | null; stage?: string | null; ai?: { objections?: string } } | null;
  const { followupTone } = await import("./followup-tone");
  const tone = followupTone({ sentiment: (ins?.sentiment as "positive" | "neutral" | "negative" | null) ?? null, stage: ins?.stage ?? null, leadScore: ((conv as { lead_score?: string | null }).lead_score as string | null) ?? null, objections: ins?.ai?.objections ?? null });
  const locale = autopilotLocale(agent.language);
  const history = buildHistory(((msgs ?? []) as StoredMessage[]).reverse());
  if (!history.length) return { ok: false, error: "empty" };
  const step = opts.step ?? 1;
  const system = [
    `You are "${agent.name}", the assistant of "${(org?.name as string | undefined) ?? ""}". Business instructions:\n${((agent.instructions as string) ?? "").slice(0, 6000)}`,
    salesAgentInstructions({ profile: (agent.profile as AgentProfile | null) ?? null, goal: (agent.lead_goal as string | null) ?? "lead", channel: ch }),
    step > 1
      ? "The customer still has not answered your earlier follow-up. Write ONE very short, friendly last check-in (1 sentence) in the customer's language — different words than before, an easy yes/no question, zero pressure."
      : "The customer has not answered your last message for a while. Write ONE short, warm, personal follow-up (1–2 sentences) in the customer's language that refers to what they wanted and offers an easy next step. No pressure, no repeated text, no greeting formulas like 'Dear customer'.",
    `Tone for this customer: ${tone}`,
  ].join("\n\n");
  const out = await runAISystem({
    orgId: conv.organization_id as string,
    feature: "autopilot",
    agentId: agent.id as string,
    provider: agent.provider as "openai" | "anthropic" | "gemini",
    model: agent.model as string,
    system,
    messages: [...history, { role: "user", content: "(no reply from the customer yet — write the follow-up now)" }],
    temperature: 0.6,
    maxTokens: 300,
  });
  if (!out.ok) return { ok: false, error: out.error };
  const tools = parseAgentTools(out.text);
  if (!tools.text) return { ok: false, error: "empty_answer" };
  const r = await sendToConversation(conv.organization_id as string, conversationId, formatForChannel(tools.text, ch), undefined, {
    aiAgentId: agent.id as string,
    meta: { followup: true, step, ...(opts.scheduleId ? { schedule_id: opts.scheduleId } : {}), ...(tools.buttons.length ? { buttons: tools.buttons } : {}) },
    rich: { buttons: tools.buttons, askPhone: tools.askPhone, askPhoneLabel: sharePhoneLabel(locale), html: true },
  });
  if (r.ok) await admin.from("conversations").update({ followup_count: 1 }).eq("id", conversationId).eq("followup_count", 0);
  return { ok: r.ok, messageId: r.messageId, error: r.error };
}
