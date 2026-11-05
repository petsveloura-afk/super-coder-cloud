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
  // additive: conversations the watchdog already handed over (busy engines) still get their real answer once an engine frees up
  if (Date.now() - started < budgetMs) {
    const rescued = await runTechnicalRescue(Math.max(3_000, budgetMs - (Date.now() - started))).catch((e) => {
      console.error("watchdog: rescue failed", (e as Error).message);
      return 0;
    });
    retried += rescued;
  }
  return { checked: rows.length, retried, escalated };
}

/**
 * The customer got only "sorry, I passed you to the team" because the AI engines were busy, and nobody from the team wrote
 * since: as soon as an engine answers, the agent replies to the original question (within 3 hours). A hand-over by a person,
 * a real hand-over reason (price check, legal) or any team message leaves the conversation alone.
 */
export async function runTechnicalRescue(budgetMs = 10_000): Promise<number> {
  const admin = createAdminClient();
  const started = Date.now();
  const since = new Date(Date.now() - 3 * 3600_000).toISOString();
  const { data } = await admin
    .from("messages")
    .select("conversation_id, created_at")
    .eq("direction", "out")
    .eq("meta->>escalation", "true")
    .gt("created_at", since)
    .order("created_at", { ascending: false })
    .limit(30);
  const seen = new Set<string>();
  let rescued = 0;
  for (const m of (data ?? []) as { conversation_id: string; created_at: string }[]) {
    if (Date.now() - started > budgetMs || seen.has(m.conversation_id) || seen.size >= 10) break;
    seen.add(m.conversation_id);
    // still the last word in the conversation (no real answer, no team message, no newer customer message handled elsewhere)
    const { data: last } = await admin.from("messages").select("direction, meta, sent_by").eq("conversation_id", m.conversation_id).order("created_at", { ascending: false }).limit(1).maybeSingle();
    const lm = (last ?? null) as { direction?: string; meta?: { escalation?: boolean } | null; sent_by?: string | null } | null;
    if (!lm || lm.direction !== "out" || lm.meta?.escalation !== true) continue;
    const { data: conv } = await admin.from("conversations").select("ai_mode, ai_note, status").eq("id", m.conversation_id).maybeSingle();
    const cv = (conv ?? null) as { ai_mode?: string; ai_note?: string | null; status?: string } | null;
    if (!cv || cv.status === "closed") continue;
    const { technicalPauseExtended } = await import("./autopilot-heal");
    if (cv.ai_mode !== "auto" && !technicalPauseExtended(cv.ai_note ?? null)) continue;
    try {
      const out = await handleInboundWithAI({ conversationId: m.conversation_id, retry: true });
      if (out.replied) {
        rescued++;
        await forwardAfterAutopilot(m.conversation_id, out);
      }
    } catch (e) {
      console.error("rescue failed", m.conversation_id, (e as Error).message);
    }
  }
  return rescued;
}
