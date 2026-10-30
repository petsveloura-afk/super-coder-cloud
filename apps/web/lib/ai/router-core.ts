/**
 * AI router — pure parts (unit-tested): which provider/key/model to try, in what
 * order, and how long to rest a key/model after each kind of failure.
 *
 * Why: free AI tiers limit requests per minute / per day *per project and model*.
 * Hammering a limited key (retry loops) only produces more 429s. The router tries
 * each candidate once, rests the ones that failed for exactly as long as needed
 * (remembered across requests), and moves on immediately to the next provider.
 */

export type RouteProvider = "gemini" | "groq" | "cerebras" | "openrouter" | "mistral" | "anthropic" | "openai" | "cloudflare" | "github" | "sambanova" | "nvidia" | "huggingface";
// wave 55: five more free engines (Cloudflare Workers AI, GitHub Models, SambaNova, NVIDIA NIM, Hugging Face)
// join the failover chain — each is used only when its key is set
// wave 57: the original engines keep their places at the front (exactly as before wave 55) — the new free
// engines are extra capacity right after them, before the paid ones
export const ROUTE_PROVIDERS: RouteProvider[] = ["groq", "cerebras", "gemini", "openrouter", "mistral", "cloudflare", "github", "sambanova", "nvidia", "huggingface", "anthropic", "openai"];
/** Paid engines: always last in the background lane (free capacity first). */
export const PAID_PROVIDERS: RouteProvider[] = ["anthropic", "openai"];

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
    case "cloudflare":
      return list(env.AI_CLOUDFLARE_MODELS, ["@cf/meta/llama-3.3-70b-instruct-fp8-fast", "@cf/openai/gpt-oss-120b", "@cf/mistralai/mistral-small-3.1-24b-instruct"]);
    case "github":
      return list(env.AI_GITHUB_MODELS, ["openai/gpt-4.1-mini", "openai/gpt-4o-mini", "meta/Llama-3.3-70B-Instruct"]);
    case "sambanova":
      return list(env.AI_SAMBANOVA_MODELS, ["Meta-Llama-3.3-70B-Instruct", "gpt-oss-120b"]);
    case "nvidia":
      return list(env.AI_NVIDIA_MODELS, ["meta/llama-3.3-70b-instruct", "openai/gpt-oss-120b"]);
    case "huggingface":
      return list(env.AI_HUGGINGFACE_MODELS, ["openai/gpt-oss-120b", "meta-llama/Llama-3.3-70B-Instruct"]);
  }
}

const BASES: Record<string, [string, string]> = {
  groq: ["AI_GROQ_BASE_URL", "https://api.groq.com/openai/v1"],
  cerebras: ["AI_CEREBRAS_BASE_URL", "https://api.cerebras.ai/v1"],
  openrouter: ["AI_OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1"],
  mistral: ["AI_MISTRAL_BASE_URL", "https://api.mistral.ai/v1"],
  github: ["AI_GITHUB_BASE_URL", "https://models.github.ai/inference"],
  sambanova: ["AI_SAMBANOVA_BASE_URL", "https://api.sambanova.ai/v1"],
  nvidia: ["AI_NVIDIA_BASE_URL", "https://integrate.api.nvidia.com/v1"],
  huggingface: ["AI_HUGGINGFACE_BASE_URL", "https://router.huggingface.co/v1"],
};

/** Engines whose OpenAI-compatible API may reject response_format=json_object (the prompt asks for JSON anyway). */
export const NO_JSON_MODE: RouteProvider[] = ["cloudflare", "huggingface", "sambanova"];

/**
 * Cloudflare Workers AI accounts as "accountId:token" keys: CLOUDFLARE_AI_ACCOUNTS="id:token,…" plus the
 * single pair CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_AI_TOKEN (the same keys the image engine already uses).
 */
export function cloudflareKeys(env: Env): string[] {
  const out: string[] = [];
  for (const pair of (env.CLOUDFLARE_AI_ACCOUNTS ?? "").split(",").map((x) => x.trim()).filter(Boolean)) {
    const i = pair.indexOf(":");
    if (i > 0 && pair.slice(i + 1).trim().length >= 20) out.push(`${pair.slice(0, i).trim()}:${pair.slice(i + 1).trim()}`);
  }
  const id = clean(env.CLOUDFLARE_ACCOUNT_ID);
  const token = clean(env.CLOUDFLARE_AI_TOKEN || env.CLOUDFLARE_API_TOKEN);
  if (id && token.length >= 20) out.push(`${id}:${token}`);
  return [...new Set(out)];
}

/**
 * wave 55 — lanes: background work (team agents, insights, summaries) walks the engines in the
 * opposite order of live conversations, so the fast free engines stay available for customers and
 * for the people using the app; paid engines stay last in both lanes.
 */
export function laneOrder(cands: RouteCandidate[], lane: "interactive" | "background" = "interactive"): RouteCandidate[] {
  if (lane === "interactive") return cands;
  const providers = [...new Set(cands.map((c) => c.provider))];
  const free = providers.filter((p) => !PAID_PROVIDERS.includes(p)).reverse();
  const paid = providers.filter((p) => PAID_PROVIDERS.includes(p));
  const rank = new Map([...free, ...paid].map((p, i) => [p, i]));
  return cands
    .map((c, i) => ({ c, i }))
    .sort((a, b) => (rank.get(a.c.provider)! - rank.get(b.c.provider)!) || a.i - b.i)
    .map((x) => x.c);
}

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
    case "cloudflare":
      return cloudflareKeys(env);
    case "github":
      return keysFor(env, "GITHUB_MODELS_TOKEN");
    case "sambanova":
      return keysFor(env, "SAMBANOVA_API_KEY", 16);
    case "nvidia":
      return keysFor(env, "NVIDIA_API_KEY");
    case "huggingface":
      return keysFor(env, "HF_TOKEN");
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
  const listed = list(env.AI_PROVIDER_ORDER, ROUTE_PROVIDERS).filter((p): p is RouteProvider => (ROUTE_PROVIDERS as string[]).includes(p));
  // wave 55: engines missing from a custom AI_PROVIDER_ORDER still join at the end (paid last), so adding a key always adds capacity
  const order = [...listed, ...ROUTE_PROVIDERS.filter((p) => !listed.includes(p) && !PAID_PROVIDERS.includes(p)), ...PAID_PROVIDERS.filter((p) => !listed.includes(p))];
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
        if (provider === "cloudflare") {
          // "accountId:token" → the account's OpenAI-compatible endpoint + the token as the key
          const at = key.indexOf(":");
          const account = key.slice(0, at);
          const token = key.slice(at + 1);
          const cfBase = clean(env.AI_CLOUDFLARE_BASE_URL) || `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(account)}/ai/v1`;
          out.push({ provider, model, key: token, keyId: keyId(provider, token), baseUrl: cfBase });
          continue;
        }
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
