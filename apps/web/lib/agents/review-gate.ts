import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { GATE_DAYS, isPositive, negativeReply, parseRating, positiveReply, ratingQuestion } from "./review-gate-core";

/**
 * Wave 59 — smart review requests: "how was it? (1–5)" first; happy customers get the review link, unhappy
 * ones get an apology and the owner is alerted right away. Never throws; before the migration ran it
 * returns null and the classic review request is sent as before.
 */
export async function openReviewGate(input: { orgId: string; contactId: string; reviewUrl: string | null; locale: string; name: string | null; org: string }): Promise<string | null> {
  try {
    const { error } = await createAdminClient().from("review_gates").insert({ organization_id: input.orgId, contact_id: input.contactId, review_url: input.reviewUrl && /^https:\/\//.test(input.reviewUrl) ? input.reviewUrl : null });
    if (error) return null;
    return ratingQuestion(input.locale, { name: input.name, org: input.org });
  } catch {
    return null;
  }
}

/**
 * The customer answered the rating question → the right reply (no AI call). Returns the text that was
 * sent, or null when this message is not an answer to an open review question.
 */
export async function handleReviewReply(input: { orgId: string; contactId: string | null; conversationId: string; text: string; locale: string; agentId: string; channel: string }): Promise<string | null> {
  if (!input.contactId) return null;
  try {
    const admin = createAdminClient();
    const since = new Date(Date.now() - GATE_DAYS * 86_400_000).toISOString();
    const { data: gate, error } = await admin.from("review_gates").select("id, review_url").eq("organization_id", input.orgId).eq("contact_id", input.contactId).eq("status", "asked").gte("created_at", since).order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (error || !gate) return null;
    const rating = parseRating(input.text);
    if (rating === null) return null;
    const positive = isPositive(rating);
    const { data: updated } = await admin
      .from("review_gates")
      .update({ status: positive ? "positive" : "negative", rating, answered_at: new Date().toISOString() })
      .eq("id", gate.id)
      .eq("status", "asked")
      .select("id")
      .maybeSingle();
    if (!updated) return null; // answered already (two quick messages)
    const reply = positive ? positiveReply(input.locale, (gate.review_url as string | null) ?? null) : negativeReply(input.locale);
    const { sendToConversation } = await import("@/lib/channels/send-message");
    const { formatForChannel } = await import("@/lib/ai/autopilot-core");
    await sendToConversation(input.orgId, input.conversationId, formatForChannel(reply, input.channel as never), undefined, { aiAgentId: input.agentId, meta: { system: "review_gate", rating } });
    if (!positive) {
      // the owner takes it personally: notification (and push) + the conversation goes to the team
      const { notifyOwners } = await import("./run");
      await notifyOwners(input.orgId, "reviewGate.negativeNotification", { rating: String(rating) }, `/inbox?c=${input.conversationId}`).catch(() => undefined);
      await admin.rpc("ai_handoff", { p_conv: input.conversationId, p_reason: "review_negative" }).then(() => undefined, () => undefined);
    }
    return reply;
  } catch (e) {
    console.error("review gate failed", (e as Error).message);
    return null;
  }
}
