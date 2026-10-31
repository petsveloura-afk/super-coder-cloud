"use server";

import { getOrgContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { dbErrorKey, type ActionState } from "@/lib/action-state";
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

/**
 * Wave 60 — "check & fix" the official WhatsApp number: asks Meta whether the number is registered on the
 * Cloud API and registers it when it is not (customers' messages then arrive and the agent can answer).
 * `pin` = the number's existing two-step PIN, only when Meta asks for it.
 */
export async function registerWhatsAppAction(input: { locale: string; pin?: string }): Promise<ActionState> {
  const locale = input.locale === "en" || input.locale === "ar" ? input.locale : "he";
  const ctx = await getOrgContext(locale);
  if (!ctx.can("integrations.manage")) return { error: "errors.forbidden" };
  const pin = String(input.pin ?? "").replace(/\D/g, "");
  if (pin && pin.length !== 6) return { error: "integrations.wa.pinInvalid" };
  const { loadAccount } = await import("@/lib/channels/accounts");
  const acc = await loadAccount(ctx.org.id, "whatsapp");
  if (!acc) return { error: "integrations.wa.notOfficial" };
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const { data: allowed } = await createAdminClient().rpc("public_rate_limit", { p_bucket: `wa-register:${ctx.org.id}`, p_limit: 8, p_window_seconds: 3600 });
  if (allowed === false) return { error: "errors.rateLimited" };
  // wave 60: recent "not registered" failures (team updates) mean Meta still refuses — register even if the
  // number reports CLOUD_API, and clear those errors once it works
  const { data: stale } = await createAdminClient().from("notify_recipients").select("id").eq("organization_id", ctx.org.id).eq("kind", "whatsapp").ilike("last_error", "%133010%").limit(1);
  const clearStale = async () => {
    await createAdminClient().from("notify_recipients").update({ last_error: null }).eq("organization_id", ctx.org.id).eq("kind", "whatsapp").ilike("last_error", "%133010%").then(() => undefined, () => undefined);
  };
  // already on the Cloud API? then nothing to fix
  try {
    const base = (process.env.WHATSAPP_API_BASE || "https://graph.facebook.com/v21.0").replace(/\/$/, "");
    const res = await fetch(`${base}/${encodeURIComponent(acc.config.phone_number_id ?? "")}?fields=platform_type,status,code_verification_status`, { headers: { Authorization: `Bearer ${acc.secrets.access_token ?? ""}` }, signal: AbortSignal.timeout(12_000), cache: "no-store" });
    const j = (await res.json().catch(() => ({}))) as { platform_type?: string; error?: { message?: string } };
    if (res.status === 401 || res.status === 403 || /token/i.test(j.error?.message ?? "")) return { error: "integrations.wa.tokenExpired" };
    if (!pin && j.platform_type === "CLOUD_API" && acc.status !== "error" && !(stale ?? []).length) {
      await createAdminClient().from("channel_accounts").update({ status: "active", last_error: null }).eq("id", acc.id);
      revalidatePath(`/${locale}/integrations`);
      return { ok: true, message: "integrations.wa.registeredOk" };
    }
  } catch {
    /* fall through to registering */
  }
  const { ensureRegistered, needsPin } = await import("@/lib/channels/wa-register");
  const r = await ensureRegistered(acc, pin || null);
  revalidatePath(`/${locale}/integrations`);
  if (r.ok) {
    await clearStale();
    return { ok: true, message: "integrations.wa.registeredOk" };
  }
  return { error: needsPin(r.error) ? "integrations.wa.needPin" : "integrations.wa.registerFailed" };
}
