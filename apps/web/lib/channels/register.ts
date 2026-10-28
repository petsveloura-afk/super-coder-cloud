import "server-only";
import { registerChannel } from "./index";
import { sendToContact } from "./send-message";

/**
 * Registers the messaging adapters used by queued automation jobs
 * (send_whatsapp / send_telegram / send_sms). A channel that is not connected
 * fails permanently with "channel_not_connected" (visible in the automation log).
 */
for (const kind of ["whatsapp", "telegram", "sms", "messenger", "instagram"] as const) {
  registerChannel(kind, async ({ organizationId, contactId, text }) => {
    const r = await sendToContact(kind, organizationId, contactId, text);
    return { ok: r.ok, status: r.status, error: r.error, permanent: r.permanent, externalId: r.messageId };
  });
}

export {};
