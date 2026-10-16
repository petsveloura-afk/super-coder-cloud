import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Thin REST clients for the messaging providers (no SDKs). Base URLs can be
 * overridden for tests/proxies: TELEGRAM_API_BASE, WHATSAPP_API_BASE, TWILIO_API_BASE.
 */
const TIMEOUT = 12_000;

export interface ProviderResult {
  ok: boolean;
  status?: number;
  error?: string;
  permanent?: boolean;
  externalId?: string;
  data?: Record<string, unknown>;
}

function permanent(status: number) {
  return status >= 400 && status < 500 && status !== 408 && status !== 429;
}

/* ------------------------------------------------------------ Telegram -- */
const tgBase = () => (process.env.TELEGRAM_API_BASE || "https://api.telegram.org").replace(/\/$/, "");

export async function telegramCall(token: string, method: string, body?: Record<string, unknown>): Promise<ProviderResult> {
  try {
    const res = await fetch(`${tgBase()}/bot${token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body ?? {}),
      signal: AbortSignal.timeout(TIMEOUT),
      cache: "no-store",
    });
    const j = (await res.json().catch(() => ({}))) as { ok?: boolean; result?: Record<string, unknown>; description?: string };
    if (res.ok && j.ok) return { ok: true, status: res.status, data: j.result ?? {}, externalId: j.result?.message_id != null ? String(j.result.message_id) : undefined };
    return { ok: false, status: res.status, error: j.description ?? `HTTP ${res.status}`, permanent: permanent(res.status) };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/* ------------------------------------------------- WhatsApp Cloud API -- */
const waBase = () => (process.env.WHATSAPP_API_BASE || "https://graph.facebook.com/v21.0").replace(/\/$/, "");

export async function whatsappGetPhone(token: string, phoneNumberId: string): Promise<ProviderResult> {
  try {
    const res = await fetch(`${waBase()}/${encodeURIComponent(phoneNumberId)}?fields=display_phone_number,verified_name`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(TIMEOUT),
      cache: "no-store",
    });
    const j = (await res.json().catch(() => ({}))) as Record<string, unknown> & { error?: { message?: string } };
    return res.ok ? { ok: true, status: res.status, data: j } : { ok: false, status: res.status, error: j.error?.message ?? `HTTP ${res.status}`, permanent: permanent(res.status) };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function whatsappSendText(token: string, phoneNumberId: string, toE164: string, text: string): Promise<ProviderResult> {
  try {
    const res = await fetch(`${waBase()}/${encodeURIComponent(phoneNumberId)}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", to: toE164.replace(/^\+/, ""), type: "text", text: { preview_url: true, body: text } }),
      signal: AbortSignal.timeout(TIMEOUT),
      cache: "no-store",
    });
    const j = (await res.json().catch(() => ({}))) as { messages?: { id: string }[]; error?: { message?: string } };
    return res.ok
      ? { ok: true, status: res.status, externalId: j.messages?.[0]?.id }
      : { ok: false, status: res.status, error: j.error?.message ?? `HTTP ${res.status}`, permanent: permanent(res.status) };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** Meta signs webhook bodies with the app secret: X-Hub-Signature-256: sha256=<hex>. */
export function verifyMetaSignature(rawBody: string, header: string | null, appSecret: string): boolean {
  if (!header?.startsWith("sha256=")) return false;
  const expected = Buffer.from(createHmac("sha256", appSecret).update(rawBody).digest("hex"));
  const given = Buffer.from(header.slice(7));
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/* -------------------------------------------------------------- Twilio -- */
const twBase = () => (process.env.TWILIO_API_BASE || "https://api.twilio.com").replace(/\/$/, "");

export async function twilioGetAccount(sid: string, authToken: string): Promise<ProviderResult> {
  try {
    const res = await fetch(`${twBase()}/2010-04-01/Accounts/${encodeURIComponent(sid)}.json`, {
      headers: { Authorization: `Basic ${Buffer.from(`${sid}:${authToken}`).toString("base64")}` },
      signal: AbortSignal.timeout(TIMEOUT),
      cache: "no-store",
    });
    const j = (await res.json().catch(() => ({}))) as Record<string, unknown> & { message?: string };
    return res.ok ? { ok: true, status: res.status, data: j } : { ok: false, status: res.status, error: (j.message as string) ?? `HTTP ${res.status}`, permanent: permanent(res.status) };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function twilioSendSms(sid: string, authToken: string, from: string, to: string, body: string): Promise<ProviderResult> {
  try {
    const res = await fetch(`${twBase()}/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`, {
      method: "POST",
      headers: { Authorization: `Basic ${Buffer.from(`${sid}:${authToken}`).toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ To: to, From: from, Body: body }).toString(),
      signal: AbortSignal.timeout(TIMEOUT),
      cache: "no-store",
    });
    const j = (await res.json().catch(() => ({}))) as { sid?: string; message?: string };
    return res.ok ? { ok: true, status: res.status, externalId: j.sid } : { ok: false, status: res.status, error: j.message ?? `HTTP ${res.status}`, permanent: permanent(res.status) };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** Twilio request signature: base64(HMAC-SHA1(authToken, url + sorted(key+value)…)). */
export function verifyTwilioSignature(url: string, params: Record<string, string>, header: string | null, authToken: string): boolean {
  if (!header) return false;
  const data = url + Object.keys(params).sort().map((k) => k + params[k]).join("");
  const expected = Buffer.from(createHmac("sha1", authToken).update(data).digest("base64"));
  const given = Buffer.from(header);
  return given.length === expected.length && timingSafeEqual(given, expected);
}
