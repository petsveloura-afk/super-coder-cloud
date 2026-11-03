/**
 * Upgrade 7 / stage I — speed and reliability (pure): an optimistic action runner (the screen answers at once, a failure puts
 * everything back), a short context cache with explicit invalidation, and model routing by COST (cheap model for low-risk work,
 * the strong one only where a mistake is expensive).
 */
import type { Route } from "./decision-core";
import type { TaskKind } from "./routing-core";

export type OptimisticResult<T> = { ok: true; value: T } | { ok: false; error: string };

/**
 * Applies the change to the screen state immediately, runs the server action, and on ANY failure restores the previous state.
 * `set` receives the state; `apply` computes the optimistic state; `commit` is the server call.
 */
export async function optimistic<S, R>(get: () => S, set: (s: S) => void, apply: (s: S) => S, commit: () => Promise<{ error?: string; data?: R }>): Promise<OptimisticResult<R | undefined>> {
  const previous = get();
  set(apply(previous));
  try {
    const r = await commit();
    if (r.error) {
      set(previous);
      return { ok: false, error: r.error };
    }
    return { ok: true, value: r.data };
  } catch (e) {
    set(previous);
    return { ok: false, error: e instanceof Error ? e.message.slice(0, 200) : "failed" };
  }
}

/** a small TTL cache: entries expire by time, and a version bump (a write that changes the data) drops them at once */
export class TtlCache<V> {
  private m = new Map<string, { at: number; v: V; ver: number }>();
  private ver = 0;
  constructor(private ttlMs: number, private max = 200, private now: () => number = Date.now) {}
  get(key: string): V | undefined {
    const e = this.m.get(key);
    if (!e) return undefined;
    if (e.ver !== this.ver || this.now() - e.at > this.ttlMs) {
      this.m.delete(key);
      return undefined;
    }
    return e.v;
  }
  set(key: string, v: V) {
    if (this.m.size >= this.max) this.m.delete(this.m.keys().next().value as string);
    this.m.set(key, { at: this.now(), v, ver: this.ver });
  }
  invalidate() {
    this.ver++;
  }
  get size() {
    return this.m.size;
  }
  async wrap(key: string, load: () => Promise<V>): Promise<V> {
    const hit = this.get(key);
    if (hit !== undefined) return hit;
    const v = await load();
    this.set(key, v);
    return v;
  }
}

export type CostTier = "cheap" | "balanced" | "strong";
/** which tier a call needs: strong only for risky planning / review on the deep path; cheap for classification and summaries */
export function tierFor(kind: TaskKind, route: Route, customerFacing = false): CostTier {
  if (kind === "classify" || kind === "summarize") return "cheap";
  if (route === "deep" && (kind === "plan" || kind === "review")) return "strong";
  if (kind === "write" && customerFacing) return "balanced";
  if (kind === "vision" || kind === "site") return "balanced";
  return route === "deep" ? "balanced" : "cheap";
}
/** rough relative price of a model name, for choosing the cheapest model that satisfies a tier */
export function modelCostRank(model: string): number {
  const m = model.toLowerCase();
  if (/(opus|fable|mythos|gpt-5(?!.*mini)|o1|o3|pro\b|ultra)/.test(m)) return 3;
  if (/(sonnet|gpt-4|gemini.*pro|large)/.test(m)) return 2;
  return 1;
}
export function chooseByTier<T extends { model: string }>(models: T[], tier: CostTier): T | null {
  if (!models.length) return null;
  const want = tier === "cheap" ? 1 : tier === "balanced" ? 2 : 3;
  const sorted = [...models].sort((a, b) => Math.abs(modelCostRank(a.model) - want) - Math.abs(modelCostRank(b.model) - want) || modelCostRank(a.model) - modelCostRank(b.model));
  return sorted[0] ?? null;
}
