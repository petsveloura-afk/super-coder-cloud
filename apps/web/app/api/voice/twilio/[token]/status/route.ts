import type { NextRequest } from "next/server";
import { NextResponse, after } from "next/server";
import { twilioVoiceRequest } from "../../shared";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Wave 56 — POST /api/voice/twilio/{token}/status: Twilio reports that a call ended → status, duration and the CRM summary. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const v = await twilioVoiceRequest(request, token, "/status");
  if (v instanceof NextResponse) return v;
  const sid = String(v.form.CallSid ?? "");
  const st = String(v.form.CallStatus ?? "");
  if (!/^CA[0-9a-f]{32}$/i.test(sid) || !["completed", "busy", "no-answer", "failed", "canceled"].includes(st)) return new NextResponse(null, { status: 204 });
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const admin = createAdminClient();
  const { data: call } = await admin.from("voice_calls").select("id, status").eq("organization_id", v.acc.organization_id).eq("call_sid", sid).maybeSingle();
  if (!call) return new NextResponse(null, { status: 204 });
  const duration = Number(v.form.CallDuration ?? 0);
  await admin.from("voice_calls").update({ status: call.status === "transferred" ? "transferred" : st === "completed" ? "completed" : st, ...(Number.isFinite(duration) && duration > 0 ? { duration_sec: duration } : {}) }).eq("id", call.id);
  if (st === "completed") {
    after(async () => {
      const { summarizeCall } = await import("@/lib/voice/phone-brain");
      await summarizeCall(call.id as string).catch(() => null);
    });
  }
  return new NextResponse(null, { status: 204 });
}
