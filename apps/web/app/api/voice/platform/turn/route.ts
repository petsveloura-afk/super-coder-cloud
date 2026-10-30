import type { NextRequest } from "next/server";
import { NextResponse, after } from "next/server";
import { platformVoiceRequest, twimlResponse } from "@/lib/voice/platform-request";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** Wave 57 — POST /api/voice/platform/turn?call=<id>: one turn of a call on a platform number (turn-by-turn mode). */
export async function POST(request: NextRequest) {
  const v = await platformVoiceRequest(request, "/turn");
  if (v instanceof NextResponse) return v;
  const callId = request.nextUrl.searchParams.get("call") ?? "";
  if (!/^[0-9a-f-]{36}$/.test(callId)) return new NextResponse("not found", { status: 404 });
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const admin = createAdminClient();
  const { data: call } = await admin.from("voice_calls").select("id, organization_id, conversation_id, call_sid, status, turns").eq("id", callId).eq("via", "platform").maybeSingle();
  if (!call) return new NextResponse("not found", { status: 404 });
  if (!call.call_sid && v.form.CallSid) await admin.from("voice_calls").update({ call_sid: v.form.CallSid, status: "in_progress" }).eq("id", call.id);
  const orgId = call.organization_id as string;
  const { data: org } = await admin.from("organizations").select("locale").eq("id", orgId).maybeSingle();
  const locale = (org?.locale as string | undefined) ?? "he";
  const { gatherTwiml, gatherPlayTwiml, sayTwiml, playTwiml } = await import("@/lib/voice/twiml");
  const { voiceTurn } = await import("@/lib/voice/agent");
  const { platformUrls } = await import("@/lib/voice/platform-phone");
  const said = String(v.form.SpeechResult ?? "").slice(0, 1000);
  // an outbound call was just answered → go live when possible
  if (!said && !((call.turns as unknown[] | null) ?? []).length) {
    const { realtimeVoiceReady, liveCallTwiml } = await import("@/lib/voice/realtime");
    if (await realtimeVoiceReady()) {
      const live = liveCallTwiml(call.id as string, locale);
      if (live) {
        await admin.from("voice_calls").update({ mode: "realtime", status: "in_progress" }).eq("id", call.id).then(() => undefined, () => undefined);
        return twimlResponse(live);
      }
    }
  }
  const turn = await voiceTurn({ orgId, callId: call.id as string, conversationId: (call.conversation_id as string | null) ?? null, callerText: said, locale });
  const { phoneClipUrl } = await import("@/lib/voice/phone-tts");
  const clip = await phoneClipUrl(orgId, turn.say, locale).catch(() => null);
  if (turn.end) {
    await admin.from("voice_calls").update({ status: turn.transfer ? "transferred" : "completed" }).eq("id", call.id);
    let dialTo: string | null = null;
    if (turn.transfer) {
      const { transferTarget } = await import("@/lib/voice/realtime");
      dialTo = await transferTarget(orgId);
    }
    after(async () => {
      const { summarizeCall } = await import("@/lib/voice/phone-brain");
      await summarizeCall(call.id as string).catch(() => null);
    });
    return twimlResponse(clip ? playTwiml(clip, { dialTo }) : sayTwiml(turn.say, locale, { dialTo }));
  }
  const bye = locale === "en" ? "I didn't hear anything — we'll get back to you. Goodbye!" : locale === "ar" ? "لم أسمع شيئاً — سنعود إليك. مع السلامة!" : "לא שמעתי תשובה, נחזור אליך. להתראות!";
  const action = platformUrls().turn(call.id as string);
  return twimlResponse(clip ? gatherPlayTwiml(clip, action, locale, { hangupText: bye }) : gatherTwiml(turn.say, action, locale, { hangupText: bye }));
}
