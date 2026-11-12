import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { publicEnv } from "@/lib/env";
import { platformTwilio } from "./platform-phone-core";
import { configureNumber, twilioRequest } from "./twilio-api";
import { healDue, isPublicHttpsBase, twilioNeedsRepoint } from "./twilio-heal-core";

/**
 * After the app moved to a new address, the phone numbers the platform wired earlier (platform numbers and the businesses'
 * own Twilio numbers that were auto-wired) still call the old address. This re-points them to the current one — the same
 * call the app makes when a number is connected (configureNumber), only for numbers whose Voice URL is one WE wrote.
 *
 * Runs from the follow-ups clock at most once every 6 hours per server process, a few numbers per run. Never throws.
 */

const g = globalThis as unknown as { __sccTwilioHealAt?: number };

interface TwNumber {
  sid: string;
  phone_number: string;
  voice_url?: string | null;
}

async function numberByPhone(sid: string, token: string, phone: string): Promise<TwNumber | null> {
  const r = await twilioRequest<{ incoming_phone_numbers?: TwNumber[] }>(sid, token, "GET", "/IncomingPhoneNumbers.json", { PhoneNumber: phone, PageSize: "1" });
  return r.ok ? (r.data?.incoming_phone_numbers?.[0] ?? null) : null;
}

export async function healTwilioNumbers(limit = 10): Promise<{ checked: number; repointed: number; skipped?: string }> {
  const out = { checked: 0, repointed: 0 };
  try {
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return { ...out, skipped: "no_service_key" };
    const here = publicEnv.appUrl.replace(/\/$/, "");
    if (!isPublicHttpsBase(here)) return { ...out, skipped: "no_public_address" };
    if (!healDue(g.__sccTwilioHealAt, Date.now())) return { ...out, skipped: "recent" };
    g.__sccTwilioHealAt = Date.now();
    const admin = createAdminClient();

    // 1) platform numbers (the platform's own Twilio account)
    const tw = platformTwilio(process.env);
    if (tw) {
      const { data } = await admin.from("org_phone_numbers").select("phone_number").limit(limit);
      for (const row of (data ?? []) as { phone_number: string }[]) {
        const num = await numberByPhone(tw.sid, tw.token, row.phone_number);
        if (!num) continue;
        out.checked++;
        const voice = `${here}/api/voice/platform`;
        if (twilioNeedsRepoint(num.voice_url, voice, "/api/voice/platform")) {
          const r = await configureNumber(tw.sid, tw.token, num.sid, { voice, status: `${voice}/status` });
          if (r.ok) out.repointed++;
          console.info("twilio heal: platform number", r.ok ? "re-pointed" : `not re-pointed (${r.status})`);
        }
      }
    }

    // 2) businesses' own Twilio accounts (connected under "SMS / phone")
    const { data: accs } = await admin.from("channel_accounts").select("organization_id").eq("kind", "sms").neq("status", "disabled").limit(limit);
    const { loadAccount } = await import("@/lib/channels/accounts");
    for (const a of (accs ?? []) as { organization_id: string }[]) {
      const acc = await loadAccount(a.organization_id, "sms").catch(() => null);
      if (!acc?.config.account_sid || !acc.secrets.auth_token || !acc.config.from_number || !acc.webhook_token) continue;
      const num = await numberByPhone(acc.config.account_sid, acc.secrets.auth_token, acc.config.from_number);
      if (!num) continue;
      out.checked++;
      const voice = `${here}/api/voice/twilio/${acc.webhook_token}`;
      if (twilioNeedsRepoint(num.voice_url, voice, `/api/voice/twilio/${acc.webhook_token}`)) {
        const r = await configureNumber(acc.config.account_sid, acc.secrets.auth_token, num.sid, { voice, status: `${voice}/status`, sms: `${here}/api/channels/sms/${acc.webhook_token}` });
        if (r.ok) out.repointed++;
        console.info("twilio heal: business number", r.ok ? "re-pointed" : `not re-pointed (${r.status})`);
      }
    }
    return out;
  } catch (e) {
    console.warn("twilio heal failed", (e as Error).message.slice(0, 160));
    return out;
  }
}
