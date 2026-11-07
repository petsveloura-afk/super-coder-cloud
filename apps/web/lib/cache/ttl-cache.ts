import "server-only";
import { TtlCache } from "./ttl-cache-core";

/**
 * The server's fast context cache (additive).
 *
 *   L1 — in-memory LRU + TTL + single-flight (always on, microseconds).
 *   L2 — optional shared Redis over HTTPS (Upstash REST), only when UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN are
 *        set. Every L2 call has a hard 250ms limit and any failure silently falls back to the real load — the cache can make
 *        things faster, never slower or broken.
 *
 * Only JSON-serializable, organization-level, slow-changing values belong here. Never cache permissions, opt-outs,
 * conversation ownership or anything a customer / owner action must change immediately.
 */

const l1 = new TtlCache(2000);
const L2_TIMEOUT_MS = 250;

function l2Config(): { url: string; token: string } | null {
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  if (!url || !token || !/^https:\/\//.test(url)) return null;
  return { url: url.replace(/\/+$/, ""), token };
}

const NS = "scc:v1:";

async function l2Get<T>(key: string): Promise<T | undefined> {
  const c = l2Config();
  if (!c) return undefined;
  try {
    const res = await fetch(`${c.url}/get/${encodeURIComponent(NS + key)}`, { headers: { Authorization: `Bearer ${c.token}` }, signal: AbortSignal.timeout(L2_TIMEOUT_MS), cache: "no-store" });
    if (!res.ok) return undefined;
    const body = (await res.json()) as { result?: string | null };
    if (body.result == null) return undefined;
    return JSON.parse(body.result) as T;
  } catch {
    return undefined;
  }
}

async function l2Set(key: string, value: unknown, ttlMs: number): Promise<void> {
  const c = l2Config();
  if (!c) return;
  try {
    const px = Math.max(1000, Math.round(ttlMs));
    await fetch(`${c.url}/set/${encodeURIComponent(NS + key)}?px=${px}`, { method: "POST", headers: { Authorization: `Bearer ${c.token}` }, body: JSON.stringify(value), signal: AbortSignal.timeout(L2_TIMEOUT_MS), cache: "no-store" });
  } catch {
    /* the cache never breaks the request */
  }
}

async function l2Del(key: string): Promise<void> {
  const c = l2Config();
  if (!c) return;
  try {
    await fetch(`${c.url}/del/${encodeURIComponent(NS + key)}`, { method: "POST", headers: { Authorization: `Bearer ${c.token}` }, signal: AbortSignal.timeout(L2_TIMEOUT_MS), cache: "no-store" });
  } catch {
    /* ignore */
  }
}

/**
 * Read-through cache. `load` runs only on a miss (once for concurrent callers). When the cache layer itself fails, `load`
 * still runs — callers always get a real answer.
 */
export async function cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  return l1.getOrLoad<T>(key, ttlMs, async () => {
    const shared = await l2Get<T>(key);
    if (shared !== undefined) return shared;
    const v = await load();
    if (v !== undefined) void l2Set(key, v, ttlMs);
    return v;
  });
}

/** drop a key (or "prefix*") — call after a change the cache must not hide */
export async function invalidateCached(keyOrPrefix: string): Promise<void> {
  l1.invalidate(keyOrPrefix);
  if (!keyOrPrefix.endsWith("*")) await l2Del(keyOrPrefix);
}

/** for the health page / tests */
export function cacheStats() {
  return { ...l1.snapshot(), shared: Boolean(l2Config()) };
}
