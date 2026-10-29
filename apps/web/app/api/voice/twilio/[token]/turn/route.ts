import type { NextRequest } from "next/server";
import { NextResponse, after } from "next/server";
import { twilioVoiceRequest, xml } from "../../shared";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** POST /api/voice/twilio/{token}/turn?call=<id> — the caller spoke (SpeechResult) → the agent answers. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const v = await twilioVoiceRequest(request, token, "/turn");
  if (v instanceof NextResponse) return v;
  const callId = request.nextUrl.searchParams.get("call") ?? "";
  if (!/^[0-9a-f-]{36}$/.test(callId)) return new NextResponse("not found", { status: 404 });
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const admin = createAdminClient();
  const { data: call } = await admin.from("voice_calls").select("id, organization_id, conversation_id, call_sid, status").eq("id", callId).eq("organization_id", v.acc.organization_id).maybeSingle();
  if (!call) return new NextResponse("not found", { status: 404 });
  if (!call.call_sid && v.form.CallSid) await admin.from("voice_calls").update({ call_sid: v.form.CallSid, status: "in_progress" }).eq("id", call.id);
  const { data: org } = await admin.from("organizations").select("locale").eq("id", call.organization_id).maybeSingle();
  const locale = (org?.locale as string | undefined) ?? "he";
  const { gatherTwiml, sayTwiml } = await import("@/lib/voice/twiml");
  const { voiceTurn, voiceWebhookUrl } = await import("@/lib/voice/agent");
  const said = String(v.form.SpeechResult ?? "").slice(0, 1000);
  // wave 56: an outbound call was just answered → go LIVE when the bridge supports it
  if (!said) {
    const { data: t } = await admin.from("voice_calls").select("turns").eq("id", call.id).maybeSingle();
    if (!((t?.turns as unknown[] | null) ?? []).length) {
      const { realtimeVoiceReady, liveCallTwiml } = await import("@/lib/voice/realtime");
      if (await realtimeVoiceReady()) {
        const live = liveCallTwiml(call.id as string, locale);
        if (live) {
          await admin.from("voice_calls").update({ mode: "realtime", status: "in_progress" }).eq("id", call.id).then(() => undefined, () => undefined);
          return xml(live);
        }
      }
    }
  }
  const turn = await voiceTurn({ orgId: call.organization_id as string, callId: call.id as string, conversationId: (call.conversation_id as string | null) ?? null, callerText: said, locale });
  if (turn.end) {
    await admin.from("voice_calls").update({ status: turn.transfer ? "transferred" : "completed" }).eq("id", call.id);
    let dialTo: string | null = null;
    if (turn.transfer) {
      const { data: rec } = await admin.from("notify_recipients").select("target").eq("organization_id", call.organization_id).eq("kind", "call").eq("enabled", true).not("target", "is", null).limit(1).maybeSingle();
      dialTo = (rec?.target as string | undefined) ?? null;
    }
    // wave 56: the CRM summary right after the call, and the last words in the agent's own voice
    after(async () => {
      const { summarizeCall } = await import("@/lib/voice/phone-brain");
      await summarizeCall(call.id as string).catch(() => null);
    });
    const { phoneClipUrl } = await import("@/lib/voice/phone-tts");
    const lastClip = await phoneClipUrl(call.organization_id as string, turn.say, locale).catch(() => null);
    if (lastClip) {
      const { playTwiml } = await import("@/lib/voice/twiml");
      return xml(playTwiml(lastClip, { dialTo }));
    }
    return xml(sayTwiml(turn.say, locale, { dialTo }));
  }
  const bye = locale === "en" ? "I didn't hear anything — we'll get back to you. Goodbye!" : locale === "ar" ? "لم أسمع شيئاً — سنعود إليك. مع السلامة!" : "לא שמעתי תשובה, נחזור אליך. להתראות!";
  // wave 56: the answer in the agent's own voice (the caller can interrupt it); the standard voice stays as the fallback
  const { phoneClipUrl } = await import("@/lib/voice/phone-tts");
  const clip = await phoneClipUrl(call.organization_id as string, turn.say, locale).catch(() => null);
  if (clip) {
    const { gatherPlayTwiml } = await import("@/lib/voice/twiml");
    return xml(gatherPlayTwiml(clip, voiceWebhookUrl(token, `/turn?call=${call.id}`), locale, { hangupText: bye }));
  }
  return xml(gatherTwiml(turn.say, voiceWebhookUrl(token, `/turn?call=${call.id}`), locale, { hangupText: bye }));
}
