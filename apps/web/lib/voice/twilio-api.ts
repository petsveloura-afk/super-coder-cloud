import "server-only";

/**
 * Wave 57 — the few Twilio REST calls that make phones zero-setup:
 *   find / configure a number (Voice URL, status callback, SMS URL) and buy / release numbers.
 * Every call is bounded in time and returns { ok, data | error } — never throws.
 */
const twBase = () => (process.env.TWILIO_API_BASE || "https://api.twilio.com").replace(/\/$/, "");

export interface TwResult<T = Record<string, unknown>> {
  ok: boolean;
  status: number;
  data?: T;
  error?: string;
}

export async function twilioRequest<T = Record<string, unknown>>(sid: string, token: string, method: "GET" | "POST" | "DELETE", path: string, params?: Record<string, string>): Promise<TwResult<T>> {
  const url = `${twBase()}/2010-04-01/Accounts/${encodeURIComponent(sid)}${path}${method === "GET" && params ? `?${new URLSearchParams(params).toString()}` : ""}`;
  try {
    const res = await fetch(url, {
      method,
      headers: { Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`, ...(method === "POST" ? { "Content-Type": "application/x-www-form-urlencoded" } : {}) },
      body: method === "POST" && params ? new URLSearchParams(params).toString() : undefined,
      signal: AbortSignal.timeout(15_000),
      cache: "no-store",
    });
    if (method === "DELETE") return { ok: res.ok || res.status === 404, status: res.status };
    const j = (await res.json().catch(() => ({}))) as T & { message?: string; code?: number };
    return res.ok ? { ok: true, status: res.status, data: j } : { ok: false, status: res.status, error: `${(j as { code?: number }).code ?? res.status}: ${(j as { message?: string }).message ?? `HTTP ${res.status}`}` };
  } catch (e) {
    return { ok: false, status: 0, error: (e as Error).message };
  }
}

interface IncomingNumber {
  sid: string;
  phone_number: string;
}

/** The number's resource in this Twilio account (null when the account does not own it). */
export async function findIncomingNumber(sid: string, token: string, phone: string): Promise<IncomingNumber | null> {
  const r = await twilioRequest<{ incoming_phone_numbers?: IncomingNumber[] }>(sid, token, "GET", "/IncomingPhoneNumbers.json", { PhoneNumber: phone, PageSize: "1" });
  return r.ok ? (r.data?.incoming_phone_numbers?.[0] ?? null) : null;
}

/** Points the number's calls (and optionally SMS) at the platform — what the business used to paste by hand. */
export async function configureNumber(sid: string, token: string, numberSid: string, urls: { voice: string; status: string; sms?: string | null }, friendlyName?: string): Promise<TwResult> {
  return twilioRequest(sid, token, "POST", `/IncomingPhoneNumbers/${encodeURIComponent(numberSid)}.json`, {
    VoiceUrl: urls.voice,
    VoiceMethod: "POST",
    StatusCallback: urls.status,
    StatusCallbackMethod: "POST",
    ...(urls.sms ? { SmsUrl: urls.sms, SmsMethod: "POST" } : {}),
    ...(friendlyName ? { FriendlyName: friendlyName.slice(0, 60) } : {}),
  });
}

/** Buys the first available local number with voice in the country, already wired to the platform. */
export async function buyNumber(sid: string, token: string, country: string, urls: { voice: string; status: string }, friendlyName: string): Promise<TwResult<IncomingNumber>> {
  const search = async (type: "Local" | "Mobile" | "TollFree") =>
    twilioRequest<{ available_phone_numbers?: { phone_number: string }[] }>(sid, token, "GET", `/AvailablePhoneNumbers/${encodeURIComponent(country)}/${type}.json`, { VoiceEnabled: "true", PageSize: "1" });
  let found = await search("Local");
  if (!found.ok || !found.data?.available_phone_numbers?.length) found = await search("Mobile");
  const phone = found.data?.available_phone_numbers?.[0]?.phone_number;
  if (!phone) return { ok: false, status: found.status, error: found.error ?? "no numbers available" };
  return twilioRequest<IncomingNumber>(sid, token, "POST", "/IncomingPhoneNumbers.json", {
    PhoneNumber: phone,
    VoiceUrl: urls.voice,
    VoiceMethod: "POST",
    StatusCallback: urls.status,
    StatusCallbackMethod: "POST",
    FriendlyName: friendlyName.slice(0, 60),
  });
}

export async function releaseNumber(sid: string, token: string, numberSid: string): Promise<boolean> {
  return (await twilioRequest(sid, token, "DELETE", `/IncomingPhoneNumbers/${encodeURIComponent(numberSid)}.json`)).ok;
}
