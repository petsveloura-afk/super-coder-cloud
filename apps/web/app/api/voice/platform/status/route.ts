import type { NextRequest } from "next/server";
import { NextResponse, after } from "next/server";
import { platformVoiceRequest } from "@/lib/voice/platform-request";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Wave 57 — POST /api/voice/platform/status: a call on a platform number ended → status, minutes, CRM summary. */
export async function POST(request: NextRequest) {
  const v = await platformVoiceRequest(request, "/status");
  if (v instanceof NextResponse) return v;
  const sid = String(v.form.CallSid ?? "");
  const st = String(v.form.CallStatus ?? "");
  if (!/^CA[0-9a-f]{32}$/i.test(sid) || !["completed", "busy", "no-answer", "failed", "canceled"].includes(st)) return new NextResponse(null, { status: 204 });
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const admin = createAdminClient();
  const { data: call } = await admin.from("voice_calls").select("id, status, organization_id").eq("call_sid", sid).eq("via", "platform").maybeSingle();
  if (!call) return new NextResponse(null, { status: 204 });
  const duration = Number(v.form.CallDuration ?? 0);
  await admin.from("voice_calls").update({ status: call.status === "transferred" ? "transferred" : st, ...(Number.isFinite(duration) && duration > 0 ? { duration_sec: duration } : {}) }).eq("id", call.id);
  // wave 59: missed call → text back; minutes above the month come from purchased minute packs
  after(async () => {
    const orgId = call.organization_id as string;
    await (await import("@/lib/voice/missed-call")).afterCallEnded({ orgId, callId: call.id as string, status: st, duration: Number.isFinite(duration) ? duration : null });
    if (duration > 0) await (await import("@/lib/voice/platform-phone")).chargeOverflowMinutes(orgId, call.id as string, duration);
  });
  if (st === "completed") {
    after(async () => {
      const { summarizeCall } = await import("@/lib/voice/phone-brain");
      await summarizeCall(call.id as string).catch(() => null);
    });
  }
  return new NextResponse(null, { status: 204 });
}
