"use server";

import { getOrgContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { dbErrorKey } from "@/lib/action-state";
import type { QrState } from "./actions";

/**
 * Wave 20 — WhatsApp "link with phone number": for the phone that shows this page (it can't scan
 * its own screen). The bridge asks WhatsApp for an 8-character code; the person types it on the
 * phone under Linked devices → Link a device → Link with phone number instead.
 */
export async function pairWhatsAppAction(input: { locale: string; phone: string }): Promise<QrState> {
  const locale = input.locale === "ar" || input.locale === "en" ? input.locale : "he";
  const ctx = await getOrgContext(locale);
  if (!ctx.can("integrations.manage")) return { status: "error", error: "errors.forbidden" };
  const { bridgeConfigured, bridgePair } = await import("@/lib/channels/wa-bridge");
  if (!bridgeConfigured()) return { status: "not_configured" };
  const phone = String(input.phone ?? "").trim().slice(0, 32);
  if (!/^[\d+\-\s()]{8,32}$/.test(phone)) return { status: "error", error: "integrations.wa.badPhone" };
  const supabase = await createClient();
  let { data: acc } = await supabase.from("channel_accounts").select("id, webhook_token").eq("organization_id", ctx.org.id).eq("kind", "whatsapp_qr").maybeSingle();
  if (!acc) {
    const { data, error } = await supabase
      .from("channel_accounts")
      .insert({ organization_id: ctx.org.id, kind: "whatsapp_qr", name: "WhatsApp", status: "active", config: { state: "starting" }, created_by: ctx.userId })
      .select("id, webhook_token")
      .single();
    if (error || !data) return { status: "error", error: error ? dbErrorKey(error) : "errors.generic" };
    acc = data;
  }
  const st = await bridgePair(acc.id as string, acc.webhook_token as string, phone);
  if (st.status === "error") return { status: "error", error: st.error === "invalid_phone" ? "integrations.wa.badPhone" : "integrations.wa.codeFailed" };
  return { status: st.status, qr: null, phone: st.phone ?? null, error: null, code: st.code ?? null };
}
