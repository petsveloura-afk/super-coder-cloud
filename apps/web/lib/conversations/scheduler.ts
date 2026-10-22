import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkGuard, type GuardKind } from "./guard";
import { isRetryReason, optInConfirmation, optOutConfirmation } from "./guard-core";

/**
 * Conversation guard — runs the single list of planned messages
 * (conversation_schedules): AI follow-ups after N hours, messages the team
 * scheduled, sequence steps. Every item asks outbound_guard() right before
 * sending; the database already canceled items whose customer replied / opted out
 * or where a person answered. Claimed atomically — never sent twice.
 */
interface ScheduleRow {
  id: string;
  organization_id: string;
  conversation_id: string;
  contact_id: string | null;
  kind: "followup" | "scheduled" | "sequence" | "reminder";
  body: string | null;
  payload: Record<string, unknown>;
  step: number;
  created_by: string | null;
}

const KIND: Record<ScheduleRow["kind"], GuardKind> = { followup: "followup", scheduled: "scheduled", sequence: "sequence", reminder: "reminder" };

export async function runDueSchedules(budgetMs = 25_000): Promise<{ claimed: number; sent: number; skipped: number; retried: number }> {
  const out = { claimed: 0, sent: 0, skipped: 0, retried: 0 };
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return out;
  const started = Date.now();
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("claim_due_schedules", { p_limit: 30 });
  if (error) {
    if (error.code !== "PGRST202") console.error("claim_due_schedules failed", error.message);
    return out;
  }
  const rows = (data ?? []) as ScheduleRow[];
  out.claimed = rows.length;
  for (const s of rows) {
    if (Date.now() - started > budgetMs) {
      // give it back to the next run
      await admin.rpc("finish_schedule", { p_id: s.id, p_status: "pending", p_reason: "budget" });
      out.retried++;
      continue;
    }
    const g = await checkGuard(s.conversation_id, KIND[s.kind], s.id);
    if (!g.allowed) {
      if (isRetryReason(g.reason)) {
        await admin.rpc("finish_schedule", { p_id: s.id, p_status: "pending", p_reason: g.reason });
        out.retried++;
      } else {
        await admin.rpc("finish_schedule", { p_id: s.id, p_status: g.reason === "customer_replied" || g.reason === "opted_out" || g.reason === "human_answered" ? "canceled" : "skipped", p_reason: g.reason });
        out.skipped++;
      }
      continue;
    }
    try {
      if (s.kind === "followup") {
        const { sendAgentFollowup } = await import("@/lib/ai/followups");
        const r = await sendAgentFollowup(s.conversation_id, { scheduleId: s.id, step: s.step });
        if (!r.ok) {
          await admin.rpc("finish_schedule", { p_id: s.id, p_status: r.error === "ai.busy" ? "pending" : "failed", p_reason: (r.error ?? "failed").slice(0, 200) });
          if (r.error === "ai.busy") out.retried++;
          else out.skipped++;
          continue;
        }
        await admin.rpc("finish_schedule", { p_id: s.id, p_status: "sent", p_reason: null, p_message: r.messageId ?? null });
        out.sent++;
        // more follow-ups for this silence? (the workspace policy decides how many and the gap)
        const { data: pol } = await admin.rpc("conversation_policy", { p_org: s.organization_id });
        const max = Math.max(1, Math.min(5, Number((pol as { followup_max?: number } | null)?.followup_max ?? 1)));
        const gap = Math.max(1, Math.min(168, Number((pol as { followup_gap_hours?: number } | null)?.followup_gap_hours ?? 24)));
        if (s.step < max) await admin.rpc("plan_followup", { p_conversation: s.conversation_id, p_hours: gap, p_step: s.step + 1 });
        continue;
      }
      if ((s.kind === "scheduled" || s.kind === "sequence" || s.kind === "reminder") && s.body) {
        const { sendToConversation } = await import("@/lib/channels/send-message");
        const r = await sendToConversation(s.organization_id, s.conversation_id, s.body, s.kind === "scheduled" ? (s.created_by ?? undefined) : undefined, {
          meta: { schedule_id: s.id, scheduled: true, ...(s.kind === "sequence" ? { followup: true, step: s.step } : {}) },
        });
        await admin.rpc("finish_schedule", { p_id: s.id, p_status: r.ok ? "sent" : r.permanent ? "failed" : "pending", p_reason: r.ok ? null : (r.error ?? "send_failed").slice(0, 200), p_message: r.messageId ?? null });
        if (r.ok) out.sent++;
        else if (r.permanent) out.skipped++;
        else out.retried++;
        continue;
      }
      await admin.rpc("finish_schedule", { p_id: s.id, p_status: "skipped", p_reason: "empty" });
      out.skipped++;
    } catch (e) {
      console.error("schedule run failed", (e as Error).message);
      await admin.rpc("finish_schedule", { p_id: s.id, p_status: "pending", p_reason: "error" });
      out.retried++;
    }
  }
  return out;
}

/**
 * The customer wrote STOP / START: the database already updated the consent and
 * canceled everything planned (the message meta says what happened). Confirm once.
 * Returns true when the message was an opt-out / opt-in (the AI must not answer it).
 */
export async function confirmOptChange(conversationId: string, messageId: string): Promise<boolean> {
  const admin = createAdminClient();
  const { data: msg } = await admin.from("messages").select("meta").eq("id", messageId).maybeSingle();
  const opt = (msg?.meta as { opt?: string } | null)?.opt;
  if (opt !== "out" && opt !== "in") return false;
  const { data: conv } = await admin.from("conversations").select("organization_id").eq("id", conversationId).maybeSingle();
  if (!conv) return true;
  const { data: pol } = await admin.rpc("conversation_policy", { p_org: conv.organization_id });
  if ((pol as { opt_out_reply?: boolean } | null)?.opt_out_reply === false) return true;
  // at most one confirmation a day per conversation
  const since = new Date(Date.now() - 86_400_000).toISOString();
  const { data: recent } = await admin.from("messages").select("id").eq("conversation_id", conversationId).eq("direction", "out").gte("created_at", since).contains("meta", { system: `opt_${opt}` }).limit(1);
  if (recent?.length) return true;
  const { data: org } = await admin.from("organizations").select("locale").eq("id", conv.organization_id).maybeSingle();
  const { data: agent } = await admin.from("ai_agents").select("language").eq("organization_id", conv.organization_id).eq("enabled", true).order("created_at").limit(1).maybeSingle();
  const locale = (agent?.language as string | undefined) ?? (org?.locale as string | undefined) ?? "he";
  const { sendToConversation } = await import("@/lib/channels/send-message");
  await sendToConversation(conv.organization_id as string, conversationId, opt === "out" ? optOutConfirmation(locale) : optInConfirmation(locale), undefined, { meta: { system: `opt_${opt}` } });
  return true;
}
