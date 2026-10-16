import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Wave 12 — a message the account owner typed himself on his phone (WhatsApp QR /
 * personal Telegram). Stored as an outgoing message (meta.owner) in the customer's
 * conversation; the conversation switches to the person (ai_mode = human) so the
 * agent never talks over the owner. The agent may come back after the
 * "resume after N minutes" set in the agent setup (see ai_owner_resume).
 */
export async function ingestOwnerMessage(input: { kind: "whatsapp_qr" | "telegram_user"; token: string; chat: string; text: string; messageId: string | null; media?: Record<string, unknown> | null }) {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("ingest_owner_message", {
    p_token: input.token,
    p_kind: input.kind,
    p_chat: input.chat,
    p_text: input.text.slice(0, 8000),
    p_message: input.messageId,
    p_media: input.media ?? null,
  });
  if (error) console.error(`${input.kind} owner message failed`, error.message);
  return { data, error };
}

/**
 * When the conversation is with the person (ai_mode = human) because the owner wrote
 * himself, and the agent's "resume after" time has passed without the owner (or the
 * team in the app) writing again, the agent takes the conversation back.
 */
export async function maybeResumeAgent(conversationId: string, minutes: number | null | undefined): Promise<boolean> {
  if (!minutes || minutes <= 0) return false;
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("ai_owner_resume", { p_conversation: conversationId, p_minutes: Math.min(10080, Math.round(minutes)) });
  if (error) {
    console.error("ai_owner_resume failed", error.message);
    return false;
  }
  return data === true;
}
