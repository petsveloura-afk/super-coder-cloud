import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Conversation guard — every automated message asks here first (AI reply, follow-up,
 * scheduled message, sequence, campaign, automation, reminder). One state for all
 * channels of the same customer: consent, ownership, "a person already answered",
 * attempts, gaps, caps and the 24-hour windows (SQL outbound_guard).
 * Before the migration exists the call is allowed (old behaviour); any other error
 * blocks automated messages (safe side).
 */
export type GuardKind = "ai_reply" | "followup" | "scheduled" | "sequence" | "campaign" | "automation" | "reminder" | "human";
export interface GuardDecision {
  allowed: boolean;
  reason: string;
  opt_out?: boolean;
}

export async function checkGuard(conversationId: string, kind: GuardKind, scheduleId?: string | null): Promise<GuardDecision> {
  const { data, error } = await createAdminClient().rpc("outbound_guard", { p_conversation: conversationId, p_kind: kind, p_schedule: scheduleId ?? null, p_log: true });
  if (error) {
    if (error.code === "PGRST202" || /outbound_guard/.test(error.message ?? "") && /not find|does not exist/i.test(error.message ?? "")) return { allowed: true, reason: "guard_missing" };
    console.error("outbound_guard failed", error.message);
    return { allowed: kind === "human", reason: "guard_error" };
  }
  const d = (data ?? {}) as GuardDecision;
  return { allowed: Boolean(d.allowed), reason: d.reason ?? "unknown", opt_out: d.opt_out };
}

export async function checkContact(contactId: string, kind: GuardKind): Promise<GuardDecision> {
  const { data, error } = await createAdminClient().rpc("contact_can_receive", { p_contact: contactId, p_kind: kind });
  if (error) {
    if (error.code === "PGRST202") return { allowed: true, reason: "guard_missing" };
    console.error("contact_can_receive failed", error.message);
    return { allowed: false, reason: "guard_error" };
  }
  const d = (data ?? {}) as GuardDecision;
  return { allowed: Boolean(d.allowed), reason: d.reason ?? "unknown" };
}
