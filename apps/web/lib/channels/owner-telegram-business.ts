import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { classifyOwnerMessage } from "./owner-core";

/**
 * Wave 57 — Telegram Business: is this message from the owner's account automatic (an instant reply,
 * a template, an echo of the agent's own answer)? Then the agent keeps the conversation. Uses the same
 * pure rules as WhatsApp by QR / personal Telegram (classifyOwnerMessage). Never throws.
 */
export async function ownerMessageIsAutomatic(input: { token: string; chatId: number; text: string; sentAtSec: number | null }): Promise<boolean> {
  try {
    const admin = createAdminClient();
    const { data: acc } = await admin.from("channel_accounts").select("organization_id").eq("webhook_token", input.token).eq("kind", "telegram").maybeSingle();
    if (!acc) return false;
    const { data: conv } = await admin.from("conversations").select("id").eq("organization_id", acc.organization_id as string).eq("channel", "telegram").eq("external_id", `biz:${input.chatId}`).maybeSingle();
    if (!conv) return false;
    const since = new Date(Date.now() - 15 * 60_000).toISOString();
    const [{ data: lastIn }, { data: agentRows }] = await Promise.all([
      admin.from("messages").select("created_at").eq("conversation_id", conv.id).eq("direction", "in").order("created_at", { ascending: false }).limit(1).maybeSingle(),
      admin.from("messages").select("body").eq("conversation_id", conv.id).eq("direction", "out").not("ai_agent_id", "is", null).gt("created_at", since).order("created_at", { ascending: false }).limit(10),
    ]);
    const verdict = classifyOwnerMessage({
      text: input.text,
      sentAtMs: input.sentAtSec ? input.sentAtSec * 1000 : null,
      arrivedAtMs: Date.now(),
      lastInboundAtMs: lastIn?.created_at ? new Date(lastIn.created_at as string).getTime() : null,
      recentAgentTexts: ((agentRows ?? []) as { body: string | null }[]).map((r) => r.body ?? ""),
      seenInOtherChats: false,
    });
    return verdict.kind !== "person";
  } catch {
    return false;
  }
}
