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
  step?: "token" | "waba" | "subscribe" | "register" | "phone";
  accessToken?: string;
  config?: Record<string, string>;
  warning?: string;
}

/**
 * Finishes Embedded Signup on the server:
 *   code → business token → (find the WABA + number if the popup did not report them) →
 *   subscribe the app to the WABA webhooks → register the number for Cloud API → read the display number.
 */
export async function completeEmbeddedSignup(input: { code: string; phoneNumberId: string; wabaId: string; locale?: string }): Promise<EmbeddedResult> {
  if (!metaEmbeddedConfigured()) return { ok: false, error: "not_configured" };
  // A code from the Facebook JS SDK popup is bound to the redirect_uri the SDK used. Depending on the
  // app / SDK version Meta expects it omitted, empty, or the page the popup was opened from — try them in
  // that order, and only move on while Meta complains about the redirect_uri / URL domain.
  const site = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "");
  const loc = input.locale === "en" || input.locale === "ar" ? input.locale : "he";
  const redirectCandidates: (string | undefined)[] = [
    undefined,
    "",
    ...(site && !/localhost/.test(site) ? [`${site}/${loc}/integrations`, site, `${site}/`] : []),
  ];
  let tok: Awaited<ReturnType<typeof g>> = { ok: false, status: 0, data: {}, error: "token_failed" };
  const attempts: string[] = [];
  for (const redirect of redirectCandidates) {
    const qs = new URLSearchParams({ client_id: process.env.META_APP_ID!, client_secret: process.env.META_APP_SECRET!, code: input.code });
    if (redirect !== undefined) qs.set("redirect_uri", redirect);
    tok = await g(`/oauth/access_token?${qs.toString()}`);
    if (tok.ok && tok.data.access_token) break;
    attempts.push(`[${redirect === undefined ? "none" : redirect === "" ? "empty" : redirect}] ${tok.error ?? "failed"}`);
    // keep trying only for redirect_uri / App Domains complaints (Meta words these in the user's language,
    // so also match on the error code 36008 / 191 / 100 family)
    const code = (tok.data.error as { code?: number } | undefined)?.code;
    if (!/redirect_uri|domain|URL/i.test(tok.error ?? "") && ![191, 36008, 100].includes(code ?? 0)) break;
  }
  if (!tok.ok || !tok.data.access_token) {
    // Diagnostics (no secrets): does the server's app id + secret pair work at all, and which app is it?
    const appId = process.env.META_APP_ID ?? "";
    const secret = process.env.META_APP_SECRET ?? "";
    const chk = await g(`/${encodeURIComponent(appId)}?${new URLSearchParams({ fields: "id,name", access_token: `${appId}|${secret}` }).toString()}`);
    const diag = `diag: app=…${appId.slice(-4)} secretLen=${secret.length} appCheck=${chk.ok ? `ok(${String(chk.data.id ?? "").slice(-4)})` : (chk.error ?? "failed").slice(0, 80)}`;
    return { ok: false, step: "token", error: `${attempts[0] ?? tok.error ?? "token_failed"} | ${diag}`.slice(0, 600) };
  }
  const accessToken = tok.data.access_token as string | undefined;
  if (!tok.ok || !accessToken) return { ok: false, step: "token", error: tok.error ?? "token_failed" };

  // The popup's FINISH message is not always delivered (Coexistence, blockers, slow networks).
  // The token itself knows which WABA the customer granted — read it from Meta instead of failing.
  let wabaId = input.wabaId;
  let phoneNumberId = input.phoneNumberId;
  if (!wabaId) {
    const dbg = await g(`/debug_token?${new URLSearchParams({ input_token: accessToken, access_token: `${process.env.META_APP_ID}|${process.env.META_APP_SECRET}` }).toString()}`);
    const scopes = ((dbg.data.data as { granular_scopes?: { scope?: string; target_ids?: string[] }[] } | undefined)?.granular_scopes ?? []) as { scope?: string; target_ids?: string[] }[];
    wabaId =
      scopes.find((s) => s.scope === "whatsapp_business_management")?.target_ids?.find((id) => /^\d{5,30}$/.test(id)) ??
      scopes.find((s) => s.scope === "whatsapp_business_messaging")?.target_ids?.find((id) => /^\d{5,30}$/.test(id)) ??
      "";
    if (!wabaId) return { ok: false, step: "waba", error: dbg.error ?? "no_waba_granted" };
  }
  if (!phoneNumberId) {
    const nums = await g(`/${encodeURIComponent(wabaId)}/phone_numbers?fields=id,display_phone_number,verified_name`, { token: accessToken });
    const list = ((nums.data.data as { id?: string }[] | undefined) ?? []).filter((n) => /^\d{5,30}$/.test(n.id ?? ""));
    phoneNumberId = list[0]?.id ?? "";
    if (!phoneNumberId) return { ok: false, step: "phone", error: nums.error ?? "no_phone_number" };
  }

  const sub = await g(`/${encodeURIComponent(wabaId)}/subscribed_apps`, { method: "POST", token: accessToken });
  if (!sub.ok) return { ok: false, step: "subscribe", error: sub.error };

  let warning: string | undefined;
  const reg = await g(`/${encodeURIComponent(phoneNumberId)}/register`, {
    method: "POST",
    token: accessToken,
    body: { messaging_product: "whatsapp", pin: String(randomInt(100000, 999999)) },
  });
  if (!reg.ok) warning = reg.error; // already registered numbers answer with an error — not fatal

  const ph = await g(`/${encodeURIComponent(phoneNumberId)}?fields=display_phone_number,verified_name`, { token: accessToken });
  if (!ph.ok) return { ok: false, step: "phone", error: ph.error };
  return {
    ok: true,
    accessToken,
    warning,
    config: {
      phone_number_id: phoneNumberId,
      waba_id: wabaId,
      display_phone_number: String(ph.data.display_phone_number ?? ""),
      verified_name: String(ph.data.verified_name ?? ""),
      mode: "embedded",
    },
  };
}
