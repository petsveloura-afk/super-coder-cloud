import { createHash, createHmac, timingSafeEqual } from "node:crypto";

/**
 * Wave 19 — online stores (pure, unit-tested): normalise Shopify / WooCommerce payloads to one
 * order / cart shape for record_store_order / record_store_cart, and verify webhook signatures.
 */
export interface StoreOrder {
  id: string;
  number: string | null;
  email: string | null;
  phone: string | null;
  name: string | null;
  total: number;
  currency: string;
  status: string;
  consent: boolean;
  placed_at: string | null;
  items: { name: string; qty: number; price: number }[];
}

export interface StoreCart {
  id: string;
  email: string | null;
  phone: string | null;
  name: string | null;
  total: number;
  currency: string;
  checkout_url: string | null;
  consent: boolean;
  items: { name: string; qty: number; price: number }[];
}

const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : 0;
};
const str = (v: unknown, max = 160) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
const fullName = (f: unknown, l: unknown) => {
  const n = `${typeof f === "string" ? f : ""} ${typeof l === "string" ? l : ""}`.trim();
  return n ? n.slice(0, 160) : null;
};

type Obj = Record<string, unknown>;
const o = (v: unknown): Obj => (v && typeof v === "object" ? (v as Obj) : {});

export function shopifyOrder(p: Obj): StoreOrder | null {
  if (!p.id) return null;
  const c = o(p.customer);
  const ship = o(p.shipping_address);
  const bill = o(p.billing_address);
  return {
    id: String(p.id),
    number: str(p.name ?? p.order_number, 60),
    email: str(p.email ?? p.contact_email ?? c.email, 200),
    phone: str(p.phone ?? c.phone ?? ship.phone ?? bill.phone, 40),
    name: fullName(c.first_name ?? ship.first_name ?? bill.first_name, c.last_name ?? ship.last_name ?? bill.last_name),
    total: num(p.total_price ?? p.current_total_price),
    currency: (str(p.currency, 3) ?? "ILS").toUpperCase(),
    status: str(p.financial_status, 40) ?? "paid",
    consent: Boolean(p.buyer_accepts_marketing ?? c.accepts_marketing ?? o(c.email_marketing_consent).state === "subscribed"),
    placed_at: str(p.created_at ?? p.processed_at, 40),
    items: (Array.isArray(p.line_items) ? (p.line_items as Obj[]) : []).slice(0, 50).map((li) => ({ name: str(li.title ?? li.name, 200) ?? "", qty: Math.max(0, Math.round(Number(li.quantity) || 0)), price: num(li.price) })),
  };
}

export function shopifyCheckout(p: Obj): StoreCart | null {
  if (!p.id && !p.token) return null;
  const c = o(p.customer);
  const ship = o(p.shipping_address);
  const url = str(p.abandoned_checkout_url, 1500);
  return {
    id: String(p.id ?? p.token),
    email: str(p.email ?? c.email, 200),
    phone: str(p.phone ?? c.phone ?? ship.phone, 40),
    name: fullName(c.first_name ?? ship.first_name, c.last_name ?? ship.last_name),
    total: num(p.total_price),
    currency: (str(p.currency ?? p.presentment_currency, 3) ?? "ILS").toUpperCase(),
    checkout_url: url && /^https:\/\//.test(url) ? url : null,
    consent: Boolean(p.buyer_accepts_marketing),
    items: (Array.isArray(p.line_items) ? (p.line_items as Obj[]) : []).slice(0, 50).map((li) => ({ name: str(li.title, 200) ?? "", qty: Math.max(0, Math.round(Number(li.quantity) || 0)), price: num(li.price) })),
  };
}

export function wooOrder(p: Obj): StoreOrder | null {
  if (!p.id) return null;
  const b = o(p.billing);
  return {
    id: String(p.id),
    number: str(p.number ?? p.id, 60),
    email: str(b.email, 200),
    phone: str(b.phone, 40),
    name: fullName(b.first_name, b.last_name),
    total: num(p.total),
    currency: (str(p.currency, 3) ?? "ILS").toUpperCase(),
    status: str(p.status, 40) ?? "processing",
    consent: false,
    placed_at: str(p.date_created_gmt ? `${p.date_created_gmt}Z` : p.date_created, 40),
    items: (Array.isArray(p.line_items) ? (p.line_items as Obj[]) : []).slice(0, 50).map((li) => ({ name: str(li.name, 200) ?? "", qty: Math.max(0, Math.round(Number(li.quantity) || 0)), price: num(li.price ?? li.total) })),
  };
}

/** Shopify: base64 HMAC-SHA256 of the raw body with the app secret. */
export function verifyShopifyWebhook(raw: string, header: string | null, secret: string): boolean {
  if (!header || !secret) return false;
  const expected = Buffer.from(createHmac("sha256", secret).update(raw, "utf8").digest("base64"));
  const given = Buffer.from(header);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** Shopify OAuth callback: hex HMAC of the sorted query (without hmac) with the app secret. */
export function verifyShopifyQuery(params: URLSearchParams, secret: string): boolean {
  const hmac = params.get("hmac") ?? "";
  const msg = [...params.entries()].filter(([k]) => k !== "hmac" && k !== "signature").sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join("&");
  const expected = Buffer.from(createHmac("sha256", secret).update(msg).digest("hex"));
  const given = Buffer.from(hmac);
  return Boolean(secret) && given.length === expected.length && timingSafeEqual(given, expected);
}

/**
 * Wave 25 — forgiving store-name input. Accepts what people really paste:
 * admin.shopify.com/store/my-store, https://my-store.myshopify.com/admin, my-store.myshopify.co (typo),
 * "My Store " with capitals/spaces, a bare my-store. Always resolves to <name>.myshopify.com or null.
 */
export function normalizeShopInput(raw: string | null | undefined): string {
  let s = (raw ?? "").trim().toLowerCase().replace(/[\u200e\u200f\u202a-\u202e]/g, "");
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
  const admin = s.match(/^admin\.shopify\.com\/store\/([a-z0-9][a-z0-9-]*)/);
  if (admin) return admin[1] ?? "";
  s = s.replace(/[/?#].*$/, "").replace(/\s+/g, "");
  s = s.replace(/\.myshopify\.(co|con|cm|comm|com\.?)$/, ".myshopify.com");
  return s;
}

export function validShopDomain(shop: string | null | undefined): string | null {
  const s = normalizeShopInput(shop);
  if (/^[a-z0-9][a-z0-9-]{0,60}\.myshopify\.com$/.test(s)) return s;
  if (/^[a-z0-9][a-z0-9-]{0,60}$/.test(s)) return `${s}.myshopify.com`;
  return null;
}

/** WooCommerce: base64 HMAC-SHA256 of the raw body with the webhook secret. */
export function verifyWooWebhook(raw: string, header: string | null, secret: string): boolean {
  return verifyShopifyWebhook(raw, header, secret);
}

/** A store URL the business typed → https origin (no paths, no private hosts are checked here). */
export function storeOrigin(input: string): string | null {
  try {
    const u = new URL(/^https?:\/\//i.test(input.trim()) ? input.trim() : `https://${input.trim()}`);
    if (u.protocol !== "https:" || !u.hostname.includes(".")) return null;
    return u.origin;
  } catch {
    return null;
  }
}

export const hookHash = (token: string) => createHash("sha256").update(token).digest("hex");
