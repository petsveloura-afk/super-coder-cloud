"use server";

import { revalidatePath } from "next/cache";
import { uuidSchema } from "@scc/shared/validators";
import { getOrgContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { ActionState } from "@/lib/action-state";
import { domainContactSchema, normalizeDomain } from "@/lib/site/domain-core";

/**
 * Wave 13 — website domains: search / buy (paid by card, with the platform's
 * commission) and connect an existing domain. Paid plans (site_custom_domain).
 */
const loc = (l: string) => (l === "ar" || l === "en" ? l : "he");

async function guard(locale: string, siteId: string) {
  const ctx = await getOrgContext(loc(locale));
  if (!ctx.can("websites.manage")) return { error: "errors.forbidden" as const };
  const { orgHasFeature } = await import("@/lib/billing/features");
  if (!(await orgHasFeature(ctx.org.id, "site_custom_domain"))) return { error: "plans.locked.site_custom_domain.title" as const };
  const { domainsConfigured } = await import("@/lib/site/domains");
  if (!domainsConfigured()) return { error: "websites.domain.err.notConfigured" as const };
  const id = uuidSchema.safeParse(siteId);
  if (!id.success) return { error: "validation.invalidId" as const };
  const supabase = await createClient();
  const { data: site } = await supabase.from("sites").select("id, slug, status, custom_domain").eq("id", id.data).eq("organization_id", ctx.org.id).maybeSingle();
  if (!site) return { error: "errors.notFound" as const };
  const { data: allowed } = await supabase.rpc("check_rate_limit", { p_key: "domains", p_limit: 60, p_window_seconds: 3600 });
  if (allowed !== true) return { error: "errors.rateLimited" as const };
  return { ctx, site: site as { id: string; slug: string; status: string; custom_domain: string | null } };
}

export async function searchDomainsAction(input: { locale: string; siteId: string; query: string }): Promise<ActionState<{ results: import("@/lib/site/domains").DomainOffer[] }>> {
  const g = await guard(input.locale, input.siteId);
  if ("error" in g) return { error: g.error };
  const q = String(input.query ?? "").trim().slice(0, 100);
  if (q.length < 2) return { error: "websites.domain.err.short" };
  const { searchDomains, domainErrorKey } = await import("@/lib/site/domains");
  try {
    return { ok: true, data: { results: await searchDomains(q) } };
  } catch (e) {
    return { error: domainErrorKey(e) };
  }
}

/** Connect a domain the business already owns. */
export async function connectDomainAction(input: { locale: string; siteId: string; domain: string }): Promise<ActionState<{ status: string }>> {
  const g = await guard(input.locale, input.siteId);
  if ("error" in g) return { error: g.error };
  const domain = normalizeDomain(input.domain);
  if (!domain) return { error: "websites.domain.err.invalid" };
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const admin = createAdminClient();
  const { data: other } = await admin.from("sites").select("id").eq("custom_domain", domain).neq("id", g.site.id).maybeSingle();
  if (other) return { error: "websites.domain.err.inUse" };
  const { attachDomain, detachDomain, domainErrorKey, refreshSiteDomain } = await import("@/lib/site/domains");
  try {
    if (g.site.custom_domain && g.site.custom_domain !== domain) await detachDomain(g.site.custom_domain);
    await attachDomain(domain);
    const { error } = await admin.from("sites").update({ custom_domain: domain, domain_status: "pending", domain_added_at: new Date().toISOString() }).eq("id", g.site.id);
    if (error) return { error: error.code === "23505" ? "websites.domain.err.inUse" : "errors.generic" };
    const r = await refreshSiteDomain(g.site.id, domain);
    await admin.from("audit_logs").insert({ organization_id: g.ctx.org.id, actor_id: g.ctx.userId, action: "domain.connected", entity_type: "site", entity_id: g.site.id, metadata: { domain } });
    revalidatePath(`/${loc(input.locale)}/websites/${g.site.id}`);
    return { ok: true, message: r.status === "active" ? "websites.domain.active" : "websites.domain.added", data: { status: r.status } };
  } catch (e) {
    return { error: domainErrorKey(e) };
  }
}

export async function checkDomainAction(input: { locale: string; siteId: string }): Promise<ActionState<{ status: string }>> {
  const g = await guard(input.locale, input.siteId);
  if ("error" in g) return { error: g.error };
  if (!g.site.custom_domain) return { error: "websites.domain.err.none" };
  const { domainErrorKey, refreshSiteDomain } = await import("@/lib/site/domains");
  try {
    const r = await refreshSiteDomain(g.site.id, g.site.custom_domain);
    revalidatePath(`/${loc(input.locale)}/websites/${g.site.id}`);
    return { ok: true, message: r.status === "active" ? "websites.domain.active" : "websites.domain.stillPending", data: { status: r.status } };
  } catch (e) {
    return { error: domainErrorKey(e) };
  }
}

export async function disconnectDomainAction(input: { locale: string; siteId: string }): Promise<ActionState> {
  const g = await guard(input.locale, input.siteId);
  if ("error" in g) return { error: g.error };
  if (!g.site.custom_domain) return { ok: true };
  const { detachDomain, domainErrorKey } = await import("@/lib/site/domains");
  try {
    await detachDomain(g.site.custom_domain);
  } catch (e) {
    return { error: domainErrorKey(e) };
  }
  const { createAdminClient } = await import("@/lib/supabase/admin");
  await createAdminClient().from("sites").update({ custom_domain: null, domain_status: null, domain_verification: null }).eq("id", g.site.id);
  revalidatePath(`/${loc(input.locale)}/websites/${g.site.id}`);
  return { ok: true, message: "websites.domain.removed" };
}

/** Starts a domain purchase: re-checks availability + price, saves the order and creates the card payment. */
export async function createDomainOrderAction(input: { locale: string; siteId: string; domain: string; contact: unknown }): Promise<ActionState<{ paypalOrderId: string; approveUrl: string | null; price: number; currency: string }>> {
  const locale = loc(input.locale);
  const g = await guard(locale, input.siteId);
  if ("error" in g) return { error: g.error };
  const domain = normalizeDomain(input.domain);
  if (!domain) return { error: "websites.domain.err.invalid" };
  const contact = domainContactSchema.safeParse(input.contact);
  if (!contact.success) return { error: "websites.domain.err.contact" };
  const { paypalConfigured, paypalCreateOrder } = await import("@/lib/billing/paypal");
  if (!paypalConfigured()) return { error: "billing.notConfigured" };
  const { checkDomain, domainErrorKey } = await import("@/lib/site/domains");
  let offer;
  try {
    offer = await checkDomain(domain);
  } catch (e) {
    return { error: domainErrorKey(e) };
  }
  if (!offer.available || !offer.cost || !offer.price) return { error: offer.premium ? "websites.domain.err.premium" : "websites.domain.err.taken" };
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const admin = createAdminClient();
  const { data: row, error } = await admin
    .from("domain_orders")
    .insert({ organization_id: g.ctx.org.id, site_id: g.site.id, domain, years: 1, cost: offer.cost, price: offer.price, currency: "USD", contact: contact.data, created_by: g.ctx.userId })
    .select("id")
    .single();
  if (error || !row) return { error: "errors.generic" };
  const { publicEnv } = await import("@/lib/env");
  const app = publicEnv.appUrl.replace(/\/$/, "");
  try {
    const order = await paypalCreateOrder({
      customId: `dom:${row.id}`,
      description: `Domain ${domain} (1 year)`,
      amount: offer.price,
      currency: "USD",
      requestId: `scc-dom-${row.id}`,
      returnUrl: `${app}/api/billing/paypal/domain-return?locale=${locale}&site=${g.site.id}`,
      cancelUrl: `${app}/${locale}/websites/${g.site.id}?domain=canceled`,
      locale,
    });
    await admin.from("domain_orders").update({ provider_order_id: order.id }).eq("id", row.id);
    return { ok: true, data: { paypalOrderId: order.id, approveUrl: order.approveUrl, price: offer.price, currency: "USD" } };
  } catch (e) {
    console.error("domain order create failed", (e as Error).message);
    await admin.from("domain_orders").update({ status: "canceled", error: "payment_create_failed" }).eq("id", row.id);
    return { error: "billing.providerError" };
  }
}

/** The in-page card form approved the payment → capture, register, attach. */
export async function captureDomainOrderAction(input: { locale: string; siteId: string; paypalOrderId: string }): Promise<ActionState<{ status: string }>> {
  const g = await guard(input.locale, input.siteId);
  if ("error" in g) return { error: g.error };
  if (!/^[A-Z0-9]{8,40}$/.test(input.paypalOrderId)) return { error: "validation.invalidId" };
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const { data: mine } = await createAdminClient().from("domain_orders").select("id").eq("provider_order_id", input.paypalOrderId).eq("organization_id", g.ctx.org.id).maybeSingle();
  if (!mine) return { error: "errors.notFound" };
  const { processDomainPayment } = await import("@/lib/site/domains");
  try {
    const r = await processDomainPayment(input.paypalOrderId);
    revalidatePath(`/${loc(input.locale)}/websites/${g.site.id}`);
    if (!r.handled) return { error: "errors.notFound" };
    if (r.status === "failed") return { error: "websites.domain.err.registerFailed" };
    return { ok: true, message: r.status === "active" ? "websites.domain.bought" : "websites.domain.processing", data: { status: r.status } };
  } catch (e) {
    console.error("domain capture failed", (e as Error).message);
    return { error: "billing.pay.err.capture_failed" };
  }
}
