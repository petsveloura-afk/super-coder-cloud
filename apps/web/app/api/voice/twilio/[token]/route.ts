import type { NextRequest } from "next/server";
import { NextResponse, after } from "next/server";
import { twilioVoiceRequest, xml } from "../shared";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * POST /api/voice/twilio/{token} — the business's Twilio number receives a call (set as
 * the number's "A call comes in" webhook). The AI voice agent greets and listens.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const v = await twilioVoiceRequest(request, token, "");
  if (v instanceof NextResponse) return v;
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const admin = createAdminClient();
  const { data: has } = await admin.rpc("has_feature", { p_org: v.acc.organization_id, p_feature: "voice_ai" });
  const { data: org } = await admin.from("organizations").select("locale, name").eq("id", v.acc.organization_id).maybeSingle();
  const locale = (org?.locale as string | undefined) ?? "he";
  const { gatherTwiml, sayTwiml } = await import("@/lib/voice/twiml");
  if (has !== true) {
    return xml(sayTwiml(locale === "en" ? "Thank you for calling. Please send us a message and we will get back to you." : "תודה שהתקשרת. אפשר לשלוח לנו הודעה ונחזור אליך בהקדם.", locale));
  }
  const { openVoiceCall, voiceTurn, voiceWebhookUrl } = await import("@/lib/voice/agent");
  const call = await openVoiceCall({ orgId: v.acc.organization_id, direction: "in", from: v.form.From ?? "", to: v.form.To ?? "", callSid: v.form.CallSid ?? null });
  // wave 56: Twilio tells us when the call ends (status, duration, CRM summary) — no setup needed
  const callSid = v.form.CallSid ?? "";
  if (callSid) after(async () => (await import("@/lib/voice/realtime")).watchCallStatus(v.acc.organization_id, callSid, voiceWebhookUrl(token, "/status")));
  // wave 56: a LIVE call (continuous audio, interruptions, the agent's own voice) when the bridge supports it
  const { realtimeVoiceReady, liveCallTwiml } = await import("@/lib/voice/realtime");
  if (await realtimeVoiceReady()) {
    const live = liveCallTwiml(call.id, locale);
    if (live) {
      await admin.from("voice_calls").update({ mode: "realtime" }).eq("id", call.id).then(() => undefined, () => undefined);
      return xml(live);
    }
  }
  const turn = await voiceTurn({ orgId: v.acc.organization_id, callId: call.id, conversationId: call.conversationId, callerText: "", locale });
  // wave 56: the agent's own voice (ElevenLabs / OpenAI clip); the standard voice stays as the fallback
  const { phoneClipUrl } = await import("@/lib/voice/phone-tts");
  const clip = await phoneClipUrl(v.acc.organization_id, turn.say, locale).catch(() => null);
  if (clip) {
    const { gatherPlayTwiml } = await import("@/lib/voice/twiml");
    return xml(gatherPlayTwiml(clip, voiceWebhookUrl(token, `/turn?call=${call.id}`), locale));
  }
  return xml(gatherTwiml(turn.say, voiceWebhookUrl(token, `/turn?call=${call.id}`), locale));
}
