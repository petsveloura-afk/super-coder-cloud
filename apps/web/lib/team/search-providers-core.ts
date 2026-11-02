/**
 * Upgrade 4c — web-search providers for market research (pure: no network, no secrets, easy to test).
 * Several providers are tried in order until one returns results (automatic failover).
 * Keyed providers switch on by themselves when their environment variable is set; the keyless ones need nothing.
 * Every provider talks to a FIXED host (or, for SearXNG, an https instance the owner listed). Pages are never opened.
 */
import { isPublicSourceUrl } from "./market-intel-core";

export interface SearchHit {
  title: string;
  url: string;
  snippet: string;
}

export type SearchProviderId = "tavily" | "serper" | "brave" | "google_cse" | "searxng" | "duckduckgo";

/** best and fastest first; the keyless one is the safety net */
export const PROVIDER_ORDER: SearchProviderId[] = ["tavily", "serper", "brave", "google_cse", "searxng", "duckduckgo"];

type Env = Record<string, string | undefined>;

const clean = (v: unknown, max: number) =>
  String(v ?? "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);

/** keep only public, non-login http(s) pages, max 8, no duplicates */
export function finalizeHits(raw: SearchHit[]): SearchHit[] {
  const seen = new Set<string>();
  const out: SearchHit[] = [];
  for (const h of raw) {
    const ok = isPublicSourceUrl(h.url);
    if (!ok.ok || seen.has(ok.url)) continue;
    seen.add(ok.url);
    out.push({ title: clean(h.title, 160), url: ok.url, snippet: clean(h.snippet, 400) });
    if (out.length >= 8) break;
  }
  return out;
}

/** SearXNG instances the owner listed (comma separated, https only, public host) */
export function searxngInstances(env: Env): string[] {
  return String(env.SEARXNG_URLS ?? "")
    .split(",")
    .map((x) => x.trim().replace(/\/+$/, ""))
    .filter((x) => /^https:\/\//i.test(x) && isPublicSourceUrl(x).ok)
    .slice(0, 3);
}

/** which providers are usable right now, in trying order */
export function enabledProviders(env: Env): SearchProviderId[] {
  const on: Record<SearchProviderId, boolean> = {
    tavily: !!env.TAVILY_API_KEY,
    serper: !!env.SERPER_API_KEY,
    brave: !!env.BRAVE_SEARCH_API_KEY,
    google_cse: !!env.GOOGLE_CSE_API_KEY && !!env.GOOGLE_CSE_ID,
    searxng: searxngInstances(env).length > 0,
    duckduckgo: String(env.MARKET_SEARCH_KEYLESS ?? "").toLowerCase() !== "off",
  };
  return PROVIDER_ORDER.filter((p) => on[p]);
}

/* ------------------------------------------------------------------ response parsers (one per provider) */

type Obj = Record<string, unknown>;
const arr = (v: unknown): Obj[] => (Array.isArray(v) ? (v.filter((x) => x && typeof x === "object") as Obj[]) : []);
const obj = (v: unknown): Obj => (v && typeof v === "object" ? (v as Obj) : {});

export function parseTavily(j: unknown): SearchHit[] {
  return finalizeHits(arr(obj(j).results).map((r) => ({ title: String(r.title ?? ""), url: String(r.url ?? ""), snippet: String(r.content ?? "") })));
}
export function parseSerper(j: unknown): SearchHit[] {
  return finalizeHits(arr(obj(j).organic).map((r) => ({ title: String(r.title ?? ""), url: String(r.link ?? ""), snippet: String(r.snippet ?? "") })));
}
export function parseBrave(j: unknown): SearchHit[] {
  return finalizeHits(arr(obj(obj(j).web).results).map((r) => ({ title: String(r.title ?? ""), url: String(r.url ?? ""), snippet: String(r.description ?? "") })));
}
export function parseGoogleCse(j: unknown): SearchHit[] {
  return finalizeHits(arr(obj(j).items).map((r) => ({ title: String(r.title ?? ""), url: String(r.link ?? ""), snippet: String(r.snippet ?? "") })));
}
export function parseSearxng(j: unknown): SearchHit[] {
  return finalizeHits(arr(obj(j).results).map((r) => ({ title: String(r.title ?? ""), url: String(r.url ?? ""), snippet: String(r.content ?? "") })));
}

/** DuckDuckGo's html endpoint wraps result links as //duckduckgo.com/l/?uddg=<encoded url> */
export function unwrapDuckLink(href: string): string {
  const h = href.replace(/&amp;/g, "&");
  try {
    const u = new URL(h.startsWith("//") ? `https:${h}` : h, "https://duckduckgo.com");
    const t = u.searchParams.get("uddg");
    if (t) return t;
    return u.hostname.endsWith("duckduckgo.com") ? "" : u.toString();
  } catch {
    return "";
  }
}

/** true when DuckDuckGo answered with its robot check instead of results */
export function duckBlocked(html: string): boolean {
  return /anomaly|unusual traffic|are you a human|challenge-form/i.test(html) && !/result__a/.test(html);
}

export function parseDuckHtml(html: string): SearchHit[] {
  const out: SearchHit[] = [];
  const re = /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>([\s\S]*?)(?=<a[^>]*class="[^"]*result__a|$)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) && out.length < 16) {
    const snip = /class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/(?:a|td|div)>/i.exec(m[3] ?? "");
    out.push({ title: m[2] ?? "", url: unwrapDuckLink(m[1] ?? ""), snippet: snip?.[1] ?? "" });
  }
  return finalizeHits(out);
}
