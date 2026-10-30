import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Wave 57 — "call me now": the agent calls a number the business owner types (their own phone) so they
 * can hear it before customers do. Works with the business's own Twilio account or its platform number.
 */
export async function testCallTo(orgId: string, phoneRaw: string): Promise<{ ok: boolean; error?: string }> {
  const { toE164 } = await import("@/lib/channels/secrets");
  const to = toE164(phoneRaw);
  if (!to) return { ok: false, error: "voice.noPhone" };
  const admin = createAdminClient();
  const { data: has } = await admin.rpc("has_feature", { p_org: orgId, p_feature: "voice_ai" });
  if (has !== true) return { ok: false, error: "plans.locked.voice_ai.title" };
  const { twilioCredsForOrg, platformMinutes, platformUrls } = await import("./platform-phone");
  const cr = await twilioCredsForOrg(orgId);
  if (!cr) return { ok: false, error: "phone.noNumber" };
  if (cr.via === "platform" && (await platformMinutes(orgId)).left === 0) return { ok: false, error: "phone.minutesUsed" };
  const { openVoiceCall, twilioCall, voiceWebhookUrl } = await import("./agent");
  const call = await openVoiceCall({ orgId, direction: "out", from: cr.from, to, callSid: null });
  if (cr.via === "platform") await admin.from("voice_calls").update({ via: "platform" }).eq("id", call.id);
  const params =
    cr.via === "platform"
      ? { To: to, From: cr.from, Url: platformUrls().turn(call.id), Method: "POST", StatusCallback: platformUrls().status, StatusCallbackMethod: "POST" }
      : { To: to, From: cr.from, Url: voiceWebhookUrl(cr.webhookToken ?? "", `/turn?call=${call.id}`), Method: "POST", StatusCallback: voiceWebhookUrl(cr.webhookToken ?? "", "/status"), StatusCallbackMethod: "POST" };
  const r = await twilioCall(cr.sid, cr.token, params);
  if (!r.ok) {
    await admin.from("voice_calls").update({ status: "failed" }).eq("id", call.id);
    return { ok: false, error: "voice.callFailed" };
  }
  await admin.from("voice_calls").update({ call_sid: r.sid ?? null, status: "ringing" }).eq("id", call.id);
  return { ok: true };
}
