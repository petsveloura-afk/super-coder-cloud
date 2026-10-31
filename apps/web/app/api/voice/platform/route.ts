import type { NextRequest } from "next/server";
import { NextResponse, after } from "next/server";
import { platformVoiceRequest, twimlResponse } from "@/lib/voice/platform-request";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Wave 57 — POST /api/voice/platform: a call to a business's PLATFORM number (the business never touched
 * Twilio). Same agent as on an own Twilio number: live call when the bridge supports it, otherwise turn by
 * turn in the agent's own voice. Platform minutes are metered per business.
 */
export async function POST(request: NextRequest) {
  const v = await platformVoiceRequest(request, "");
  if (v instanceof NextResponse) return v;
  const { orgForCalledNumber, platformMinutes, platformUrls } = await import("@/lib/voice/platform-phone");
  const { sayTwiml, gatherTwiml, gatherPlayTwiml } = await import("@/lib/voice/twiml");
  const orgId = await orgForCalledNumber(v.form.To ?? "");
  if (!orgId) return twimlResponse(sayTwiml("המספר אינו פעיל כרגע. תודה ולהתראות.", "he"));
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const admin = createAdminClient();
  const [{ data: has }, { data: org }] = await Promise.all([admin.rpc("has_feature", { p_org: orgId, p_feature: "voice_ai" }), admin.from("organizations").select("locale").eq("id", orgId).maybeSingle()]);
  const locale = (org?.locale as string | undefined) ?? "he";
  const closed = locale === "en" ? "Thank you for calling. Please send us a message and we will get back to you." : locale === "ar" ? "شكراً لاتصالك. أرسل لنا رسالة وسنعود إليك قريباً." : "תודה שהתקשרת. אפשר לשלוח לנו הודעה ונחזור אליך בהקדם.";
  // wave 59: a call the agent cannot take is a missed call → the caller gets a WhatsApp / SMS right away
  const textBack = () => after(async () => (await import("@/lib/voice/missed-call")).missedCallTextBack({ orgId, callerPhone: v.form.From ?? "", reason: "unavailable" }));
  if (has !== true) {
    textBack();
    return twimlResponse(sayTwiml(closed, locale));
  }
  const minutes = await platformMinutes(orgId);
  if (minutes.left === 0) {
    textBack();
    return twimlResponse(sayTwiml(closed, locale));
  }
  const { openVoiceCall, voiceTurn } = await import("@/lib/voice/agent");
  const call = await openVoiceCall({ orgId, direction: "in", from: v.form.From ?? "", to: v.form.To ?? "", callSid: v.form.CallSid ?? null });
  await admin.from("voice_calls").update({ via: "platform" }).eq("id", call.id).then(() => undefined, () => undefined);
  // wave 59: recording (when the business turned it on)
  if (v.form.CallSid) after(async () => void (await (await import("@/lib/voice/recording")).maybeRecordCall(orgId, call.id, v.form.CallSid ?? "")));
  const { realtimeVoiceReady, liveCallTwiml } = await import("@/lib/voice/realtime");
  if (await realtimeVoiceReady()) {
    const live = liveCallTwiml(call.id, locale);
    if (live) {
      await admin.from("voice_calls").update({ mode: "realtime" }).eq("id", call.id).then(() => undefined, () => undefined);
      return twimlResponse(live);
    }
  }
  const turn = await voiceTurn({ orgId, callId: call.id, conversationId: call.conversationId, callerText: "", locale });
  const { phoneClipUrl } = await import("@/lib/voice/phone-tts");
  const clip = await phoneClipUrl(orgId, turn.say, locale).catch(() => null);
  const action = platformUrls().turn(call.id);
  return twimlResponse(clip ? gatherPlayTwiml(clip, action, locale) : gatherTwiml(turn.say, action, locale));
}
