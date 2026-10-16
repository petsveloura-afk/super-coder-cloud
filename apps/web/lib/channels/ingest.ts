import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { kickJobs } from "@/lib/jobs/kick";

export interface InboundMessage {
  kind: "whatsapp" | "telegram" | "sms";
  token: string;
  chatId: string;
  senderName?: string | null;
  phone?: string | null;
  text: string;
  externalMessageId?: string | null;
  media?: Record<string, unknown> | null;
}

/** Stores an inbound message via the SECURITY DEFINER RPC (matches/creates contact + conversation). */
export async function ingest(m: InboundMessage) {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("ingest_channel_message", {
    p_token: m.token,
    p_kind: m.kind,
    p_external_chat: m.chatId,
    p_sender_name: m.senderName ?? null,
    p_phone: m.phone ?? null,
    p_text: m.text,
    p_external_message: m.externalMessageId ?? null,
    p_media: m.media ?? null,
  });
  if (error) console.error(`${m.kind} ingest failed`, error.message);
  else kickJobs();
  return { data, error };
}
