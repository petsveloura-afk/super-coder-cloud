/**
 * AI router — pure parts (unit-tested): which provider/key/model to try, in what
 * order, and how long to rest a key/model after each kind of failure.
 *
 * Why: free AI tiers limit requests per minute / per day *per project and model*.
 * Hammering a limited key (retry loops) only produces more 429s. The router tries
 * each candidate once, rests the ones that failed for exactly as long as needed
 * (remembered across requests), and moves on immediately to the next provider.
 */

export type RouteProvider = "gemini" | "groq" | "cerebras" | "openrouter" | "mistral" | "anthropic" | "openai";
export const ROUTE_PROVIDERS: RouteProvider[] = ["groq", "cerebras", "gemini", "openrouter", "mistral", "anthropic", "openai"];

export interface RouteCandidate {
  provider: RouteProvider;
  model: string;
  key: string;
  /** stable id of the key (never the key itself): provider + last 6 chars */
  keyId: string;
  baseUrl?: string;
}

type Env = Record<string, string | undefined>;

const clean = (k: string | undefined) => (k ?? "").trim().replace(/^["']|["']$/g, "");

/** KEY, KEY_2 … KEY_10 and KEYS (comma-separated), cleaned and de-duplicated. */
export function keysFor(env: Env, base: string, minLen = 20): string[] {
  const raw = [env[base], ...Array.from({ length: 9 }, (_, i) => env[`${base}_${i + 2}`]), ...(env[`${base}S`] ?? "").split(",")];
  return [...new Set(raw.map(clean).filter((k) => k.length >= minLen))];
}

export const keyId = (provider: string, key: string) => `${provider}:…${key.slice(-6)}`;

const list = (v: string | undefined, fallback: string[]) => {
  const xs = (v ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  return xs.length ? xs : fallback;
};

/** Default models per provider (overridable with AI_<PROVIDER>_MODELS). */
export function modelsFor(provider: RouteProvider, env: Env): string[] {
  switch (provider) {
    case "gemini":
      return list(env.AI_GEMINI_MODELS, ["gemini-3.8-flash", "gemini-3.5-flash-lite", "gemini-3.6-flash", "gemini-2.5-flash"]);
    case "groq":
      return list(env.AI_GROQ_MODELS, ["openai/gpt-oss-120b", "llama-3.3-70b-versatile"]);
    case "cerebras":
      return list(env.AI_CEREBRAS_MODELS, ["gpt-oss-120b", "qwen-3.8-27b"]);
    case "openrouter":
      return list(env.AI_OPENROUTER_MODELS, ["openrouter/free"]);
    case "mistral":
      return list(env.AI_MISTRAL_MODELS, ["mistral-small-latest"]);
    case "anthropic":
      return list(env.AI_ANTHROPIC_MODELS, [env.AI_ANTHROPIC_MODEL || "claude-haiku-5-5"]);
    case "openai":
      return list(env.AI_OPENAI_MODELS, [env.AI_OPENAI_MODEL || "gpt-4o-mini"]);
  }
}

const BASES: Record<string, [string, string]> = {
  groq: ["AI_GROQ_BASE_URL", "https://api.groq.com/openai/v1"],
  cerebras: ["AI_CEREBRAS_BASE_URL", "https://api.cerebras.ai/v1"],
  openrouter: ["AI_OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1"],
  mistral: ["AI_MISTRAL_BASE_URL", "https://api.mistral.ai/v1"],
};

export function providerKeys(provider: RouteProvider, env: Env): string[] {
  switch (provider) {
    case "gemini":
      return keysFor(env, "GEMINI_API_KEY");
    case "groq":
      return keysFor(env, "GROQ_API_KEY");
    case "cerebras":
      return keysFor(env, "CEREBRAS_API_KEY");
    case "openrouter":
      return keysFor(env, "OPENROUTER_API_KEY");
    case "mistral":
      return keysFor(env, "MISTRAL_API_KEY", 16);
    case "anthropic":
      return keysFor(env, "ANTHROPIC_API_KEY", 1);
    case "openai":
      return keysFor(env, "OPENAI_API_KEY", 1);
  }
}

/** Old / alias model ids that should not be asked for first any more. */
const RETIRED = /^(gemini-1\.|gemini-2\.0|gemini-pro$)/;

/**
 * Ordered candidates: the preferred provider (the agent's choice) first — with the
 * agent's own model first when it is a real model — then the rest in AI_PROVIDER_ORDER
 * (default: fastest free first). Within a provider: model by model, keys rotated
 * from a random start so load spreads over keys.
 */
export function buildCandidates(input: { preferred?: string | null; model?: string | null; env: Env; random?: () => number }): RouteCandidate[] {
  const env = input.env;
  const rnd = input.random ?? Math.random;
  const order = list(env.AI_PROVIDER_ORDER, ROUTE_PROVIDERS).filter((p): p is RouteProvider => (ROUTE_PROVIDERS as string[]).includes(p));
  const pref = input.preferred && (ROUTE_PROVIDERS as string[]).includes(input.preferred) ? (input.preferred as RouteProvider) : null;
  const providers = pref ? [pref, ...order.filter((p) => p !== pref)] : order;
  const out: RouteCandidate[] = [];
  for (const provider of providers) {
    const keys = providerKeys(provider, env);
    if (!keys.length) continue;
    let models = modelsFor(provider, env);
    if (provider === pref && input.model && !RETIRED.test(input.model)) models = [input.model, ...models.filter((m) => m !== input.model)];
    const start = Math.floor(rnd() * keys.length);
    const base = BASES[provider] ? clean(env[BASES[provider]![0]]) || BASES[provider]![1] : undefined;
    for (const model of models) {
      for (let i = 0; i < keys.length; i++) {
        const key = keys[(start + i) % keys.length]!;
        out.push({ provider, model, key, keyId: keyId(provider, key), ...(base ? { baseUrl: base } : {}) });
      }
    }
  }
  return out;
}

export type FailureKind = "rate" | "daily" | "model" | "auth" | "server" | "other" | "noquota";

export interface Classified {
  kind: FailureKind;
  /** how long to rest; scope "key+model" (rate/daily/server), "model" (all keys) or "key" (auth) */
  restMs: number;
  scope: "key+model" | "model" | "key";
  /** short Hebrew-free reason for logs / admin panel */
  reason: string;
}

/** Next midnight in California (free daily quotas reset then) — approximated as 08:00 UTC. */
export function untilDailyReset(now = new Date()): number {
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 8, 0, 0));
  if (next.getTime() <= now.getTime()) next.setUTCDate(next.getUTCDate() + 1);
  return next.getTime() - now.getTime();
}

export function classifyError(message: string, now = new Date()): Classified {
  const m = message ?? "";
  const status = Number(/^[a-z]+_(\d{3})/.exec(m)?.[1] ?? 0);
  const retryS = Number(/retry=(\d+(?:\.\d+)?)/.exec(m)?.[1] ?? /retry in ([\d.]+)\s*s/i.exec(m)?.[1] ?? /"retryDelay":\s*"(\d+)/.exec(m)?.[1] ?? 0);
  // wave 11: "limit: 0" = this project has NO free quota for this model (not a temporary limit) → skip the model for this key for hours
  if ((status === 429 || /RESOURCE_EXHAUSTED/i.test(m)) && /limit:\s*0\b/i.test(m)) return { kind: "noquota", restMs: 6 * 3600_000, scope: "key+model", reason: "no free quota for this model" };
  if (status === 429 || /RESOURCE_EXHAUSTED|rate.?limit|quota/i.test(m)) {
    if (/per ?day|PerDay|daily|requests per day|RPD/i.test(m)) return { kind: "daily", restMs: Math.min(untilDailyReset(now), 3 * 3600_000), scope: "key+model", reason: "daily quota used up" };
    return { kind: "rate", restMs: Math.min(Math.max(retryS * 1000, 20_000), 120_000), scope: "key+model", reason: "per-minute limit" };
  }
  if (status === 404 || /not found|does not exist|is not supported|model_not_found|no endpoints/i.test(m)) return { kind: "model", restMs: 12 * 3600_000, scope: "model", reason: "model not available" };
  if (status === 401 || status === 403 || /API key not valid|invalid api key|unauthor|permission/i.test(m)) return { kind: "auth", restMs: 3600_000, scope: "key", reason: "invalid or blocked key" };
  if (status === 400 && /api key/i.test(m)) return { kind: "auth", restMs: 3600_000, scope: "key", reason: "invalid key" };
  if (status >= 500 || /timeout|aborted|fetch failed|ECONN|ETIMEDOUT/i.test(m)) return { kind: "server", restMs: 15_000, scope: "key+model", reason: "provider error / timeout" };
  return { kind: "other", restMs: 0, scope: "key+model", reason: m.slice(0, 80) || "unknown" };
}

/** Cool-down store key for a candidate under a scope. */
export function restKey(c: Pick<RouteCandidate, "provider" | "model" | "keyId">, scope: Classified["scope"]): string {
  if (scope === "model") return `${c.provider}|*|${c.model}`;
  if (scope === "key") return `${c.keyId}|*`;
  return `${c.keyId}|${c.model}`;
}

/** Is this candidate resting right now? */
export function isResting(c: RouteCandidate, rests: Map<string, number>, now = Date.now()): boolean {
  return [restKey(c, "key+model"), restKey(c, "model"), restKey(c, "key")].some((k) => (rests.get(k) ?? 0) > now);
}

/** Earliest moment any candidate becomes usable again (ms from now), or null. */
export function soonestReady(cands: RouteCandidate[], rests: Map<string, number>, now = Date.now()): number | null {
  let best: number | null = null;
  for (const c of cands) {
    const until = Math.max(rests.get(restKey(c, "key+model")) ?? 0, rests.get(restKey(c, "model")) ?? 0, rests.get(restKey(c, "key")) ?? 0);
    const wait = Math.max(0, until - now);
    if (best === null || wait < best) best = wait;
  }
  return best;
}
