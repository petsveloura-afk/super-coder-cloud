import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadAccount } from "./accounts";
import { whatsappSendTemplate } from "./providers";
import { toE164 } from "./secrets";

/**
 * Wave 17 — campaigns on the official WhatsApp API must use an approved template when the
 * customer has not written in the last 24 hours. Sends the template and records the
 * message in the customer's WhatsApp conversation (the inbox shows what was sent).
 */
export async function sendWhatsAppTemplate(
  orgId: string,
  contactId: string,
  tpl: { name: string; language: string; params: string[] },
  preview: string,
): Promise<{ ok: boolean; status?: number; error?: string; permanent?: boolean; usedTemplate: boolean }> {
  const acc = await loadAccount(orgId, "whatsapp");
  // no official account (QR / not connected) → the caller sends plain text instead
  if (!acc?.secrets.access_token || !acc.config.phone_number_id) return { ok: false, usedTemplate: false, error: "no_official_whatsapp" };
  const admin = createAdminClient();
  const { data: contact } = await admin.from("contacts").select("id, first_name, last_name, phone").eq("id", contactId).eq("organization_id", orgId).maybeSingle();
  const e164 = toE164((contact?.phone as string | null) ?? null);
  if (!contact || !e164) return { ok: false, usedTemplate: true, error: "contact_has_no_phone", permanent: true };
  const r = await whatsappSendTemplate(acc.secrets.access_token, acc.config.phone_number_id, e164, tpl.name, tpl.language, tpl.params);
  const { data: conv } = await admin
    .from("conversations")
    .upsert({ organization_id: orgId, channel: "whatsapp", external_id: e164.slice(1), contact_id: contactId, title: `${contact.first_name ?? ""} ${contact.last_name ?? ""}`.trim() || e164 }, { onConflict: "organization_id,channel,external_id" })
    .select("id")
    .single();
  if (conv) {
    await admin.from("messages").insert({
      organization_id: orgId,
      conversation_id: conv.id,
      direction: "out",
      body: preview.slice(0, 8000),
      status: r.ok ? "sent" : "failed",
      external_id: r.externalId ?? null,
      error: r.ok ? null : (r.error ?? "send_failed").slice(0, 500),
      meta: { template: tpl.name, campaign: true },
    });
    if (r.ok) await admin.from("conversations").update({ last_message_at: new Date().toISOString(), last_message_preview: `📣 ${preview}`.slice(0, 200) }).eq("id", conv.id);
  }
  return { ok: r.ok, status: r.status, error: r.error, permanent: r.permanent, usedTemplate: true };
}
