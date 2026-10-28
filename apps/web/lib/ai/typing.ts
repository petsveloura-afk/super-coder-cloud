import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { AutopilotChannel } from "./autopilot-core";

/**
 * Speed upgrade — "typing…" from the first moment the agent decides to answer, kept alive until
 * the answer is sent (Telegram shows it ~5s per call, WhatsApp Cloud up to 25s, WhatsApp QR
 * until paused). The customer sees that someone is answering instead of silence. Never throws.
 *
 *  telegram       sendChatAction (bot chats and Telegram Business chats)
 *  whatsapp       Cloud API: mark the customer's message as read + typing indicator (blue ticks)
 *  whatsapp_qr    the bridge: presence "composing" / "paused"
 */
const active = new Map<string, () => void>();
const seen = new Set<string>();

export function stopTyping(conversationId: string): void {
  const stop = active.get(conversationId);
  if (stop) {
    active.delete(conversationId);
    try {
      stop();
    } catch {
      /* cosmetic */
    }
  }
}

export async function startTyping(input: { orgId: string; conversationId: string; channel: AutopilotChannel; externalId: string }): Promise<void> {
  if (active.has(input.conversationId)) return;
  if (!["telegram", "whatsapp", "whatsapp_qr", "messenger", "instagram"].includes(input.channel)) return;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const until = Date.now() + 75_000; // never "typing" for more than ~75s
  active.set(input.conversationId, () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    if (input.channel === "whatsapp_qr") void pulse(input, false).catch(() => undefined);
  });
  const every = input.channel === "telegram" ? 4500 : input.channel === "whatsapp" ? 20_000 : input.channel === "messenger" || input.channel === "instagram" ? 15_000 : 9000;
  const loop = async () => {
    if (stopped || Date.now() > until) return;
    await pulse(input, true).catch(() => undefined);
    if (!stopped) timer = setTimeout(() => void loop(), every);
  };
  void loop();
}

async function pulse(input: { orgId: string; conversationId: string; channel: AutopilotChannel; externalId: string }, on: boolean): Promise<void> {
  const { loadAccount } = await import("@/lib/channels/accounts");
  if (input.channel === "telegram") {
    if (!on) return;
    const { telegramCall } = await import("@/lib/channels/providers");
    const acc = await loadAccount(input.orgId, "telegram");
    if (!acc?.secrets.bot_token) return;
    if (input.externalId.startsWith("biz:")) {
      const { businessConnectionFor } = await import("@/lib/channels/send-message");
      const connection = await businessConnectionFor(input.orgId, input.externalId);
      if (connection) await telegramCall(acc.secrets.bot_token, "sendChatAction", { business_connection_id: connection, chat_id: input.externalId.slice(4), action: "typing" });
      return;
    }
    await telegramCall(acc.secrets.bot_token, "sendChatAction", { chat_id: input.externalId, action: "typing" });
    return;
  }
  if (input.channel === "messenger" || input.channel === "instagram") {
    // Meta sender actions: "seen" first, then "typing…" (lasts ~20s, renewed by the loop)
    if (!on) return;
    const acc = await loadAccount(input.orgId, input.channel);
    if (!acc?.secrets.page_token) return;
    const { metaSenderAction } = await import("@/lib/channels/meta-pages");
    if (!seen.has(input.conversationId)) {
      seen.add(input.conversationId);
      if (seen.size > 500) seen.clear();
      await metaSenderAction(acc.secrets.page_token, input.externalId, "mark_seen");
    }
    await metaSenderAction(acc.secrets.page_token, input.externalId, "typing_on");
    return;
  }
  if (input.channel === "whatsapp") {
    if (!on) return;
    const acc = await loadAccount(input.orgId, "whatsapp");
    if (!acc?.secrets.access_token || !acc.config.phone_number_id) return;
    const admin = createAdminClient();
    const { data: last } = await admin
      .from("messages")
      .select("external_id")
      .eq("conversation_id", input.conversationId)
      .eq("direction", "in")
      .not("external_id", "is", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const wamid = (last?.external_id as string | null) ?? null;
    if (!wamid) return;
    const base = (process.env.WHATSAPP_API_BASE || "https://graph.facebook.com/v21.0").replace(/\/$/, "");
    await fetch(`${base}/${encodeURIComponent(acc.config.phone_number_id)}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${acc.secrets.access_token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", status: "read", message_id: wamid, typing_indicator: { type: "text" } }),
      signal: AbortSignal.timeout(5000),
      cache: "no-store",
    });
    return;
  }
  if (input.channel === "whatsapp_qr") {
    const { bridgeConfigured, bridgeCall } = await import("@/lib/channels/wa-bridge");
    if (!bridgeConfigured()) return;
    const acc = await loadAccount(input.orgId, "whatsapp_qr");
    if (!acc) return;
    await bridgeCall(`/sessions/${acc.id}/typing`, { method: "POST", body: { to: input.externalId.replace(/[^\d]/g, ""), on } });
  }
}
