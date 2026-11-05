"use server";

import { uuidSchema } from "@scc/shared/validators";
import { getOrgContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ActionState } from "@/lib/action-state";
import { feedbackRow, parseFeedback } from "@/lib/ai/reply-feedback-core";

/**
 * Wave 69 — 👍/👎 on an agent's reply. Written to the audit log (no new table). The message must belong to the caller's
 * business and must be one the agent wrote; the person needs the right to reply in the inbox.
 */
const loc = (l: unknown) => (l === "ar" || l === "en" ? l : "he") as "he" | "ar" | "en";

export async function rateReplyAction(input: { locale: string; messageId: string; rating: string; reason?: string }): Promise<ActionState> {
  try {
    const locale = loc(input.locale);
    const ctx = await getOrgContext(locale);
    if (!ctx.can("inbox.reply")) return { error: "errors.forbidden" };
    const id = uuidSchema.safeParse(input.messageId);
    if (!id.success) return { error: "validation.invalidId" };
    const parsed = parseFeedback({ rating: input.rating, reason: input.reason });
    if (!parsed.ok) return { error: "errors.generic" };
    const supabase = await createClient();
    const { data: msg } = await supabase.from("messages").select("id, conversation_id, ai_agent_id").eq("organization_id", ctx.org.id).eq("id", id.data).maybeSingle();
    const m = msg as { id: string; conversation_id: string | null; ai_agent_id: string | null } | null;
    if (!m || !m.ai_agent_id) return { error: "errors.generic" };
    const { error } = await createAdminClient().from("audit_logs").insert(feedbackRow({ orgId: ctx.org.id, actorId: ctx.userId, messageId: m.id, conversationId: m.conversation_id, agentId: m.ai_agent_id, rating: parsed.rating, reason: parsed.reason }));
    if (error) return { error: "errors.generic" };
    return { ok: true, message: "aiQuality.feedback.saved" };
  } catch {
    return { error: "errors.generic" };
  }
}
