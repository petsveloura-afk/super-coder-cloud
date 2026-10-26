import "server-only";
import { publicEnv } from "@/lib/env";

/**
 * Wave 19 — Shopify: the business types its store name, approves in Shopify, done.
 * Orders → contacts + "order.created" (automations, ROI); checkouts → abandoned-cart recovery.
 * One-time platform setup (owner): a Shopify app (Partners) with
 *   App URL https://<app>/he/integrations, redirect https://<app>/api/stores/shopify/callback
 *   env SHOPIFY_CLIENT_ID, SHOPIFY_CLIENT_SECRET (API version: SHOPIFY_API_VERSION, default 2025-10)
 */
export const SHOPIFY_SCOPES = "read_orders,read_customers,read_checkouts";
export const SHOPIFY_TOPICS = ["orders/create", "orders/paid", "checkouts/create", "checkouts/update", "app/uninstalled"] as const;

export function shopifyConfigured(): boolean {
  return Boolean(process.env.SHOPIFY_CLIENT_ID && process.env.SHOPIFY_CLIENT_SECRET);
}
const apiVersion = () => (/^\d{4}-\d{2}$/.test(process.env.SHOPIFY_API_VERSION ?? "") ? process.env.SHOPIFY_API_VERSION! : "2025-10");
const appUrl = () => publicEnv.appUrl.replace(/\/$/, "");
const shopBase = (shop: string) => (process.env.SHOPIFY_API_BASE ? process.env.SHOPIFY_API_BASE.replace(/\/$/, "") + `/${shop}` : `https://${shop}`);

export function shopifyAuthorizeUrl(shop: string, state: string): string {
  const u = new URL(`${shopBase(shop)}/admin/oauth/authorize`);
  u.search = new URLSearchParams({ client_id: process.env.SHOPIFY_CLIENT_ID ?? "", scope: SHOPIFY_SCOPES, redirect_uri: `${appUrl()}/api/stores/shopify/callback`, state }).toString();
  return u.toString();
}

export async function shopifyExchange(shop: string, code: string): Promise<{ ok: boolean; token?: string; scope?: string; error?: string }> {
  try {
    const res = await fetch(`${shopBase(shop)}/admin/oauth/access_token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: process.env.SHOPIFY_CLIENT_ID, client_secret: process.env.SHOPIFY_CLIENT_SECRET, code }),
      signal: AbortSignal.timeout(15_000),
      cache: "no-store",
    });
    const j = (await res.json().catch(() => ({}))) as { access_token?: string; scope?: string; error?: string; error_description?: string };
    return res.ok && j.access_token ? { ok: true, token: j.access_token, scope: j.scope } : { ok: false, error: j.error_description ?? j.error ?? `HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** Registers the webhooks (idempotent: Shopify answers 422 "already taken" for existing ones). */
export async function shopifyRegisterWebhooks(shop: string, token: string): Promise<{ ok: number; failed: string[] }> {
  let ok = 0;
  const failed: string[] = [];
  for (const topic of SHOPIFY_TOPICS) {
    try {
      const res = await fetch(`${shopBase(shop)}/admin/api/${apiVersion()}/webhooks.json`, {
        method: "POST",
        headers: { "X-Shopify-Access-Token": token, "Content-Type": "application/json" },
        body: JSON.stringify({ webhook: { topic, address: `${appUrl()}/api/stores/shopify/webhook`, format: "json" } }),
        signal: AbortSignal.timeout(15_000),
        cache: "no-store",
      });
      if (res.ok || res.status === 422) ok++;
      else failed.push(`${topic}:${res.status}`);
    } catch (e) {
      failed.push(`${topic}:${(e as Error).message}`);
    }
  }
  return { ok, failed };
}

/**
 * Wave 26 — first sync right after connecting (and the "sync now" button): pulls the latest orders and
 * abandoned checkouts through the same RPCs the webhooks use, so the CRM/dashboard is populated immediately
 * instead of waiting for the next purchase. Idempotent (record_store_* upsert by external id). Best effort.
 */
export async function shopifyBackfill(orgId: string, shop: string, token: string): Promise<{ orders: number; carts: number; error?: string }> {
  const { shopifyOrder, shopifyCheckout } = await import("@/lib/stores/core");
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const admin = createAdminClient();
  const headers = { "X-Shopify-Access-Token": token, Accept: "application/json" };
  let orders = 0;
  let carts = 0;
  let error: string | undefined;
  try {
    const res = await fetch(`${shopBase(shop)}/admin/api/${apiVersion()}/orders.json?status=any&limit=50&order=created_at%20desc`, { headers, signal: AbortSignal.timeout(20_000), cache: "no-store" });
    if (res.ok) {
      const j = (await res.json().catch(() => ({}))) as { orders?: Record<string, unknown>[] };
      for (const raw of j.orders ?? []) {
        const order = shopifyOrder(raw);
        if (!order) continue;
        const { error: e } = await admin.rpc("record_store_order", { p_org: orgId, p_source: "shopify", p_order: order });
        if (!e) orders++;
      }
    } else error = `orders:${res.status}`;
  } catch (e) {
    error = `orders:${(e as Error).message}`;
  }
  try {
    const res = await fetch(`${shopBase(shop)}/admin/api/${apiVersion()}/checkouts.json?limit=50`, { headers, signal: AbortSignal.timeout(20_000), cache: "no-store" });
    if (res.ok) {
      const j = (await res.json().catch(() => ({}))) as { checkouts?: Record<string, unknown>[] };
      for (const raw of j.checkouts ?? []) {
        const cart = shopifyCheckout(raw);
        if (!cart || raw.completed_at) continue;
        const { error: e } = await admin.rpc("record_store_cart", { p_org: orgId, p_source: "shopify", p_cart: cart });
        if (!e) carts++;
      }
    } else if (res.status !== 403 && res.status !== 404) error = error ?? `checkouts:${res.status}`;
  } catch (e) {
    error = error ?? `checkouts:${(e as Error).message}`;
  }
  return { orders, carts, error };
}

/** Lightweight health probe of a stored token — used by "sync now" to give a plain-words status. */
export async function shopifyPing(shop: string, token: string): Promise<{ ok: boolean; name?: string; status: number }> {
  try {
    const res = await fetch(`${shopBase(shop)}/admin/api/${apiVersion()}/shop.json`, { headers: { "X-Shopify-Access-Token": token }, signal: AbortSignal.timeout(10_000), cache: "no-store" });
    if (!res.ok) return { ok: false, status: res.status };
    const j = (await res.json().catch(() => ({}))) as { shop?: { name?: string } };
    return { ok: true, name: j.shop?.name, status: res.status };
  } catch {
    return { ok: false, status: 0 };
  }
}
