import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/**
 * Wave 26 — "smart" Shopify store recognition.
 *
 * The old field only understood a clean handle (`my-store`). Real people type: the store NAME ("My Store"),
 * their custom domain ("www.mystore.co.il"), the admin address ("admin.shopify.com/store/x"), or a full URL.
 * The resolver turns any of those into the one thing Shopify OAuth needs — `<handle>.myshopify.com` —
 * and verifies it exists *before* the person is sent to Shopify (so they never land on Shopify's 404 page).
 *
 * Additive on purpose: lib/stores/core.ts (normalizeShopInput / validShopDomain) is untouched and still
 * used by the callback, the install route and the webhook.
 */

export type ShopResolveStatus = "found" | "not_found" | "unverified" | "invalid" | "not_shopify";

export interface ShopResolution {
  status: ShopResolveStatus;
  /** `<handle>.myshopify.com` when found / unverified-but-plausible */
  shop: string | null;
  /** the store's public name when Shopify's meta.json told us */
  name: string | null;
  /** how we got there */
  via: "handle" | "admin_url" | "domain" | "none";
  /** other handles we tried (shown as "did you mean") */
  tried: string[];
}

const HANDLE = /^[a-z0-9][a-z0-9-]{0,60}$/;
const MYSHOPIFY = /^([a-z0-9][a-z0-9-]{0,60})\.myshopify\.com$/;
const HOSTNAME = /^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/;

const clean = (raw: string | null | undefined) =>
  (raw ?? "")
    .normalize("NFKC")
    .replace(/[\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, "")
    .trim();

export type ParsedShopInput =
  | { kind: "handles"; handles: string[]; via: "handle" | "admin_url" }
  | { kind: "domain"; host: string }
  | { kind: "invalid"; reason: "empty" | "non_latin" | "bad_chars" | "too_long" };

/** Pure: what did the person type? → candidate handles, or a custom domain to look up. */
export function parseShopInput(raw: string | null | undefined): ParsedShopInput {
  const original = clean(raw);
  if (!original) return { kind: "invalid", reason: "empty" };
  if (original.length > 300) return { kind: "invalid", reason: "too_long" };
  let s = original.toLowerCase().replace(/^[a-z][a-z0-9+.-]*:\/\//, "");

  // admin.shopify.com/store/<handle>[/anything]
  const admin = s.match(/^admin\.shopify\.com\/store\/([a-z0-9][a-z0-9-]*)/);
  if (admin?.[1]) return { kind: "handles", handles: [admin[1]], via: "admin_url" };

  // strip path / query / hash / credentials / port
  s = s.replace(/[/?#].*$/, "").replace(/^[^@]*@/, "").replace(/:\d+$/, "");

  const my = s.match(/^([a-z0-9][a-z0-9-]*)\.myshopify\.(?:com|co|con|cm|comm|com\.)$/);
  if (my?.[1]) return { kind: "handles", handles: [my[1]], via: "handle" };

  // a custom domain: contains a dot and looks like a hostname (shop.co.il, www.mystore.com)
  if (s.includes(".") && !/\s/.test(s)) {
    const host = s.replace(/^www\./, "");
    if (HOSTNAME.test(s)) return { kind: "domain", host: s.startsWith("www.") ? s : host };
    return { kind: "invalid", reason: "bad_chars" };
  }

  // otherwise a store name / handle: build the plausible handle variants Shopify would have generated
  if (/[\u0590-\u05ff\u0600-\u06ff]/.test(s) && !/[a-z0-9]/.test(s)) return { kind: "invalid", reason: "non_latin" };
  const base = s
    .replace(/['’`"]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\s_-]/g, " ")
    .replace(/[_\s]+/g, " ")
    .trim();
  if (!base) return { kind: "invalid", reason: "bad_chars" };
  const hyphen = base.replace(/\s+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  const joined = base.replace(/[\s-]+/g, "");
  const variants = [hyphen, joined, hyphen.replace(/-(store|shop)$/, ""), `${hyphen}-store`, `${hyphen}-shop`, `${hyphen}-il`];
  const handles = [...new Set(variants)].filter((h) => HANDLE.test(h));
  if (!handles.length) return { kind: "invalid", reason: "bad_chars" };
  return { kind: "handles", handles: handles.slice(0, 6), via: "handle" };
}

/* ------------------------------------------------------------------ network (injectable for tests) */

type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

const probeInit = (method = "GET"): RequestInit => ({ method, redirect: "manual", signal: AbortSignal.timeout(6_000), cache: "no-store", headers: { "User-Agent": "SuperCoderCloud/1.0 (+shopify-connect)", Accept: "application/json,text/html;q=0.8" } });

/** private / loopback / link-local / metadata ranges — never fetch these on a user's behalf. */
export function isPrivateIp(ip: string): boolean {
  if (isIP(ip) === 6) {
    const v = ip.toLowerCase();
    return v === "::1" || v === "::" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe80") || (v.startsWith("::ffff:") && isPrivateIp(v.slice(7)));
  }
  const p = ip.split(".").map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n))) return true;
  const [a = 0, b = 0] = p;
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
}

async function safeHost(host: string): Promise<boolean> {
  if (isIP(host) || host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) return false;
  try {
    const addrs = await lookup(host, { all: true });
    return addrs.length > 0 && addrs.every((a) => !isPrivateIp(a.address));
  } catch {
    return false;
  }
}

/** Does `<handle>.myshopify.com` exist? true / false / null (couldn't tell — network). */
export async function probeHandle(handle: string, f: Fetcher = fetch): Promise<boolean | null> {
  try {
    const res = await f(`https://${handle}.myshopify.com/`, probeInit("GET"));
    if (res.headers.get("x-shopid") || res.headers.get("x-shopify-stage")) return true;
    if (res.status === 404) return false;
    if (res.status >= 200 && res.status < 400) return true;
    if ([401, 402, 403, 423, 430].includes(res.status)) return true; // frozen / password / locked shops still exist
    return null;
  } catch (e) {
    const msg = String((e as { cause?: { code?: string } })?.cause?.code ?? (e as Error).message);
    return /ENOTFOUND/.test(msg) ? false : null;
  }
}

/** A custom domain → its myshopify handle (meta.json first, /admin redirect as the fallback). */
export async function shopFromDomain(host: string, f: Fetcher = fetch): Promise<{ shop: string | null; name: string | null; isShopify: boolean | null }> {
  try {
    const m = await f(`https://${host}/meta.json`, probeInit("GET"));
    const isShopify = Boolean(m.headers.get("x-shopid") || m.headers.get("x-shopify-stage") || /shopify/i.test(m.headers.get("server") ?? "") || m.headers.get("powered-by")?.toLowerCase().includes("shopify"));
    if (m.ok && (m.headers.get("content-type") ?? "").includes("json")) {
      const j = (await m.json().catch(() => null)) as { myshopify_domain?: string; name?: string } | null;
      const d = clean(j?.myshopify_domain).toLowerCase();
      if (MYSHOPIFY.test(d)) return { shop: d, name: j?.name ? String(j.name).slice(0, 120) : null, isShopify: true };
    }
    const a = await f(`https://${host}/admin`, probeInit("GET"));
    const loc = a.headers.get("location") ?? "";
    const direct = loc.match(/https?:\/\/([a-z0-9][a-z0-9-]*\.myshopify\.com)/i);
    if (direct?.[1]) return { shop: direct[1].toLowerCase(), name: null, isShopify: true };
    const adm = loc.match(/admin\.shopify\.com\/store\/([a-z0-9][a-z0-9-]*)/i);
    if (adm?.[1]) return { shop: `${adm[1].toLowerCase()}.myshopify.com`, name: null, isShopify: true };
    return { shop: null, name: null, isShopify: isShopify || a.headers.has("x-shopid") ? true : m.status === 404 || a.status === 404 ? false : null };
  } catch {
    return { shop: null, name: null, isShopify: null };
  }
}

/** Public store name for a known handle (best effort, used only to reassure the person). */
async function storeName(shop: string, f: Fetcher): Promise<string | null> {
  try {
    const res = await f(`https://${shop}/meta.json`, probeInit("GET"));
    if (!res.ok) return null;
    const j = (await res.json().catch(() => null)) as { name?: string } | null;
    return j?.name ? String(j.name).slice(0, 120) : null;
  } catch {
    return null;
  }
}

/**
 * The one entry point: anything the person typed → a verified `<handle>.myshopify.com`.
 *  - found       exactly one live store (or the domain told us)
 *  - not_found   every variant answered 404
 *  - unverified  the network could not tell — still plausible, let Shopify decide (never blocks the person)
 *  - not_shopify the domain is not a Shopify store
 *  - invalid     nothing usable was typed
 */
export async function resolveShop(raw: string | null | undefined, f: Fetcher = fetch): Promise<ShopResolution> {
  const parsed = parseShopInput(raw);
  if (parsed.kind === "invalid") return { status: "invalid", shop: null, name: null, via: "none", tried: [] };

  if (parsed.kind === "domain") {
    if (!(await safeHost(parsed.host))) return { status: "invalid", shop: null, name: null, via: "domain", tried: [] };
    const r = await shopFromDomain(parsed.host, f);
    if (r.shop) return { status: "found", shop: r.shop, name: r.name, via: "domain", tried: [] };
    return { status: r.isShopify === false ? "not_shopify" : "unverified", shop: null, name: null, via: "domain", tried: [] };
  }

  const handles = parsed.handles;
  const results = await Promise.all(handles.map(async (h) => ({ h, ok: await probeHandle(h, f) })));
  const hit = results.find((r) => r.ok === true);
  if (hit) return { status: "found", shop: `${hit.h}.myshopify.com`, name: await storeName(`${hit.h}.myshopify.com`, f), via: parsed.via, tried: handles.filter((h) => h !== hit.h) };
  if (results.every((r) => r.ok === false)) return { status: "not_found", shop: null, name: null, via: parsed.via, tried: handles };
  // some probes could not tell → be forgiving: use the primary handle and let Shopify's own screen decide
  const first = handles[0];
  return { status: "unverified", shop: first ? `${first}.myshopify.com` : null, name: null, via: parsed.via, tried: handles.slice(1) };
}
