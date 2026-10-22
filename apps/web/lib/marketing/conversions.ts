import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadIntegration, markIntegration } from "@/lib/integrations/store";
import { CONVERSION_PROVIDERS, ga4Body, metaBody, tiktokBody, type ConvEvent, type ConvInput, type ConversionProvider } from "./conversions-core";

/**
 * Wave 17 — job "conversion": a lead / booked meeting / paid invoice is reported to the
 * ad platforms the business connected (Settings → Integrations → Ad conversions).
 * Only for contacts who agreed to marketing (unless the business turned that off).
 */
const base = {
  meta: () => (process.env.META_GRAPH_BASE || "https://graph.facebook.com/v21.0").replace(/\/$/, ""),
  ga4: () => (process.env.GA4_MP_BASE || "https://www.google-analytics.com").replace(/\/$/, ""),
  tiktok: () => (process.env.TIKTOK_API_BASE || "https://business-api.tiktok.com").replace(/\/$/, ""),
};

async function post(url: string, body: unknown, headers: Record<string, string> = {}): Promise<{ ok: boolean; status: number; error?: string }> {
  try {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(12_000), cache: "no-store" });
    const text = await res.text().catch(() => "");
    // TikTok answers 200 with {"code": != 0} on errors
    if (res.ok && /"code"\s*:\s*[1-9]/.test(text) && url.includes("/event/track")) return { ok: false, status: res.status, error: text.slice(0, 300) };
    return res.ok ? { ok: true, status: res.status } : { ok: false, status: res.status, error: text.slice(0, 300) || `HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, status: 0, error: (e as Error).message };
  }
}

export async function sendConversionTo(provider: ConversionProvider, cfg: Record<string, unknown>, secrets: Record<string, string>, input: ConvInput): Promise<{ ok: boolean; status: number; error?: string }> {
  const test = typeof cfg.test_code === "string" && cfg.test_code ? cfg.test_code : null;
  if (provider === "meta_capi") {
    const pixel = String(cfg.pixel_id ?? "");
    if (!/^\d{5,20}$/.test(pixel) || !secrets.access_token) return { ok: false, status: 0, error: "not_configured" };
    return post(`${base.meta()}/${pixel}/events?access_token=${encodeURIComponent(secrets.access_token)}`, metaBody(input, { testCode: test }));
  }
  if (provider === "ga4") {
    const mid = String(cfg.measurement_id ?? "");
    if (!/^G-[A-Z0-9]{4,20}$/.test(mid) || !secrets.api_secret) return { ok: false, status: 0, error: "not_configured" };
    // GA4 answers 2xx even for bad payloads; the debug endpoint is used by "test connection"
    return post(`${base.ga4()}/mp/collect?measurement_id=${encodeURIComponent(mid)}&api_secret=${encodeURIComponent(secrets.api_secret)}`, ga4Body(input));
  }
  const pixel = String(cfg.pixel_code ?? "");
  if (!/^[A-Z0-9]{8,40}$/i.test(pixel) || !secrets.access_token) return { ok: false, status: 0, error: "not_configured" };
  return post(`${base.tiktok()}/open_api/v1.3/event/track/`, tiktokBody(input, pixel, { testCode: test }), { "Access-Token": secrets.access_token });
}

export async function runConversionJob(orgId: string, payload: Record<string, unknown>): Promise<{ ok: boolean; error?: string; permanent?: boolean }> {
  const event = String(payload.event ?? "") as ConvEvent;
  if (!["Lead", "Purchase", "Schedule"].includes(event)) return { ok: false, error: "bad_event", permanent: true };
  const admin = createAdminClient();
  const contactId = typeof payload.contact_id === "string" ? payload.contact_id : null;
  let email: string | null = null;
  let phone: string | null = null;
  let consent = false;
  if (contactId) {
    const { data: c } = await admin.from("contacts").select("email, phone, marketing_consent, opted_out_at").eq("id", contactId).eq("organization_id", orgId).maybeSingle();
    email = (c?.email as string | null) ?? null;
    phone = (c?.phone as string | null) ?? null;
    consent = Boolean(c?.marketing_consent) && !c?.opted_out_at;
  }
  const input: ConvInput = {
    event,
    ref: String(payload.ref ?? `${event}:${contactId ?? "anon"}`).slice(0, 100),
    at: typeof payload.at === "string" ? payload.at : new Date().toISOString(),
    value: payload.value != null ? Number(payload.value) : null,
    currency: typeof payload.currency === "string" ? payload.currency : null,
    email,
    phone,
    contactId,
  };
  let sent = 0;
  let tried = 0;
  let lastError = "";
  for (const p of CONVERSION_PROVIDERS) {
    const integ = await loadIntegration(orgId, p);
    if (!integ || integ.status !== "active") continue;
    const cfg = integ.config;
    if (Array.isArray(cfg.events) && !(cfg.events as string[]).includes(event)) continue;
    // privacy: hashed personal data only for customers who agreed to marketing (default)
    if (cfg.require_consent !== false && !consent) continue;
    tried++;
    const r = await sendConversionTo(p, cfg, integ.secrets, input);
    await markIntegration(integ.id, r.ok, r.error ?? null);
    if (r.ok) sent++;
    else lastError = `${p}:${r.error ?? r.status}`;
  }
  if (tried === 0 || sent > 0) return { ok: true };
  return { ok: false, error: lastError || "conversion_failed" };
}
