import type { NextRequest } from "next/server";
import { NextResponse, after } from "next/server";
import { verifyBridgeSignature } from "@/lib/channels/wa-bridge";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Wave 56 — POST /api/voice/realtime/end (signed by the bridge): the live call finished, the caller hung up,
 * or the agent hands the call to a person (Twilio is told to dial the on-duty team member).
 * The call summary for the CRM is written right after.
 */
export async function POST(request: NextRequest) {
  const raw = await request.text();
  if (!verifyBridgeSignature(raw, request.headers.get("x-scc-timestamp"), request.headers.get("x-scc-signature"))) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  let body: { callId?: string; transfer?: boolean; hungUp?: boolean };
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }
  if (!/^[0-9a-f-]{36}$/.test(String(body.callId ?? ""))) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const admin = createAdminClient();
  const { data: call } = await admin.from("voice_calls").select("id, organization_id, call_sid, status").eq("id", body.callId!).maybeSingle();
  if (!call) return NextResponse.json({ error: "not_found" }, { status: 404 });
  let status = "completed";
  if (body.transfer) {
    const { transferTarget, twilioUpdateCall } = await import("@/lib/voice/realtime");
    const target = await transferTarget(call.organization_id as string);
    const twiml = target ? `<?xml version="1.0" encoding="UTF-8"?><Response><Dial timeout="25">${target}</Dial><Hangup/></Response>` : `<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>`;
    if (call.call_sid) await twilioUpdateCall(call.organization_id as string, call.call_sid as string, twiml);
    status = "transferred";
  }
  if (call.status !== "transferred") await admin.from("voice_calls").update({ status }).eq("id", call.id);
  after(async () => {
    const { summarizeCall } = await import("@/lib/voice/phone-brain");
    await summarizeCall(call.id as string).catch(() => null);
  });
  return NextResponse.json({ ok: true });
}
