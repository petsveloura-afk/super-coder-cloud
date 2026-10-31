import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { MISSED_WINDOW_MIN, isMissedCall, missedCallText } from "./missed-call-core";

/**
 * Wave 59 — a missed call becomes a written conversation within seconds: the caller gets a WhatsApp
 * message (SMS as the fallback) and the AI agent continues from there. On by default; the business can
 * turn it off or write its own text on the phone screen. Never throws.
 */
export async function missedCallTextBack(input: { orgId: string; callerPhone: string; reason: string }): Promise<{ sent: boolean; channel?: string }> {
  try {
    const { loadPhoneSettings } = await import("./phone-settings");
    const settings = await loadPhoneSettings(input.orgId);
    if (!settings.missed_text) return { sent: false };
    const { toE164 } = await import("@/lib/channels/secrets");
    const phone = toE164(input.callerPhone);
    if (!phone) return { sent: false };
    const admin = createAdminClient();
    const { data: allowed } = await admin.rpc("public_rate_limit", { p_bucket: `missed:${input.orgId}:${phone}`, p_limit: 1, p_window_seconds: MISSED_WINDOW_MIN * 60 });
    if (allowed === false) return { sent: false };
    const local = phone.replace(/^\+972/, "0");
    const { data: existing } = await admin.from("contacts").select("id").eq("organization_id", input.orgId).or(`phone.eq.${phone},phone.eq.${local}`).order("created_at").limit(1).maybeSingle();
    let contactId = (existing?.id as string | undefined) ?? null;
    if (!contactId) {
      const { data: created } = await admin.from("contacts").insert({ organization_id: input.orgId, first_name: phone.slice(0, 80), phone, source: "phone" }).select("id").single();
      contactId = (created?.id as string | undefined) ?? null;
    }
    if (!contactId) return { sent: false };
    const { checkContact } = await import("@/lib/conversations/guard");
    if (!(await checkContact(contactId, "automation")).allowed) return { sent: false };
    const { data: org } = await admin.from("organizations").select("name, locale").eq("id", input.orgId).maybeSingle();
    const text = missedCallText(String(org?.locale ?? "he"), String(org?.name ?? ""), settings.missed_message);
    const { sendToContact } = await import("@/lib/channels/send-message");
    for (const kind of ["whatsapp_qr", "whatsapp", "sms"] as const) {
      const r = await sendToContact(kind, input.orgId, contactId, text).catch(() => ({ ok: false }));
      if (r.ok) return { sent: true, channel: kind };
    }
    return { sent: false };
  } catch (e) {
    console.error("missed call text-back failed", (e as Error).message);
    return { sent: false };
  }
}

/** Status callback helper: was this call missed? → text back (the call row tells direction / turns). */
export async function afterCallEnded(input: { orgId: string; callId: string; status: string; duration: number | null }): Promise<void> {
  try {
    const { data: call } = await createAdminClient().from("voice_calls").select("direction, from_number, turns").eq("id", input.callId).maybeSingle();
    if (!call) return;
    const callerTurns = ((call.turns as { role?: string }[] | null) ?? []).filter((t) => t.role === "caller").length;
    if (isMissedCall({ direction: String(call.direction), status: input.status, duration: input.duration, callerTurns })) {
      await missedCallTextBack({ orgId: input.orgId, callerPhone: String(call.from_number ?? ""), reason: input.status });
    }
  } catch {
    /* best effort */
  }
}
