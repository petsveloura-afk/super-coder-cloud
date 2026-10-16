import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { anthropicCall, geminiCall, openaiCall, openaiCompatibleCall, type AIMessage } from "./providers";
import { buildCandidates, classifyError, isResting, restKey, soonestReady, type RouteCandidate, type RouteProvider } from "./router-core";

/**
 * AI router — one smart entry point for every AI call:
 *   • tries the agent's provider first, then every other configured provider
 *     (Groq, Cerebras, Gemini, OpenRouter, Mistral, Anthropic, OpenAI);
 *   • each candidate (provider + key + model) is tried ONCE — no retry storms;
 *   • a candidate that fails rests exactly as long as needed (per-minute limit,
 *     daily quota, retired model, bad key) and the rest is shared by every server
 *     instance through the ai_provider_rests table;
 *   • stops at a time budget so customers never wait for minutes.
 */

export interface RoutedResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
  model: string;
  provider: RouteProvider;
}

export interface RouteAttempt {
  provider: RouteProvider;
  model: string;
  keyId: string;
  ok: boolean;
  ms: number;
  reason?: string;
}

const memoryRests = new Map<string, number>();
let lastLoad = 0;

function adminOrNull() {
  try {
    return process.env.SUPABASE_SERVICE_ROLE_KEY ? createAdminClient() : null;
  } catch {
    return null;
  }
}

/** Rests shared by all instances (DB) merged into this instance's memory (refreshed at most every 10s). */
async function loadRests(): Promise<Map<string, number>> {
  const now = Date.now();
  if (now - lastLoad > 10_000) {
    lastLoad = now;
    const admin = adminOrNull();
    if (admin) {
      const { data } = await admin.from("ai_provider_rests").select("id, until").gt("until", new Date(now).toISOString()).limit(500);
      for (const r of (data ?? []) as { id: string; until: string }[]) {
        const t = new Date(r.until).getTime();
        if (t > (memoryRests.get(r.id) ?? 0)) memoryRests.set(r.id, t);
      }
    }
  }
  return memoryRests;
}

async function rest(id: string, ms: number, reason: string) {
  if (ms <= 0) return;
  const until = Date.now() + ms;
  memoryRests.set(id, Math.max(until, memoryRests.get(id) ?? 0));
  const admin = adminOrNull();
  if (admin) {
    await admin
      .from("ai_provider_rests")
      .upsert({ id, until: new Date(until).toISOString(), reason: reason.slice(0, 200), updated_at: new Date().toISOString() })
      .then(
        () => undefined,
        () => undefined,
      );
  }
}

/** Clears every rest (admin "reset" after adding new keys). */
export async function clearRests() {
  memoryRests.clear();
  lastLoad = 0;
  const admin = adminOrNull();
  if (admin) await admin.from("ai_provider_rests").delete().neq("id", "");
}

async function callOne(c: RouteCandidate, req: { system: string; messages: AIMessage[]; temperature: number; maxTokens: number; json?: boolean }, timeoutMs: number): Promise<Omit<RoutedResult, "provider">> {
  const base = { model: c.model, system: req.system, messages: req.messages, temperature: req.temperature, maxTokens: req.maxTokens, json: req.json };
  if (c.provider === "gemini") {
    const r = await geminiCall(base, c.key);
    return { text: r.text, inputTokens: r.inputTokens, outputTokens: r.outputTokens, model: r.model };
  }
  if (c.provider === "anthropic") {
    const r = await anthropicCall(base, c.key);
    return { text: r.text, inputTokens: r.inputTokens, outputTokens: r.outputTokens, model: r.model };
  }
  if (c.provider === "openai") {
    const r = await openaiCall(base, c.key);
    return { text: r.text, inputTokens: r.inputTokens, outputTokens: r.outputTokens, model: r.model };
  }
  const headers: Record<string, string> =
    c.provider === "openrouter" ? { "HTTP-Referer": process.env.NEXT_PUBLIC_APP_URL || "https://super-coder-cloud.vercel.app", "X-Title": "Super Coder Cloud" } : {};
  return openaiCompatibleCall(base, { name: c.provider, baseUrl: c.baseUrl!, key: c.key, timeoutMs, headers });
}

export class RouterError extends Error {
  constructor(
    message: string,
    public readonly attempts: RouteAttempt[],
    /** ms until some candidate is usable again (null = nothing configured) */
    public readonly retryInMs: number | null,
    public readonly busy: boolean,
  ) {
    super(message);
  }
}

/**
 * Routed generation. Throws RouterError (busy=true when every candidate is resting or
 * rate-limited — the caller shows a short "on it" message and retries later).
 */
export async function generateRouted(input: {
  preferred?: string | null;
  model?: string | null;
  system: string;
  messages: AIMessage[];
  temperature?: number;
  maxTokens?: number;
  json?: boolean;
  /** total time budget (default 30s) */
  budgetMs?: number;
  /** at most this many calls (default 6) */
  maxCalls?: number;
}): Promise<RoutedResult & { attempts: RouteAttempt[] }> {
  const cands = buildCandidates({ preferred: input.preferred, model: input.model, env: process.env });
  if (!cands.length) throw new RouterError("ai_not_configured", [], null, false);
  const rests = await loadRests();
  const started = Date.now();
  // at least 8s: enough to fail over from a limited engine to the next one
  const budget = Math.max(input.budgetMs ?? 30_000, 8000);
  const maxCalls = input.maxCalls ?? 6;
  const attempts: RouteAttempt[] = [];
  const triedModelGone = new Set<string>();
  let onlyBusy = true;
  for (const c of cands) {
    if (attempts.length >= maxCalls) break;
    const left = budget - (Date.now() - started);
    if (attempts.length > 0 && left < 4000) break;
    if (isResting(c, rests)) continue;
    if (triedModelGone.has(`${c.provider}|${c.model}`)) continue;
    const t0 = Date.now();
    try {
      const r = await callOne(c, { system: input.system, messages: input.messages, temperature: input.temperature ?? 0.4, maxTokens: input.maxTokens ?? 600, json: input.json }, Math.min(25_000, left));
      if (!r.text) {
        attempts.push({ provider: c.provider, model: c.model, keyId: c.keyId, ok: false, ms: Date.now() - t0, reason: "empty answer" });
        onlyBusy = false;
        continue;
      }
      attempts.push({ provider: c.provider, model: c.model, keyId: c.keyId, ok: true, ms: Date.now() - t0 });
      return { ...r, provider: c.provider, attempts };
    } catch (e) {
      const msg = (e as Error).message ?? String(e);
      const cl = classifyError(msg);
      attempts.push({ provider: c.provider, model: c.model, keyId: c.keyId, ok: false, ms: Date.now() - t0, reason: cl.reason });
      console.error("ai router: candidate failed", c.provider, c.model, c.keyId, cl.kind, msg.slice(0, 240));
      if (cl.kind === "model") triedModelGone.add(`${c.provider}|${c.model}`);
      if (cl.kind !== "rate" && cl.kind !== "daily" && cl.kind !== "server") onlyBusy = false;
      await rest(restKey(c, cl.scope), cl.restMs, `${cl.kind}: ${cl.reason}`);
    }
  }
  const retryIn = soonestReady(cands, await loadRests());
  throw new RouterError(attempts.length ? `ai_all_failed:${attempts.map((a) => `${a.provider}/${a.model}:${a.reason}`).join(",").slice(0, 400)}` : "ai_all_resting", attempts, retryIn, onlyBusy || !attempts.length);
}

/** Admin health check: one tiny call per key (first model of each provider), never using rests. */
export async function probeAll(): Promise<{ provider: RouteProvider; model: string; keyId: string; ok: boolean; ms: number; kind?: string; reason?: string }[]> {
  const cands = buildCandidates({ env: process.env, random: () => 0 });
  const seen = new Set<string>();
  const firstPerKey = cands.filter((c) => {
    if (seen.has(c.keyId)) return false;
    seen.add(c.keyId);
    return true;
  });
  return Promise.all(
    firstPerKey.slice(0, 30).map(async (c) => {
      const t0 = Date.now();
      try {
        const r = await callOne(c, { system: "Reply with the single word OK.", messages: [{ role: "user", content: "ping" }], temperature: 0, maxTokens: 8 }, 15_000);
        return { provider: c.provider, model: c.model, keyId: c.keyId, ok: Boolean(r.text), ms: Date.now() - t0, ...(r.text ? {} : { kind: "other", reason: "empty answer" }) };
      } catch (e) {
        const cl = classifyError((e as Error).message ?? "");
        return { provider: c.provider, model: c.model, keyId: c.keyId, ok: false, ms: Date.now() - t0, kind: cl.kind, reason: ((e as Error).message ?? "").slice(0, 160) };
      }
    }),
  );
}
