import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { customerPrice, dnsRecords, domainCandidates, pricingFromEnv, registrarPhone, type DomainContact } from "./domain-core";

/**
 * Wave 13 — custom domains for published websites, through the platform's Vercel
 * project:
 *   • connect a domain the customer already owns (added to the project; the customer
 *     points DNS; we verify and switch the site to it)
 *   • buy a new domain: availability + price from the Vercel registrar, the customer
 *     pays cost + commission by card (PayPal), and only after the payment is captured
 *     and verified the platform buys the domain and attaches it — automatic refund if
 *     the registration fails.
 *
 * Env: VERCEL_API_TOKEN, VERCEL_PROJECT_ID (id or name), VERCEL_TEAM_ID (optional),
 *      DOMAIN_MARKUP_PERCENT / DOMAIN_MIN_FEE_USD / DOMAIN_MAX_COST_USD,
 *      VERCEL_API_BASE (tests only).
 */
export function domainsConfigured(): boolean {
  return Boolean((process.env.VERCEL_API_TOKEN ?? "").trim() && (process.env.VERCEL_PROJECT_ID ?? "").trim());
}

const vbase = () => (process.env.VERCEL_API_BASE || "https://api.vercel.com").replace(/\/$/, "");
const project = () => encodeURIComponent((process.env.VERCEL_PROJECT_ID ?? "").trim());
const withTeam = (path: string) => {
  const team = (process.env.VERCEL_TEAM_ID ?? "").trim();
  return team ? `${path}${path.includes("?") ? "&" : "?"}teamId=${encodeURIComponent(team)}` : path;
};

class VercelError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

async function vc<T = Record<string, unknown>>(path: string, init: { method?: "GET" | "POST" | "DELETE"; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`${vbase()}${withTeam(path)}`, {
    method: init.method ?? "GET",
    headers: { Authorization: `Bearer ${(process.env.VERCEL_API_TOKEN ?? "").trim()}`, "Content-Type": "application/json" },
    body: init.body ? JSON.stringify(init.body) : undefined,
    signal: AbortSignal.timeout(25_000),
    cache: "no-store",
  });
  const text = await res.text();
  let j: Record<string, unknown> = {};
  try {
    j = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    j = {};
  }
  if (!res.ok) {
    const err = (j.error ?? {}) as { code?: string; message?: string };
    throw new VercelError(res.status, err.code ?? `http_${res.status}`, err.message ?? `vercel ${res.status}`);
  }
  return j as T;
}

export function domainErrorKey(e: unknown): string {
  if (e instanceof VercelError) {
    if (e.status === 401 || e.status === 403) return "websites.domain.err.auth";
    if (/domain_already_in_use|already_exists|domain_taken|conflict/i.test(e.code) || e.status === 409) return "websites.domain.err.inUse";
    if (e.status === 400) return "websites.domain.err.invalid";
    if (e.status === 429) return "websites.domain.err.busy";
  }
  return "websites.domain.err.generic";
}

/* ---------------------------------------------------------------- search */
export interface DomainOffer {
  domain: string;
  available: boolean;
  cost?: number;
  renewal?: number;
  price?: number;
  currency: "USD";
  /** too expensive for automatic purchase (premium) */
  premium?: boolean;
}

export async function checkDomain(domain: string): Promise<DomainOffer> {
  const a = await vc<{ available: boolean | string }>(`/v1/registrar/domains/${encodeURIComponent(domain)}/availability`);
  const available = a.available === true || a.available === "true";
  if (!available) return { domain, available: false, currency: "USD" };
  const p = await vc<{ purchasePrice: number | string | null; renewalPrice?: number | string | null; years?: number }>(`/v1/registrar/domains/${encodeURIComponent(domain)}/price?years=1`);
  const cost = Number(p.purchasePrice);
  if (!Number.isFinite(cost) || cost <= 0) return { domain, available: false, currency: "USD" };
  const pricing = pricingFromEnv();
  if (cost > pricing.maxCost) return { domain, available: true, cost, premium: true, currency: "USD" };
  return { domain, available: true, cost, renewal: Number(p.renewalPrice) || undefined, price: customerPrice(cost, pricing).price, currency: "USD" };
}

export async function searchDomains(query: string): Promise<DomainOffer[]> {
  const list = domainCandidates(query, 6);
  const out = await Promise.all(
    list.map(async (d) => {
      try {
        return await checkDomain(d);
      } catch (e) {
        if (e instanceof VercelError && (e.status === 401 || e.status === 403)) throw e;
        return { domain: d, available: false, currency: "USD" as const };
      }
    }),
  );
  return out;
}

/* ------------------------------------------------------- project domains */
interface ProjectDomain {
  name: string;
  verified: boolean;
  verification?: { type: string; domain: string; value: string; reason?: string }[];
}

const isApex = (d: string) => d.split(".").length === 2 || (d.split(".").length === 3 && /\.(co|org|net|ac|gov|muni)\.(il|uk)$/.test(d));

/** Adds the domain (and www → domain redirect for apex domains) to the platform's project. */
export async function attachDomain(domain: string): Promise<ProjectDomain> {
  let main: ProjectDomain;
  try {
    main = await vc<ProjectDomain>(`/v10/projects/${project()}/domains`, { method: "POST", body: { name: domain } });
  } catch (e) {
    // already on this project (e.g. a retry) → read it
    if (e instanceof VercelError && e.status === 409) main = await vc<ProjectDomain>(`/v9/projects/${project()}/domains/${encodeURIComponent(domain)}`);
    else throw e;
  }
  if (isApex(domain)) {
    try {
      await vc(`/v10/projects/${project()}/domains`, { method: "POST", body: { name: `www.${domain}`, redirect: domain, redirectStatusCode: 308 } });
    } catch {
      /* www is optional */
    }
  }
  return main;
}

export async function detachDomain(domain: string): Promise<void> {
  for (const d of isApex(domain) ? [`www.${domain}`, domain] : [domain]) {
    try {
      await vc(`/v9/projects/${project()}/domains/${encodeURIComponent(d)}`, { method: "DELETE" });
    } catch (e) {
      if (!(e instanceof VercelError && e.status === 404)) throw e;
    }
  }
}

/** Ownership verified on the project + DNS pointing at Vercel → the site can switch to it. */
export async function domainState(domain: string): Promise<{ verified: boolean; configured: boolean; verification: ProjectDomain["verification"] }> {
  let pd: ProjectDomain;
  try {
    pd = await vc<ProjectDomain>(`/v9/projects/${project()}/domains/${encodeURIComponent(domain)}`);
    if (!pd.verified) pd = await vc<ProjectDomain>(`/v9/projects/${project()}/domains/${encodeURIComponent(domain)}/verify`, { method: "POST" }).catch(() => pd);
  } catch (e) {
    if (e instanceof VercelError && e.status === 404) return { verified: false, configured: false, verification: [] };
    throw e;
  }
  const cfg = await vc<{ misconfigured?: boolean }>(`/v6/domains/${encodeURIComponent(domain)}/config`).catch(() => ({ misconfigured: true }));
  return { verified: Boolean(pd.verified), configured: cfg.misconfigured === false, verification: pd.verification ?? [] };
}

/** Recomputes a site's domain status and stores it (service role — users cannot set it). */
export async function refreshSiteDomain(siteId: string, domain: string): Promise<{ status: "pending" | "active"; records: ReturnType<typeof dnsRecords> }> {
  const st = await domainState(domain);
  const status = st.verified && st.configured ? "active" : "pending";
  const records = dnsRecords(domain, (st.verification ?? []).map((v) => ({ type: v.type, domain: v.domain, value: v.value })));
  await createAdminClient()
    .from("sites")
    .update({ domain_status: status, domain_verification: { records, verified: st.verified, configured: st.configured, checked_at: new Date().toISOString() } })
    .eq("id", siteId)
    .eq("custom_domain", domain);
  return { status, records };
}

/* -------------------------------------------------------------- purchase */
/** Buys the domain on the platform's Vercel account (called only after the customer's payment is verified). */
export async function registerDomain(domain: string, expectedPrice: number, contact: DomainContact): Promise<{ orderId: string | null }> {
  const r = await vc<{ orderId?: string; id?: string }>(`/v1/registrar/domains/${encodeURIComponent(domain)}/buy`, {
    method: "POST",
    body: {
      autoRenew: (process.env.DOMAIN_AUTO_RENEW ?? "").trim() === "true",
      years: 1,
      expectedPrice,
      contactInformation: {
        firstName: contact.firstName,
        lastName: contact.lastName,
        email: contact.email,
        phone: registrarPhone(contact.phone),
        address1: contact.address1,
        city: contact.city,
        state: contact.state,
        zip: contact.zip,
        country: contact.country,
        ...(contact.companyName ? { companyName: contact.companyName } : {}),
      },
    },
  });
  return { orderId: r.orderId ?? r.id ?? null };
}

export type DomainPaymentResult = { handled: false } | { handled: true; status: "active" | "registering" | "failed" | "pending_payment" | "canceled" | "paid"; siteId: string | null; orgId: string; domain: string; error?: string };

/**
 * After the customer paid (return page, in-page card form or PayPal webhook): capture,
 * verify the amount, register the domain, attach it to the site. Idempotent and safe to
 * run concurrently (the status moves pending_payment → registering only once).
 */
export async function processDomainPayment(paypalOrderId: string): Promise<DomainPaymentResult> {
  const admin = createAdminClient();
  const { data: row } = await admin.from("domain_orders").select("*").eq("provider_order_id", paypalOrderId).maybeSingle();
  if (!row) return { handled: false };
  const base = { siteId: (row.site_id as string | null) ?? null, orgId: row.organization_id as string, domain: row.domain as string };
  if (row.status !== "pending_payment") return { handled: true, status: row.status as "active", ...base, error: (row.error as string | null) ?? undefined };

  const { paypalCaptureOrder, paypalRefundCapture } = await import("@/lib/billing/paypal");
  const order = await paypalCaptureOrder(paypalOrderId);
  if (!order || order.status !== "COMPLETED" || !order.capture || order.capture.status !== "COMPLETED") return { handled: true, status: "pending_payment", ...base };
  if (order.customId !== `dom:${row.id}`) return { handled: true, status: "pending_payment", ...base, error: "mismatch" };

  // only one runner moves the order forward
  const { data: claimed } = await admin
    .from("domain_orders")
    .update({ status: "paid", updated_at: new Date().toISOString() })
    .eq("id", row.id)
    .eq("status", "pending_payment")
    .select("id")
    .maybeSingle();
  if (!claimed) {
    const { data: now } = await admin.from("domain_orders").select("status, error").eq("id", row.id).maybeSingle();
    return { handled: true, status: (now?.status as "active") ?? "paid", ...base, error: (now?.error as string | null) ?? undefined };
  }
  const fail = async (error: string) => {
    const refunded = await paypalRefundCapture(order.capture!.id, `scc-dom-refund-${row.id}`);
    await admin
      .from("domain_orders")
      .update({ status: "failed", error: `${error}${refunded ? " (refunded)" : " (refund failed — handle manually)"}`.slice(0, 500), contact: null, updated_at: new Date().toISOString() })
      .eq("id", row.id);
    return { handled: true as const, status: "failed" as const, ...base, error };
  };
  // the customer paid exactly what we asked (never less), in USD
  if (order.capture.currency !== String(row.currency) || order.capture.amount + 0.01 < Number(row.price)) return fail("amount_mismatch");

  await admin.from("domain_orders").update({ status: "registering", updated_at: new Date().toISOString() }).eq("id", row.id);
  let registrarOrder: string | null = null;
  try {
    const reg = await registerDomain(base.domain, Number(row.cost), row.contact as DomainContact);
    registrarOrder = reg.orderId;
  } catch (e) {
    console.error("domain registration failed", (e as Error).message);
    return fail(`registration_failed: ${(e as Error).message}`.slice(0, 300));
  }
  // attach to the site (the purchase itself succeeded — attaching problems are retried from the UI)
  let siteStatus: "pending" | "active" = "pending";
  if (base.siteId) {
    try {
      await attachDomain(base.domain);
      const { error } = await admin.from("sites").update({ custom_domain: base.domain, domain_status: "pending", domain_added_at: new Date().toISOString() }).eq("id", base.siteId);
      if (!error) siteStatus = (await refreshSiteDomain(base.siteId, base.domain)).status;
    } catch (e) {
      console.error("domain attach after purchase failed", (e as Error).message);
    }
  }
  await admin.from("domain_orders").update({ status: "active", registrar_order_id: registrarOrder, contact: null, error: siteStatus === "active" ? null : "dns_pending", updated_at: new Date().toISOString() }).eq("id", row.id);
  await admin.from("audit_logs").insert({ organization_id: base.orgId, actor_id: row.created_by, action: "domain.purchased", entity_type: "site", entity_id: base.siteId, metadata: { domain: base.domain, price: Number(row.price), cost: Number(row.cost) } });
  return { handled: true, status: "active", ...base };
}
