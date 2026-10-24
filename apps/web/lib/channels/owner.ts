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

/**
 * Wave 21 — the owner's phone sent a message: tell the owner typing (the agent steps back) from an
 * automatic greeting / away message or an echo of the agent's own reply (the agent keeps going).
 */
export async function ingestOwnerMessageSmart(input: { kind: "whatsapp_qr" | "telegram_user"; token: string; chat: string; text: string; messageId: string | null; media?: Record<string, unknown> | null; sentAtSec?: number | null }) {
  const admin = createAdminClient();
  const { classifyOwnerMessage } = await import("./owner-core");
  const { data: acc } = await admin.from("channel_accounts").select("organization_id").eq("webhook_token", input.token).eq("kind", input.kind).maybeSingle();
  const orgId = (acc?.organization_id as string | undefined) ?? null;
  let kind: "echo" | "auto" | "person" = "person";
  let reason = "owner_typed";
  if (orgId) {
    const { data: conv } = await admin.from("conversations").select("id").eq("organization_id", orgId).eq("channel", input.kind).eq("external_id", input.chat).maybeSingle();
    if (conv) {
      const since = new Date(Date.now() - 15 * 60_000).toISOString();
      const text = (input.text ?? "").slice(0, 8000);
      const [{ data: lastIn }, { data: agentRows }, { data: sameId }, { data: elsewhere }] = await Promise.all([
        admin.from("messages").select("created_at").eq("conversation_id", conv.id).eq("direction", "in").order("created_at", { ascending: false }).limit(1).maybeSingle(),
        admin.from("messages").select("body, external_id").eq("conversation_id", conv.id).eq("direction", "out").not("ai_agent_id", "is", null).gt("created_at", since).order("created_at", { ascending: false }).limit(10),
        input.messageId ? admin.from("messages").select("id").eq("conversation_id", conv.id).eq("external_id", input.messageId.slice(0, 200)).limit(1).maybeSingle() : Promise.resolve({ data: null }),
        text.trim().length >= 6
          ? admin.from("messages").select("id").eq("organization_id", orgId).eq("direction", "out").eq("body", text).neq("conversation_id", conv.id).contains("meta", { owner: true }).gt("created_at", new Date(Date.now() - 30 * 86_400_000).toISOString()).limit(1).maybeSingle()
          : Promise.resolve({ data: null }),
      ]);
      if (sameId) return { data: { ok: true, duplicate: true, kind: "echo" }, error: null };
      const sentAtMs = typeof input.sentAtSec === "number" && input.sentAtSec > 0 ? input.sentAtSec * 1000 : null;
      const verdict = classifyOwnerMessage({
        text,
        sentAtMs,
        arrivedAtMs: Date.now(),
        lastInboundAtMs: lastIn?.created_at ? new Date(lastIn.created_at as string).getTime() : null,
        recentAgentTexts: ((agentRows ?? []) as { body: string | null }[]).map((r) => r.body ?? ""),
        seenInOtherChats: Boolean(elsewhere),
      });
      kind = verdict.kind;
      reason = verdict.reason;
    }
  }
  if (kind === "echo") return { data: { ok: true, ignored: true, kind, reason }, error: null };
  const { data, error } = await admin.rpc("ingest_owner_message_v2", {
    p_token: input.token,
    p_kind: input.kind,
    p_chat: input.chat,
    p_text: input.text.slice(0, 8000),
    p_message: input.messageId,
    p_media: input.media ?? null,
    p_takeover: kind === "person",
    p_auto: kind === "auto" ? reason : null,
  });
  if (error) {
    // the wave-21 migration has not run yet → the wave-12 behaviour
    if (/ingest_owner_message_v2|function .* does not exist|PGRST202/i.test(error.message)) return ingestOwnerMessage(input);
    console.error(`${input.kind} owner message failed`, error.message);
  }
  return { data: data ? { ...(data as Record<string, unknown>), kind, reason } : data, error };
}
