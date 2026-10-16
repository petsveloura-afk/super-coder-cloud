import "server-only";
import { randomInt } from "node:crypto";

/**
 * Official WhatsApp — Meta "Embedded Signup": the business clicks
 * "Connect WhatsApp", signs in with Facebook in a popup and picks (or creates)
 * its WhatsApp Business number. No tokens to copy.
 *
 * One-time platform setup (owner): a Meta app with WhatsApp + Facebook Login for
 * Business, an Embedded Signup configuration, and the app webhook pointing at
 * /api/channels/meta/whatsapp. Env:
 *   META_APP_ID, META_APP_SECRET, META_WA_CONFIG_ID, META_WEBHOOK_VERIFY_TOKEN
 *   META_GRAPH_VERSION (default v25.0), META_GRAPH_BASE (tests only)
 */

export function metaEmbeddedConfigured(): boolean {
  return /^\d{5,30}$/.test(process.env.META_APP_ID ?? "") && /^[a-f0-9]{32}$/i.test(process.env.META_APP_SECRET ?? "") && /^\d{5,30}$/.test(process.env.META_WA_CONFIG_ID ?? "");
}

export function metaPublicConfig() {
  return metaEmbeddedConfigured()
    ? { appId: process.env.META_APP_ID!, configId: process.env.META_WA_CONFIG_ID!, version: graphVersion() }
    : null;
}

export function graphVersion() {
  const v = process.env.META_GRAPH_VERSION ?? "v25.0";
  return /^v\d{2}\.\d$/.test(v) ? v : "v25.0";
}

const graph = () => (process.env.META_GRAPH_BASE || `https://graph.facebook.com/${graphVersion()}`).replace(/\/$/, "");
const TIMEOUT = 15_000;

async function g(path: string, init: { method?: "GET" | "POST"; token?: string; body?: unknown } = {}) {
  try {
    const res = await fetch(`${graph()}${path}`, {
      method: init.method ?? "GET",
      headers: { ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}), ...(init.body ? { "Content-Type": "application/json" } : {}) },
      body: init.body ? JSON.stringify(init.body) : undefined,
      signal: AbortSignal.timeout(TIMEOUT),
      cache: "no-store",
    });
    const j = (await res.json().catch(() => ({}))) as Record<string, unknown> & { error?: { message?: string; code?: number } };
    return { ok: res.ok, status: res.status, data: j, error: j.error?.message ?? (res.ok ? undefined : `HTTP ${res.status}`) };
  } catch (e) {
    return { ok: false, status: 0, data: {} as Record<string, unknown>, error: (e as Error).message };
  }
}

export interface EmbeddedResult {
  ok: boolean;
  error?: string;
  step?: "token" | "subscribe" | "register" | "phone";
  accessToken?: string;
  config?: Record<string, string>;
  warning?: string;
}

/**
 * Finishes Embedded Signup on the server:
 *   code → business token → subscribe the app to the WABA webhooks →
 *   register the number for Cloud API → read the display number.
 */
export async function completeEmbeddedSignup(input: { code: string; phoneNumberId: string; wabaId: string }): Promise<EmbeddedResult> {
  if (!metaEmbeddedConfigured()) return { ok: false, error: "not_configured" };
  const qs = new URLSearchParams({ client_id: process.env.META_APP_ID!, client_secret: process.env.META_APP_SECRET!, code: input.code });
  const tok = await g(`/oauth/access_token?${qs.toString()}`);
  const accessToken = tok.data.access_token as string | undefined;
  if (!tok.ok || !accessToken) return { ok: false, step: "token", error: tok.error ?? "token_failed" };

  const sub = await g(`/${encodeURIComponent(input.wabaId)}/subscribed_apps`, { method: "POST", token: accessToken });
  if (!sub.ok) return { ok: false, step: "subscribe", error: sub.error };

  let warning: string | undefined;
  const reg = await g(`/${encodeURIComponent(input.phoneNumberId)}/register`, {
    method: "POST",
    token: accessToken,
    body: { messaging_product: "whatsapp", pin: String(randomInt(100000, 999999)) },
  });
  if (!reg.ok) warning = reg.error; // already registered numbers answer with an error — not fatal

  const ph = await g(`/${encodeURIComponent(input.phoneNumberId)}?fields=display_phone_number,verified_name`, { token: accessToken });
  if (!ph.ok) return { ok: false, step: "phone", error: ph.error };
  return {
    ok: true,
    accessToken,
    warning,
    config: {
      phone_number_id: input.phoneNumberId,
      waba_id: input.wabaId,
      display_phone_number: String(ph.data.display_phone_number ?? ""),
      verified_name: String(ph.data.verified_name ?? ""),
      mode: "embedded",
    },
  };
}
