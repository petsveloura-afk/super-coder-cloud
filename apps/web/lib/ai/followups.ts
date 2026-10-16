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
  const { data } = await admin.rpc("ai_followup_candidates", { p_limit: 20 });
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
    sent++;
  }
  return { checked: rows.length, sent };
}
