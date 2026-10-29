import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { verifyBridgeSignature } from "@/lib/channels/wa-bridge";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Wave 56 — POST /api/voice/realtime/turn (signed by the bridge): one turn of a LIVE phone call.
 *   kind "start"      → the agent's opening line
 *   kind "utterance"  → µ-law audio of what the caller said → speech-to-text (business glossary) → phone brain
 *   kind "silence"    → the caller went quiet → a gentle check, then a polite goodbye
 * Answers { say, end, transfer, heard }.
 */
export async function POST(request: NextRequest) {
  const raw = await request.text();
  if (!verifyBridgeSignature(raw, request.headers.get("x-scc-timestamp"), request.headers.get("x-scc-signature"))) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  let body: { callId?: string; kind?: string; audio?: string; notHeard?: number; silence?: number; force?: boolean };
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }
  if (!/^[0-9a-f-]{36}$/.test(String(body.callId ?? ""))) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const admin = createAdminClient();
  const { data: call } = await admin.from("voice_calls").select("id, organization_id, conversation_id, status").eq("id", body.callId!).maybeSingle();
  if (!call) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const orgId = call.organization_id as string;
  const { data: has } = await admin.rpc("has_feature", { p_org: orgId, p_feature: "voice_ai" });
  if (has !== true) return NextResponse.json({ say: "", end: true, transfer: false });
  const { data: org } = await admin.from("organizations").select("locale").eq("id", orgId).maybeSingle();
  const locale = (org?.locale as string | undefined) ?? "he";
  const { phoneLang, silenceLine, notHeardLine, soundsUnfinished } = await import("@/lib/voice/phone-brain-core");
  const lang = phoneLang(locale);
  const { voiceTurn } = await import("@/lib/voice/agent");
  const conversationId = (call.conversation_id as string | null) ?? null;

  if (body.kind === "start") {
    await admin.from("voice_calls").update({ status: "in_progress", mode: "realtime" }).eq("id", call.id).then(() => undefined, () => undefined);
    const turn = await voiceTurn({ orgId, callId: call.id as string, conversationId, callerText: "", locale });
    return NextResponse.json({ say: turn.say, end: turn.end && !turn.transfer, transfer: turn.transfer, heard: true });
  }
  if (body.kind === "silence") {
    const s = silenceLine(lang, Math.max(1, Number(body.silence) || 1));
    return NextResponse.json({ say: s.say, end: s.end, transfer: false, heard: true });
  }
  if (body.kind !== "utterance" || typeof body.audio !== "string" || body.audio.length > 2_000_000) return NextResponse.json({ error: "bad_request" }, { status: 400 });
  const ulaw = Buffer.from(body.audio, "base64");
  const { speechRatio, ulawToWav } = await import("@/lib/voice/realtime-core");
  // background noise only → say nothing, keep listening
  if (ulaw.length < 1600 || speechRatio(ulaw) < 0.06) return NextResponse.json({ say: "", end: false, transfer: false, heard: true });
  const [{ transcribeAudio }, { loadSttContext }, { sttPrompt }] = await Promise.all([import("@/lib/ai/media"), import("@/lib/ai/voice-persona"), import("@/lib/ai/voice-persona-core")]);
  const hint = sttPrompt({ ...(await loadSttContext(orgId)), locale });
  const heard = await transcribeAudio(ulawToWav(ulaw), "audio/wav", lang, hint).catch(() => null);
  const text = (heard?.text ?? "").replace(/\s+/g, " ").trim().slice(0, 1000);
  if (!text) return NextResponse.json({ say: notHeardLine(lang, Number(body.notHeard) || 0), end: false, transfer: false, heard: false });
  // smart turn-taking: the caller stopped mid-sentence ("…and", "…but") → let them finish instead of cutting in
  if (!body.force && text.split(" ").length >= 2 && soundsUnfinished(text)) return NextResponse.json({ say: "", end: false, transfer: false, heard: true, wait: true });
  const turn = await voiceTurn({ orgId, callId: call.id as string, conversationId, callerText: text, locale });
  return NextResponse.json({ say: turn.say, end: turn.end && !turn.transfer, transfer: turn.transfer, heard: true });
}
