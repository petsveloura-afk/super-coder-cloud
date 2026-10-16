import "server-only";

/**
 * Messaging channels used by automations and the inbox (WhatsApp, Telegram, SMS).
 * Each adapter returns { ok } or { ok:false, error, permanent } — permanent errors
 * (channel not connected, contact has no number) are not retried by the job queue.
 */
export type ChannelKind = "whatsapp" | "telegram" | "sms";

export interface SendResult {
  ok: boolean;
  status?: number;
  error?: string;
  permanent?: boolean;
  externalId?: string;
}

export type ChannelSender = (input: { organizationId: string; contactId: string; text: string }) => Promise<SendResult>;

const registry = new Map<ChannelKind, ChannelSender>();

export function registerChannel(kind: ChannelKind, sender: ChannelSender) {
  registry.set(kind, sender);
}

export async function sendViaChannel(kind: ChannelKind, input: { organizationId: string; contactId: string; text: string }): Promise<SendResult> {
  const sender = registry.get(kind);
  if (!sender) return { ok: false, error: "channel_not_connected", permanent: true };
  return sender(input);
}
