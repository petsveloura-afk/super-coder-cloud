import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendToConversation } from "@/lib/channels/send-message";
import { advanceFlow, pickFlow, validFlowNodes, type Flow, type FlowState } from "./flows-core";
import { formatForChannel, type AutopilotChannel } from "./autopilot-core";

/**
 * Wave 16 — runs the business's conversation flows before the free AI.
 * handled=true → the flow answered (or handed off); false → the AI answers.
 */
export async function runConversationFlow(input: { orgId: string; conversationId: string; agentId: string; contactId: string | null; channel: AutopilotChannel; text: string; locale: string }): Promise<{ handled: boolean; handoff: boolean; text?: string }> {
  const admin = createAdminClient();
  const { data: flowRows, error } = await admin
    .from("agent_flows")
    .select("id, name, enabled, trigger_keywords, on_first_message, nodes, agent_id")
    .eq("organization_id", input.orgId)
    .eq("enabled", true)
    .limit(30);
  if (error || !flowRows?.length) return { handled: false, handoff: false };
  const { data: hasFeature } = await admin.rpc("has_feature", { p_org: input.orgId, p_feature: "flow_builder" });
  if (hasFeature !== true) return { handled: false, handoff: false };
  const flows: Flow[] = (flowRows as { id: string; name: string; enabled: boolean; trigger_keywords: string[]; on_first_message: boolean; nodes: unknown; agent_id: string | null }[])
    .filter((f) => !f.agent_id || f.agent_id === input.agentId)
    .map((f) => ({ id: f.id, name: f.name, enabled: f.enabled, trigger_keywords: f.trigger_keywords ?? [], on_first_message: f.on_first_message, nodes: validFlowNodes(f.nodes) }));
  const { data: conv } = await admin.from("conversations").select("flow_state").eq("id", input.conversationId).maybeSingle();
  let state = ((conv?.flow_state as FlowState | null) ?? null) as FlowState | null;
  let flow = state ? (flows.find((f) => f.id === state!.flow_id) ?? null) : null;
  // a flow that waited more than a day is over
  if (state && (!flow || (state.started_at && Date.now() - new Date(state.started_at).getTime() > 86_400_000))) {
    state = null;
    flow = null;
    await admin.from("conversations").update({ flow_state: null }).eq("id", input.conversationId);
  }
  if (!flow) {
    const { count } = await admin.from("messages").select("id", { count: "exact", head: true }).eq("conversation_id", input.conversationId).eq("direction", "in");
    flow = pickFlow(flows, input.text, (count ?? 0) <= 1);
    if (!flow) return { handled: false, handoff: false };
    state = null;
    await admin.rpc("increment_flow_counter", { p_flow: flow.id, p_field: "runs" }).then(() => undefined, () => undefined);
  }
  const res = advanceFlow(flow, state, input.text, input.locale);
  // send the flow's messages (buttons where the channel supports them)
  let last = "";
  for (const m of res.messages) {
    const text = formatForChannel(m.text, input.channel);
    last = text;
    await sendToConversation(input.orgId, input.conversationId, text, undefined, {
      aiAgentId: input.agentId,
      meta: { flow: flow.id, system: "flow", ...(m.buttons?.length ? { buttons: m.buttons } : {}) },
      rich: { buttons: m.buttons ?? [], html: true },
    });
  }
  await admin.from("conversations").update({ flow_state: res.finished ? null : res.state }).eq("id", input.conversationId);
  if (res.finished) await admin.rpc("increment_flow_counter", { p_flow: flow.id, p_field: "completions" }).then(() => undefined, () => undefined);
  // details the customer gave → the contact + a note
  if (input.contactId && Object.keys(res.collected).length && res.finished) {
    const patch: Record<string, string> = {};
    const { data: c } = await admin.from("contacts").select("first_name, phone, email").eq("id", input.contactId).maybeSingle();
    if (res.collected.phone && !c?.phone) patch.phone = res.collected.phone.startsWith("+") || res.collected.phone.startsWith("0") ? res.collected.phone : `+${res.collected.phone}`;
    if (res.collected.email && !c?.email) patch.email = res.collected.email;
    if (res.collected.name && (!c?.first_name || /^\+?\d+$/.test(String(c.first_name)))) patch.first_name = res.collected.name.slice(0, 80);
    if (Object.keys(patch).length) await admin.from("contacts").update(patch).eq("id", input.contactId);
    const lines = Object.entries(res.collected).map(([k, v]) => `• ${k}: ${v}`).join("\n");
    await admin.from("notes").insert({ organization_id: input.orgId, contact_id: input.contactId, body: `🧭 ${flow.name}\n${lines}`.slice(0, 10000) });
  }
  if (res.handoff) await admin.rpc("ai_handoff", { p_conv: input.conversationId, p_reason: "flow" });
  if (res.toAI && !res.messages.length) return { handled: false, handoff: false };
  return { handled: res.messages.length > 0 || res.handoff, handoff: res.handoff, text: last };
}
