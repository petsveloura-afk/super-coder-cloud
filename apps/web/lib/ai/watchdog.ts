import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendToConversation } from "@/lib/channels/send-message";
import { handleInboundWithAI, autopilotLocale, forwardAfterAutopilot } from "./autopilot";
import { stuckEscalationMessage, stuckPolicy } from "./resilience-core";
import { formatForChannel, isAutopilotChannel } from "./autopilot-core";

/**
 * Wave 15 — watchdog. Finds customer messages that stayed unanswered (AI engines down, a run
 * that died, a hold message with no follow-up) and makes sure nobody is left in silence:
 *   2+ minutes  → one more try (the router also probes resting engines as a last resort)
 *   8+ minutes  → a polite message and the chat goes to the team (ai_handoff), team is notified
 * Runs from the same cron that already runs the safety net (/api/ai/followups).
 */
export async function runStuckWatchdog(budgetMs = 20_000): Promise<{ checked: number; retried: number; escalated: number }> {
  const admin = createAdminClient();
  const started = Date.now();
  const { data, error } = await admin.rpc("ai_stuck_conversations", { p_limit: 20 });
  if (error) {
    // migration not applied yet — the rest of the platform keeps working
    console.error("watchdog: ai_stuck_conversations unavailable", error.message);
    return { checked: 0, retried: 0, escalated: 0 };
  }
  const rows = (data ?? []) as { conversation_id: string; organization_id: string; channel: string; waiting_seconds: number; language: string | null }[];
  let retried = 0;
  let escalated = 0;
  for (const r of rows) {
    if (Date.now() - started > budgetMs) break;
    const action = stuckPolicy({ waitingMs: r.waiting_seconds * 1000, attempts: 0 }, process.env);
    if (action === "wait") continue;
    try {
      if (action === "retry") {
        const out = await handleInboundWithAI({ conversationId: r.conversation_id, retry: true });
        if (out.replied) retried++;
        await forwardAfterAutopilot(r.conversation_id, out);
        continue;
      }
      // escalate: one last attempt, then a person takes over
      const last = await handleInboundWithAI({ conversationId: r.conversation_id, retry: true });
      if (last.replied && !(last.reason && /^ai\./.test(last.reason))) {
        retried++;
        await forwardAfterAutopilot(r.conversation_id, last);
        continue;
      }
      if (!isAutopilotChannel(r.channel)) continue;
      const text = formatForChannel(stuckEscalationMessage(autopilotLocale(r.language)), r.channel);
      await sendToConversation(r.organization_id, r.conversation_id, text, undefined, { meta: { escalation: true } });
      await admin.rpc("ai_handoff", { p_conv: r.conversation_id, p_reason: "stuck_no_answer" });
      await forwardAfterAutopilot(r.conversation_id, { replied: true, handoff: true, reason: "stuck_no_answer", text });
      escalated++;
    } catch (e) {
      console.error("watchdog failed", r.conversation_id, (e as Error).message);
    }
  }
  return { checked: rows.length, retried, escalated };
}
