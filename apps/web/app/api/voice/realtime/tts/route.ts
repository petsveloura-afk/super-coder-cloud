import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { verifyBridgeSignature } from "@/lib/channels/wa-bridge";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Wave 56 — POST /api/voice/realtime/tts (signed by the bridge): the agent's voice as a µ-law 8 kHz stream. */
export async function POST(request: NextRequest) {
  const raw = await request.text();
  if (!verifyBridgeSignature(raw, request.headers.get("x-scc-timestamp"), request.headers.get("x-scc-signature"))) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  let body: { callId?: string; text?: string };
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }
  if (!/^[0-9a-f-]{36}$/.test(String(body.callId ?? "")) || typeof body.text !== "string" || !body.text.trim()) return NextResponse.json({ error: "bad_request" }, { status: 400 });
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const admin = createAdminClient();
  const { data: call } = await admin.from("voice_calls").select("organization_id").eq("id", body.callId!).maybeSingle();
  if (!call) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const { data: org } = await admin.from("organizations").select("locale").eq("id", call.organization_id as string).maybeSingle();
  const { phoneSpeechStream } = await import("@/lib/voice/phone-tts");
  const stream = await phoneSpeechStream(call.organization_id as string, body.text.slice(0, 1200), (org?.locale as string | undefined) ?? "he", request.signal);
  if (!stream) return NextResponse.json({ error: "tts_unavailable" }, { status: 503 });
  return new Response(stream, { headers: { "Content-Type": "audio/basic", "Cache-Control": "no-store" } });
}
