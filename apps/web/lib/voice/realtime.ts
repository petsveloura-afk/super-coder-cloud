import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { bridgeConfigured } from "@/lib/channels/wa-bridge";
import { bridgeStreamUrl, signStream, streamTwiml } from "./realtime-core";
import { phoneTtsReady } from "./phone-tts";

/**
 * Wave 56 — live calls are used automatically when everything they need is in place:
 *   the bridge service is configured and runs the live-call version (its /health says so),
 *   a voice engine (ElevenLabs / OpenAI) is set, and VOICE_REALTIME is not "off".
 * Otherwise calls keep working turn by turn (stage 1) — nothing breaks.
 */
let cache: { at: number; ok: boolean } | null = null;

export async function realtimeVoiceReady(): Promise<boolean> {
  if (process.env.VOICE_REALTIME === "off" || !bridgeConfigured() || !phoneTtsReady()) return false;
  if (process.env.VOICE_REALTIME === "on") return true;
  if (cache && Date.now() - cache.at < 60_000) return cache.ok;
  let ok = false;
  try {
    const res = await fetch(`${(process.env.WA_BRIDGE_URL ?? "").replace(/\/$/, "")}/health`, { signal: AbortSignal.timeout(1500), cache: "no-store" });
    const j = (await res.json().catch(() => ({}))) as { voice_realtime?: boolean };
    ok = res.ok && j.voice_realtime === true;
  } catch {
    ok = false;
  }
  cache = { at: Date.now(), ok };
  return ok;
}

/** TwiML that connects this call to the live audio stream on the bridge. */
export function liveCallTwiml(callId: string, locale: string): string | null {
  const url = bridgeStreamUrl(process.env.WA_BRIDGE_URL ?? "");
  const secret = process.env.WA_BRIDGE_SECRET ?? "";
  if (!url || secret.length < 24) return null;
  return streamTwiml(url, { ...signStream(secret, callId), lang: locale });
}

/** Changes a live call on Twilio (e.g. transfer to a person) — the stream ends and the new TwiML runs. */
export async function twilioUpdateCall(orgId: string, callSid: string, twiml: string): Promise<boolean> {
  const { loadAccount } = await import("@/lib/channels/accounts");
  const acc = await loadAccount(orgId, "sms");
  if (!acc?.config.account_sid || !acc.secrets.auth_token || !/^CA[0-9a-f]{32}$/i.test(callSid)) return false;
  const base = (process.env.TWILIO_API_BASE || "https://api.twilio.com").replace(/\/$/, "");
  try {
    const res = await fetch(`${base}/2010-04-01/Accounts/${encodeURIComponent(acc.config.account_sid)}/Calls/${encodeURIComponent(callSid)}.json`, {
      method: "POST",
      headers: { Authorization: `Basic ${Buffer.from(`${acc.config.account_sid}:${acc.secrets.auth_token}`).toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ Twiml: twiml }).toString(),
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Asks Twilio to report when the call ends (for the CRM summary) — no setup needed by the business. */
export async function watchCallStatus(orgId: string, callSid: string, statusUrl: string): Promise<void> {
  const { loadAccount } = await import("@/lib/channels/accounts");
  const acc = await loadAccount(orgId, "sms");
  if (!acc?.config.account_sid || !acc.secrets.auth_token || !/^CA[0-9a-f]{32}$/i.test(callSid)) return;
  const base = (process.env.TWILIO_API_BASE || "https://api.twilio.com").replace(/\/$/, "");
  await fetch(`${base}/2010-04-01/Accounts/${encodeURIComponent(acc.config.account_sid)}/Calls/${encodeURIComponent(callSid)}.json`, {
    method: "POST",
    headers: { Authorization: `Basic ${Buffer.from(`${acc.config.account_sid}:${acc.secrets.auth_token}`).toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ StatusCallback: statusUrl, StatusCallbackMethod: "POST" }).toString(),
    signal: AbortSignal.timeout(8000),
    cache: "no-store",
  }).catch(() => undefined);
}

/** The team member who takes transferred calls (job "call"), in E.164. */
export async function transferTarget(orgId: string): Promise<string | null> {
  const { data } = await createAdminClient().from("notify_recipients").select("target").eq("organization_id", orgId).eq("kind", "call").eq("enabled", true).not("target", "is", null).limit(1).maybeSingle();
  const t = (data?.target as string | undefined) ?? null;
  return t && /^\+\d{8,15}$/.test(t) ? t : null;
}
