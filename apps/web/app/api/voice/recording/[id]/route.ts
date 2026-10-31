import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Wave 59 — GET /api/voice/recording/{callId}: plays a call recording for a signed-in team member who can
 * read the inbox (RLS on voice_calls). Twilio media is fetched server-side with the business's credentials.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const { createClient } = await import("@/lib/supabase/server");
  const supabase = await createClient();
  const { data: call } = await supabase.from("voice_calls").select("organization_id, recording_url").eq("id", id).maybeSingle();
  const url = (call?.recording_url as string | null | undefined) ?? null;
  if (!call || !url || !/^https:\/\/api\.twilio\.com\//.test(url)) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const { twilioCredsForOrg } = await import("@/lib/voice/platform-phone");
  const cr = await twilioCredsForOrg(call.organization_id as string);
  if (!cr) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const res = await fetch(`${url}.mp3`, { headers: { Authorization: `Basic ${Buffer.from(`${cr.sid}:${cr.token}`).toString("base64")}` }, cache: "no-store", signal: AbortSignal.timeout(30_000) }).catch(() => null);
  if (!res?.ok || !res.body) return NextResponse.json({ error: "unavailable" }, { status: 502 });
  return new NextResponse(res.body, { headers: { "Content-Type": "audio/mpeg", "Cache-Control": "private, max-age=600", "Content-Disposition": `inline; filename="call-${id}.mp3"` } });
}
