import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { publicEnv } from "@/lib/env";
import { notifyEmailHtml, notifySubject, notifyTelegramHtml, notifyText, type NotifyEvent, type NotifyPayload } from "./format";

/**
 * Sends a team update (conversation the agent handled, new lead, handoff) to
 * every recipient the business invited: e-mail, Telegram (the business's own
 * bot), WhatsApp (QR bridge or official API) or SMS (Twilio). Never throws.
 */
export interface RecipientRow {
  id: string;
  kind: "email" | "telegram" | "whatsapp" | "sms";
  target: string | null;
  label: string | null;
  events: string[];
}

export function inboxLink(conversationId?: string | null) {
  const base = publicEnv.appUrl.replace(/\/$/, "");
  return conversationId ? `${base}/he/inbox?c=${conversationId}` : `${base}/he/inbox`;
}

export async function sendToRecipient(orgId: string, r: RecipientRow, event: NotifyEvent, payload: NotifyPayload): Promise<{ ok: boolean; error?: string }> {
  if (!r.target) return { ok: false, error: "not_linked" };
  try {
    if (r.kind === "email") {
      const { sendEmail } = await import("@/lib/email/send");
      const res = await sendEmail({ to: r.target, subject: notifySubject(event, payload), html: notifyEmailHtml(event, payload), text: notifyText(event, payload) });
      return res.sent ? { ok: true } : { ok: false, error: res.reason === "not_configured" ? "email_not_configured" : "email_failed" };
    }
    const { loadAccount } = await import("@/lib/channels/accounts");
    if (r.kind === "telegram") {
      const acc = await loadAccount(orgId, "telegram");
      if (!acc?.secrets.bot_token) return { ok: false, error: "telegram_bot_not_connected" };
      const { telegramCall } = await import("@/lib/channels/providers");
      const res = await telegramCall(acc.secrets.bot_token, "sendMessage", { chat_id: r.target, text: notifyTelegramHtml(event, payload), parse_mode: "HTML", link_preview_options: { is_disabled: true } });
      return res.ok ? { ok: true } : { ok: false, error: res.error ?? "telegram_failed" };
    }
    if (r.kind === "whatsapp") {
      const qr = await loadAccount(orgId, "whatsapp_qr");
      if (qr) {
        const { bridgeSend } = await import("@/lib/channels/wa-bridge");
        const res = await bridgeSend(qr, r.target, notifyText(event, payload));
        if (res.ok) return { ok: true };
      }
      const wa = await loadAccount(orgId, "whatsapp");
      if (!wa) return { ok: false, error: "whatsapp_not_connected" };
      const { whatsappSendText } = await import("@/lib/channels/providers");
      const res = await whatsappSendText(wa.secrets.access_token ?? "", wa.config.phone_number_id ?? "", r.target, notifyText(event, payload));
      return res.ok ? { ok: true } : { ok: false, error: res.error ?? "whatsapp_failed" };
    }
    const sms = await loadAccount(orgId, "sms");
    if (!sms) return { ok: false, error: "sms_not_connected" };
    const { twilioSendSms } = await import("@/lib/channels/providers");
    const res = await twilioSendSms(sms.config.account_sid ?? "", sms.secrets.auth_token ?? "", sms.config.from_number ?? "", r.target, notifyText(event, payload, { short: true }));
    return res.ok ? { ok: true } : { ok: false, error: res.error ?? "sms_failed" };
  } catch (e) {
    return { ok: false, error: (e as Error).message?.slice(0, 200) ?? "failed" };
  }
}

export async function forwardToTeam(orgId: string, event: NotifyEvent, payload: Omit<NotifyPayload, "orgName"> & { orgName?: string; conversationId?: string | null; excludeTarget?: string | null }): Promise<number> {
  try {
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return 0;
    const admin = createAdminClient();
    const { data } = await admin
      .from("notify_recipients")
      .select("id, kind, target, label, events")
      .eq("organization_id", orgId)
      .eq("enabled", true)
      .not("target", "is", null)
      .contains("events", [event])
      .limit(20);
    const rows = (data ?? []) as RecipientRow[];
    if (!rows.length) return 0;
    let orgName = payload.orgName;
    if (!orgName) {
      const { data: org } = await admin.from("organizations").select("name").eq("id", orgId).maybeSingle();
      orgName = (org?.name as string | undefined) ?? "";
    }
    const full: NotifyPayload = { ...payload, orgName, link: payload.link ?? inboxLink(payload.conversationId) };
    let sent = 0;
    await Promise.all(
      rows
        .filter((r) => !payload.excludeTarget || r.target !== payload.excludeTarget)
        .map(async (r) => {
          const res = await sendToRecipient(orgId, r, event, full);
          if (res.ok) sent++;
          await admin
            .from("notify_recipients")
            .update(res.ok ? { last_sent_at: new Date().toISOString(), last_error: null } : { last_error: (res.error ?? "failed").slice(0, 300) })
            .eq("id", r.id);
          if (res.ok) await admin.rpc("notify_recipient_sent", { p_id: r.id }).then(() => undefined, () => undefined);
        }),
    );
    return sent;
  } catch (e) {
    console.error("team update failed", (e as Error).message);
    return 0;
  }
}

/** Fire-and-forget after the response (never delays the customer's answer). */
export function forwardLater(orgId: string, event: NotifyEvent, payload: Parameters<typeof forwardToTeam>[2]) {
  void forwardToTeam(orgId, event, payload);
}
