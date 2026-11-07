/**
 * Fast context cache (additive, pure — no I/O). An in-memory LRU with a time-to-live per entry and single-flight loading:
 * when many requests ask for the same key at the same moment (a burst of customer messages to the same business), the data
 * is loaded ONCE and everyone waits for that one load. A failed load is never cached.
 *
 * Used for slow-changing, organization-level facts the conversation agent needs on every message (can it book, can it take
 * payment). Per-conversation data (messages, the customer's state, opt-outs, who owns the chat) is NEVER cached — it must be
 * read fresh every time.
 *
 * A server instance keeps its own cache (serverless instances are short-lived); `ttl-cache.ts` adds an optional shared
 * Redis layer (Upstash REST) when it is configured.
 */

interface Entry<T> {
  value: T;
  expiresAt: number;
}

export interface CacheStats {
  hits: number;
  misses: number;
  loads: number;
  errors: number;
  size: number;
}

export class TtlCache {
  private readonly map = new Map<string, Entry<unknown>>();
  private readonly inflight = new Map<string, Promise<unknown>>();
  private stats = { hits: 0, misses: 0, loads: 0, errors: 0 };

  constructor(
    private readonly maxEntries = 2000,
    private readonly now: () => number = () => Date.now(),
  ) {}

  /** the cached value, or undefined when missing / expired (an expired entry is removed) */
  get<T>(key: string): T | undefined {
    const e = this.map.get(key);
    if (!e) return undefined;
    if (e.expiresAt <= this.now()) {
      this.map.delete(key);
      return undefined;
    }
    // LRU: a read moves the key to the end
    this.map.delete(key);
    this.map.set(key, e);
    return e.value as T;
  }

  set<T>(key: string, value: T, ttlMs: number): void {
    if (!(ttlMs > 0)) return;
    this.map.delete(key);
    this.map.set(key, { value, expiresAt: this.now() + ttlMs });
    while (this.map.size > this.maxEntries) {
      const oldest = this.map.keys().next().value;
      if (oldest === undefined) break;
      this.map.delete(oldest);
    }
  }

  /** removes one key, or every key that starts with the prefix when it ends with "*" */
  invalidate(keyOrPrefix: string): number {
    if (keyOrPrefix.endsWith("*")) {
      const p = keyOrPrefix.slice(0, -1);
      let n = 0;
      for (const k of [...this.map.keys()]) {
        if (k.startsWith(p)) {
          this.map.delete(k);
          n++;
        }
      }
      return n;
    }
    return this.map.delete(keyOrPrefix) ? 1 : 0;
  }

  clear(): void {
    this.map.clear();
    this.inflight.clear();
  }

  /**
   * Read-through with single-flight: a fresh cached value is returned at once; otherwise ONE load runs for the key and every
   * concurrent caller shares it. A load that throws is not cached (the error goes to every waiting caller).
   */
  async getOrLoad<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
    const hit = this.get<T>(key);
    if (hit !== undefined) {
      this.stats.hits++;
      return hit;
    }
    this.stats.misses++;
    const running = this.inflight.get(key) as Promise<T> | undefined;
    if (running) return running;
    this.stats.loads++;
    const p = (async () => {
      try {
        const v = await load();
        if (v !== undefined) this.set(key, v, ttlMs);
        return v;
      } catch (e) {
        this.stats.errors++;
        throw e;
      } finally {
        this.inflight.delete(key);
      }
    })();
    this.inflight.set(key, p);
    return p;
  }

  snapshot(): CacheStats {
    return { ...this.stats, size: this.map.size };
  }
}
