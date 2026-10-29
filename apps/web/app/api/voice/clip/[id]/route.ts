import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** Wave 56 — GET /api/voice/clip/{id}: a short clip in the agent's voice for Twilio <Play> (unguessable id, 30 minutes). */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)) return new NextResponse("not found", { status: 404 });
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const { data } = await createAdminClient().from("voice_clips").select("mime, audio_b64").eq("id", id).gt("created_at", new Date(Date.now() - 30 * 60_000).toISOString()).maybeSingle();
  if (!data) return new NextResponse("not found", { status: 404 });
  const buf = Buffer.from(String(data.audio_b64 ?? ""), "base64");
  return new NextResponse(new Uint8Array(buf), { headers: { "Content-Type": (data.mime as string) || "audio/mpeg", "Content-Length": String(buf.length), "Cache-Control": "private, max-age=600" } });
}
