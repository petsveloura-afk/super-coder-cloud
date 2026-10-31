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
  const { ensureRegistered, needsPin, explainRegisterError } = await import("@/lib/channels/wa-register");
  const r = await ensureRegistered(acc, pin || null);
  revalidatePath(`/${locale}/integrations`);
  // wave 61: say exactly why Meta refused (coexistence not finished, too many attempts, missing permission …)
  const why = !r.ok ? explainRegisterError(r.error) : null;
  if (why && !needsPin(r.error)) return { error: why, messageParams: { detail: String(r.error ?? "").slice(0, 200) } };
  if (r.ok) {
    await clearStale();
    return { ok: true, message: "integrations.wa.registeredOk" };
  }
  return { error: needsPin(r.error) ? "integrations.wa.needPin" : "integrations.wa.registerFailedDetail", messageParams: { detail: String(r.error ?? "").slice(0, 200) } };
}

/**
 * Wave 61 — "what does Meta say about my number?": the official number's real state, in plain words, so the
 * owner sees what is missing (registration, display-name approval, business verification, coexistence).
 */
export async function diagnoseWhatsAppAction(input: { locale: string }): Promise<ActionState<{ rows: { key: string; value: string; ok: boolean | null }[] }>> {
  const locale = input.locale === "en" || input.locale === "ar" ? input.locale : "he";
  const ctx = await getOrgContext(locale);
  if (!ctx.can("integrations.manage")) return { error: "errors.forbidden" };
  const { loadAccount } = await import("@/lib/channels/accounts");
  const acc = await loadAccount(ctx.org.id, "whatsapp");
  if (!acc) return { error: "integrations.wa.notOfficial" };
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const { data: allowed } = await createAdminClient().rpc("public_rate_limit", { p_bucket: `wa-diag:${ctx.org.id}`, p_limit: 20, p_window_seconds: 3600 });
  if (allowed === false) return { error: "errors.rateLimited" };
  const base = (process.env.WHATSAPP_API_BASE || "https://graph.facebook.com/v21.0").replace(/\/$/, "");
  try {
    const res = await fetch(`${base}/${encodeURIComponent(acc.config.phone_number_id ?? "")}?fields=display_phone_number,verified_name,platform_type,status,code_verification_status,name_status,quality_rating,account_mode,messaging_limit_tier,is_official_business_account`, { headers: { Authorization: `Bearer ${acc.secrets.access_token ?? ""}` }, signal: AbortSignal.timeout(12_000), cache: "no-store" });
    const j = (await res.json().catch(() => ({}))) as Record<string, unknown> & { error?: { message?: string } };
    if (res.status === 401 || res.status === 403 || /token|session/i.test(j.error?.message ?? "")) return { error: "integrations.wa.tokenExpired" };
    if (!res.ok) return { error: "integrations.wa.diagFailed", messageParams: { detail: String(j.error?.message ?? res.status).slice(0, 200) } };
    const { waDiagnosis } = await import("@/lib/channels/wa-register-core");
    return { ok: true, data: { rows: waDiagnosis(j) } };
  } catch (e) {
    return { error: "integrations.wa.diagFailed", messageParams: { detail: (e as Error).message.slice(0, 200) } };
  }
}
