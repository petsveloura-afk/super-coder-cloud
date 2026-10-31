import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { publicEnv } from "@/lib/env";
import { monthStart, minutesLeft, minutesLeftWithPacks, minutesUsed, monthlyMinutes, needsManualAssign, overflowMinutes, platformTwilio, validE164 } from "./platform-phone-core";
import { buyNumber, configureNumber, findIncomingNumber, releaseNumber } from "./twilio-api";

/**
 * Wave 57 — zero-setup phone for businesses.
 *   • the platform owner connects ONE Twilio account (env) — businesses never see Twilio;
 *   • a business on the Business plan clicks "get a number" → a number is bought and wired automatically
 *     (or, for countries that need paperwork such as Israel, the platform admin assigns one in a click);
 *   • a business that prefers its own Twilio account still can — its number is now wired automatically too.
 */
const app = () => publicEnv.appUrl.replace(/\/$/, "");
export const platformUrls = () => ({ voice: `${app()}/api/voice/platform`, status: `${app()}/api/voice/platform/status`, turn: (callId: string) => `${app()}/api/voice/platform/turn?call=${callId}` });

export function platformPhoneReady(): boolean {
  return platformTwilio(process.env) !== null;
}

export interface OrgPhone {
  phone_number: string;
  number_sid: string | null;
  source: "platform" | "assigned";
  country: string | null;
}

export async function orgPhoneNumber(orgId: string): Promise<OrgPhone | null> {
  try {
    const { data, error } = await createAdminClient().from("org_phone_numbers").select("phone_number, number_sid, source, country").eq("organization_id", orgId).maybeSingle();
    return error ? null : ((data as OrgPhone | null) ?? null);
  } catch {
    return null;
  }
}

/** Which business does a called platform number belong to? */
export async function orgForCalledNumber(to: string): Promise<string | null> {
  if (!validE164(to)) return null;
  const { data } = await createAdminClient().from("org_phone_numbers").select("organization_id").eq("phone_number", to.trim()).maybeSingle();
  return (data?.organization_id as string | undefined) ?? null;
}

/** One click: buy a number in the platform's country and wire it. */
export async function provisionForOrg(orgId: string, orgName: string): Promise<{ ok: true; phone: string } | { ok: false; error: string; manual?: boolean }> {
  const tw = platformTwilio(process.env);
  if (!tw) return { ok: false, error: "phone.platformOff" };
  const existing = await orgPhoneNumber(orgId);
  if (existing) return { ok: true, phone: existing.phone_number };
  const urls = platformUrls();
  const r = await buyNumber(tw.sid, tw.token, tw.country, { voice: urls.voice, status: urls.status }, `SCC · ${orgName}`);
  if (!r.ok || !r.data?.phone_number) {
    console.error("platform number purchase failed", r.error);
    return { ok: false, error: needsManualAssign(r.error ?? "") ? "phone.manualAssign" : "phone.buyFailed", manual: needsManualAssign(r.error ?? "") };
  }
  const { error } = await createAdminClient().from("org_phone_numbers").insert({ organization_id: orgId, phone_number: r.data.phone_number, number_sid: r.data.sid, source: "platform", country: tw.country });
  if (error) {
    // never leave a paid number without an owner
    await releaseNumber(tw.sid, tw.token, r.data.sid);
    return { ok: false, error: "phone.buyFailed" };
  }
  return { ok: true, phone: r.data.phone_number };
}

/** Platform admin: give a business a number that already exists in the platform's Twilio account (e.g. an Israeli number). */
export async function assignToOrg(orgId: string, phone: string): Promise<{ ok: boolean; error?: string }> {
  const tw = platformTwilio(process.env);
  if (!tw) return { ok: false, error: "phone.platformOff" };
  if (!validE164(phone)) return { ok: false, error: "validation.phone" };
  const num = await findIncomingNumber(tw.sid, tw.token, phone.trim());
  if (!num) return { ok: false, error: "phone.notInAccount" };
  const urls = platformUrls();
  const c = await configureNumber(tw.sid, tw.token, num.sid, { voice: urls.voice, status: urls.status });
  if (!c.ok) return { ok: false, error: "phone.configFailed" };
  const admin = createAdminClient();
  await admin.from("org_phone_numbers").delete().eq("phone_number", phone.trim());
  const { error } = await admin.from("org_phone_numbers").upsert({ organization_id: orgId, phone_number: phone.trim(), number_sid: num.sid, source: "assigned", country: null }, { onConflict: "organization_id" });
  return error ? { ok: false, error: "errors.generic" } : { ok: true };
}

/** Gives the number back (bought numbers are released in Twilio; assigned ones stay in the account). */
export async function releaseForOrg(orgId: string): Promise<boolean> {
  const tw = platformTwilio(process.env);
  const row = await orgPhoneNumber(orgId);
  if (!row) return true;
  if (tw && row.source === "platform" && row.number_sid) await releaseNumber(tw.sid, tw.token, row.number_sid);
  const { error } = await createAdminClient().from("org_phone_numbers").delete().eq("organization_id", orgId);
  return !error;
}

/** Minutes used this month on platform numbers vs the allowance. */
export async function platformMinutes(orgId: string): Promise<{ used: number; limit: number; left: number | null; packs?: number }> {
  const limit = monthlyMinutes(process.env);
  const { data } = await createAdminClient().from("voice_calls").select("duration_sec").eq("organization_id", orgId).eq("via", "platform").gte("created_at", monthStart()).limit(5000);
  const used = minutesUsed(((data ?? []) as { duration_sec: number | null }[]).map((r) => r.duration_sec));
  // wave 59: purchased minute packs extend the month (used after the monthly minutes)
  const packs = await minutePackBalance(orgId);
  return { used, limit, left: minutesLeftWithPacks(minutesLeft(used, limit), packs), packs };
}

/** Wave 59 — purchased phone minutes left (0 before the migration ran). */
export async function minutePackBalance(orgId: string): Promise<number> {
  try {
    const { data, error } = await createAdminClient().rpc("voice_minutes_balance", { org: orgId });
    return error ? 0 : Math.max(0, Number(data ?? 0));
  } catch {
    return 0;
  }
}

/**
 * Wave 59 — a platform call ended: the part of it above the monthly minutes is taken from the purchased
 * minute packs (one ledger row per call, never below zero). Best-effort.
 */
export async function chargeOverflowMinutes(orgId: string, callId: string, durationSec: number): Promise<number> {
  try {
    const limit = monthlyMinutes(process.env);
    if (limit <= 0 || !(durationSec > 0)) return 0;
    const admin = createAdminClient();
    const { data } = await admin.from("voice_calls").select("id, duration_sec").eq("organization_id", orgId).eq("via", "platform").gte("created_at", monthStart()).limit(5000);
    const rows = (data ?? []) as { id: string; duration_sec: number | null }[];
    const usedAfter = minutesUsed(rows.map((r) => r.duration_sec));
    const usedBefore = minutesUsed(rows.filter((r) => r.id !== callId).map((r) => r.duration_sec));
    const over = Math.min(overflowMinutes(usedBefore, usedAfter, limit), await minutePackBalance(orgId));
    if (over <= 0) return 0;
    await admin.from("credit_ledger").insert({ organization_id: orgId, kind: "voice", delta: -over, reason: "usage", note: `call ${callId}`.slice(0, 300) });
    return over;
  } catch {
    return 0;
  }
}

export interface TwilioCreds {
  sid: string;
  token: string;
  from: string;
  via: "own" | "platform";
  /** for own accounts: the account's webhook token (URLs under /api/voice/twilio/{token}) */
  webhookToken?: string;
}

/** The Twilio account that carries this business's calls: its own (if connected), else the platform's. */
export async function twilioCredsForOrg(orgId: string): Promise<TwilioCreds | null> {
  const { loadAccount } = await import("@/lib/channels/accounts");
  const acc = await loadAccount(orgId, "sms").catch(() => null);
  if (acc?.config.account_sid && acc.secrets.auth_token && acc.config.from_number) return { sid: acc.config.account_sid, token: acc.secrets.auth_token, from: acc.config.from_number, via: "own", webhookToken: acc.webhook_token };
  const tw = platformTwilio(process.env);
  const row = tw ? await orgPhoneNumber(orgId) : null;
  if (tw && row) return { sid: tw.sid, token: tw.token, from: row.phone_number, via: "platform" };
  return null;
}

/**
 * Own Twilio account: wire the number automatically right after the business connects it (Voice URL,
 * status callback, SMS URL) — no copying URLs into the Twilio console. Best-effort.
 */
export async function autoWireOwnNumber(input: { sid: string; token: string; phone: string; webhookToken: string }): Promise<boolean> {
  const num = await findIncomingNumber(input.sid, input.token, input.phone);
  if (!num) return false;
  const base = `${app()}/api/voice/twilio/${input.webhookToken}`;
  const r = await configureNumber(input.sid, input.token, num.sid, { voice: base, status: `${base}/status`, sms: `${app()}/api/channels/sms/${input.webhookToken}` });
  return r.ok;
}
