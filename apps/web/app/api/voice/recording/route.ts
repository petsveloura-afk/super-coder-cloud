import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** Wave 59 — POST /api/voice/recording?call=…&sig=…: Twilio tells us a call recording is ready (signed URL). */
export async function POST(request: NextRequest) {
  const callId = request.nextUrl.searchParams.get("call") ?? "";
  const sig = request.nextUrl.searchParams.get("sig");
  if (!/^[0-9a-f-]{36}$/i.test(callId)) return new NextResponse(null, { status: 204 });
  const { validRecordingSig, saveRecording } = await import("@/lib/voice/recording");
  if (!validRecordingSig(callId, sig)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const raw = await request.text();
  const form = Object.fromEntries(new URLSearchParams(raw.slice(0, 20_000)));
  await saveRecording(callId, form).catch(() => false);
  return new NextResponse(null, { status: 204 });
}
