import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { publicEnv } from "@/lib/env";

/**
 * Wave 59 — call recordings (opt-in per business on the phone screen). Twilio records the call, tells us
 * where the recording is (signed callback URL), and the team plays it from the contact card / phone
 * screen through an authenticated proxy (Twilio media needs the account's credentials). Never throws.
 */
const secret = () => process.env.CRON_SECRET || process.env.ENCRYPTION_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "";

export function recordingSig(callId: string): string {
  return createHmac("sha256", secret()).update(`rec:${callId}`).digest("hex").slice(0, 32);
}

export function validRecordingSig(callId: string, sig: string | null): boolean {
  if (!sig || !secret()) return false;
  const a = Buffer.from(recordingSig(callId));
  const b = Buffer.from(sig);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function recordingCallbackUrl(callId: string): string {
  return `${publicEnv.appUrl.replace(/\/$/, "")}/api/voice/recording?call=${callId}&sig=${recordingSig(callId)}`;
}

/** Starts recording a live call when the business turned recording on (a few seconds after it connects). */
export async function maybeRecordCall(orgId: string, callId: string, callSid: string): Promise<boolean> {
  try {
    if (!/^CA[0-9a-f]{32}$/i.test(callSid) || !secret()) return false;
    const { loadPhoneSettings } = await import("./phone-settings");
    if (!(await loadPhoneSettings(orgId)).record_calls) return false;
    const { twilioCredsForOrg } = await import("./platform-phone");
    const cr = await twilioCredsForOrg(orgId);
    if (!cr) return false;
    const { twilioRequest } = await import("./twilio-api");
    // the call must be answered before Twilio accepts a recording — try a few times
    for (const wait of [2500, 4000, 6000]) {
      await new Promise((r) => setTimeout(r, wait));
      const r = await twilioRequest(cr.sid, cr.token, "POST", `/Calls/${callSid}/Recordings.json`, { RecordingStatusCallback: recordingCallbackUrl(callId), RecordingStatusCallbackEvent: "completed", RecordingStatusCallbackMethod: "POST" });
      if (r.ok) return true;
      if (r.status === 404 || r.status === 401) return false;
    }
    return false;
  } catch {
    return false;
  }
}

/** The recording callback stored the recording on the call. */
export async function saveRecording(callId: string, form: Record<string, string>): Promise<boolean> {
  const sid = String(form.RecordingSid ?? "");
  const url = String(form.RecordingUrl ?? "");
  if (!/^RE[0-9a-f]{32}$/i.test(sid) || !/^https:\/\/api\.twilio\.com\//.test(url) || String(form.RecordingStatus ?? "completed") !== "completed") return false;
  const sec = Math.max(0, Math.round(Number(form.RecordingDuration ?? 0)) || 0);
  const { error } = await createAdminClient().from("voice_calls").update({ recording_sid: sid, recording_url: url.slice(0, 500), recording_sec: sec }).eq("id", callId);
  return !error;
}
