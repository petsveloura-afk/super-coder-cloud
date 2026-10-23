import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
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
  const turn = await voiceTurn({ orgId: call.organization_id as string, callId: call.id as string, conversationId: (call.conversation_id as string | null) ?? null, callerText: said, locale });
  if (turn.end) {
    await admin.from("voice_calls").update({ status: turn.transfer ? "transferred" : "completed" }).eq("id", call.id);
    let dialTo: string | null = null;
    if (turn.transfer) {
      const { data: rec } = await admin.from("notify_recipients").select("target").eq("organization_id", call.organization_id).eq("kind", "call").eq("enabled", true).not("target", "is", null).limit(1).maybeSingle();
      dialTo = (rec?.target as string | undefined) ?? null;
    }
    return xml(sayTwiml(turn.say, locale, { dialTo }));
  }
  const bye = locale === "en" ? "I didn't hear anything — we'll get back to you. Goodbye!" : locale === "ar" ? "لم أسمع شيئاً — سنعود إليك. مع السلامة!" : "לא שמעתי תשובה, נחזור אליך. להתראות!";
  return xml(gatherTwiml(turn.say, voiceWebhookUrl(token, `/turn?call=${call.id}`), locale, { hangupText: bye }));
}
