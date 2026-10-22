import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
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
  const turn = await voiceTurn({ orgId: v.acc.organization_id, callId: call.id, conversationId: call.conversationId, callerText: "", locale });
  return xml(gatherTwiml(turn.say, voiceWebhookUrl(token, `/turn?call=${call.id}`), locale));
}
