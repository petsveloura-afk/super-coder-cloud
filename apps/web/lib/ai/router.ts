import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { anthropicCall, geminiCall, openaiCall, openaiCompatibleCall, type AIMessage } from "./providers";
import { buildCandidates, classifyError, isResting, laneOrder, NO_JSON_MODE, restKey, soonestReady, type RouteCandidate, type RouteProvider } from "./router-core";
import { capRest, probeOrder, restKeysOf, withDeadline } from "./resilience-core";

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
/** wave 15: when a resting candidate was last probed — at most once a minute per instance (no probe storms) */
const probedAt = new Map<string, number>();
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

/** wave 15: a candidate that just answered is healthy — forget every rest that mentions it. */
function clearRestsOf(c: RouteCandidate) {
  const keys = restKeysOf(c);
  for (const k of keys) memoryRests.delete(k);
  const admin = adminOrNull();
  if (admin) void admin.from("ai_provider_rests").delete().in("id", keys).then(() => undefined, () => undefined);
}

async function callOne(c: RouteCandidate, req: { system: string; messages: AIMessage[]; temperature: number; maxTokens: number; json?: boolean }, timeoutMs: number): Promise<Omit<RoutedResult, "provider">> {
  // wave 15: a hung connection can never block the conversation — hard deadline on every call
  return withDeadline(callOneRaw(c, req, timeoutMs), Math.max(4000, Math.min(timeoutMs, 28_000)) + 2000, `${c.provider}/${c.model}`);
}

async function callOneRaw(c: RouteCandidate, req: { system: string; messages: AIMessage[]; temperature: number; maxTokens: number; json?: boolean }, timeoutMs: number): Promise<Omit<RoutedResult, "provider">> {
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
  return openaiCompatibleCall(base, { name: c.provider, baseUrl: c.baseUrl!, key: c.key, timeoutMs, headers, noJsonMode: NO_JSON_MODE.includes(c.provider) });
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
  /** speed upgrade (hedged request): providers this run must not use (the parallel run uses them) */
  skipProviders?: string[];
  /** wave 55: background work walks the engines in the other direction (live chats keep the fast ones) */
  lane?: "interactive" | "background";
}): Promise<RoutedResult & { attempts: RouteAttempt[] }> {
  const cands = laneOrder(
    buildCandidates({ preferred: input.preferred, model: input.model, env: process.env }).filter((c) => !(input.skipProviders ?? []).includes(c.provider)),
    input.lane ?? "interactive",
  );
  if (!cands.length) throw new RouterError("ai_not_configured", [], null, false);
  const rests = await loadRests();
  const started = Date.now();
  // at least 8s: enough to fail over from a limited engine to the next one
  const budget = Math.max(input.budgetMs ?? 30_000, 8000);
  const maxCalls = input.maxCalls ?? 6;
  const attempts: RouteAttempt[] = [];
  const triedModelGone = new Set<string>();
  let onlyBusy = true;
  // wave 11: at most N failed calls per provider in one request — a provider whose project is
  // limited (all keys share one Google quota) must never eat the whole budget before the next provider
  const perProvider = Math.max(1, Number(process.env.AI_ROUTER_PER_PROVIDER) || 2);
  const failedBy = new Map<string, number>();
  for (const c of cands) {
    if (attempts.length >= maxCalls) break;
    const left = budget - (Date.now() - started);
    if (attempts.length > 0 && left < 4000) break;
    if (isResting(c, rests)) continue;
    if (triedModelGone.has(`${c.provider}|${c.model}`)) continue;
    if ((failedBy.get(c.provider) ?? 0) >= perProvider) continue;
    const t0 = Date.now();
    try {
      const r = await callOne(c, { system: input.system, messages: input.messages, temperature: input.temperature ?? 0.4, maxTokens: input.maxTokens ?? 600, json: input.json }, Math.min(25_000, left));
      if (!r.text) {
        attempts.push({ provider: c.provider, model: c.model, keyId: c.keyId, ok: false, ms: Date.now() - t0, reason: "empty answer" });
        failedBy.set(c.provider, (failedBy.get(c.provider) ?? 0) + 1);
        onlyBusy = false;
        continue;
      }
      attempts.push({ provider: c.provider, model: c.model, keyId: c.keyId, ok: true, ms: Date.now() - t0 });
      clearRestsOf(c);
      return { ...r, provider: c.provider, attempts };
    } catch (e) {
      const msg = (e as Error).message ?? String(e);
      const cl = classifyError(msg);
      attempts.push({ provider: c.provider, model: c.model, keyId: c.keyId, ok: false, ms: Date.now() - t0, reason: cl.reason });
      console.error("ai router: candidate failed", c.provider, c.model, c.keyId, cl.kind, msg.slice(0, 240));
      if (cl.kind === "model") triedModelGone.add(`${c.provider}|${c.model}`);
      failedBy.set(c.provider, (failedBy.get(c.provider) ?? 0) + 1);
      if (cl.kind !== "rate" && cl.kind !== "daily" && cl.kind !== "server") onlyBusy = false;
      await rest(restKey(c, cl.scope), capRest(cl, process.env), `${cl.kind}: ${cl.reason}`);
    }
  }
  // wave 15 — LAST RESORT: when nothing could answer (everything resting or failed), probe the
  // candidates that expire soonest anyway. A rest is a guess about the future; a probe is a fact.
  // A success clears that rest, so the platform heals itself without anyone pressing "reset".
  if (!attempts.some((a) => a.ok)) {
    const probes = probeOrder(cands, await loadRests(), Date.now(), 3, 1).filter((c) => !attempts.some((a) => a.keyId === c.keyId && a.model === c.model) && Date.now() - (probedAt.get(`${c.keyId}|${c.model}`) ?? 0) > 60_000);
    for (const c of probes) {
      probedAt.set(`${c.keyId}|${c.model}`, Date.now());
      const left = budget - (Date.now() - started);
      if (left < 3000 && attempts.length > 0) break;
      const t0 = Date.now();
      try {
        const r = await callOne(c, { system: input.system, messages: input.messages, temperature: input.temperature ?? 0.4, maxTokens: input.maxTokens ?? 600, json: input.json }, Math.max(4000, Math.min(20_000, left)));
        if (!r.text) {
          attempts.push({ provider: c.provider, model: c.model, keyId: c.keyId, ok: false, ms: Date.now() - t0, reason: "empty answer (probe)" });
          continue;
        }
        attempts.push({ provider: c.provider, model: c.model, keyId: c.keyId, ok: true, ms: Date.now() - t0 });
        clearRestsOf(c);
        return { ...r, provider: c.provider, attempts };
      } catch (e) {
        const msg = (e as Error).message ?? String(e);
        const cl = classifyError(msg);
        attempts.push({ provider: c.provider, model: c.model, keyId: c.keyId, ok: false, ms: Date.now() - t0, reason: `${cl.reason} (probe)` });
        if (cl.kind !== "rate" && cl.kind !== "daily" && cl.kind !== "server") onlyBusy = false;
        await rest(restKey(c, cl.scope), capRest(cl, process.env), `${cl.kind}: ${cl.reason}`);
      }
    }
  }
  const retryIn = soonestReady(cands, await loadRests());
  throw new RouterError(attempts.length ? `ai_all_failed:${attempts.map((a) => `${a.provider}/${a.model}:${a.reason}`).join(",").slice(0, 400)}` : "ai_all_resting", attempts, retryIn, onlyBusy || !attempts.length);
}

/** Readable provider error for the admin panel (drops long doc links). */
function readable(msg: string) {
  return msg.replace(/For more information[^.]*\.?\s*/gi, "").replace(/https?:\/\/\S+/g, "").replace(/\s+/g, " ").trim().slice(0, 300);
}

/**
 * Admin health check: per key, tries the provider's models in order until one answers
 * (so a key that only lacks quota on one model shows which model works). Never uses rests.
 */
export async function probeAll(): Promise<{ provider: RouteProvider; model: string; keyId: string; ok: boolean; ms: number; kind?: string; reason?: string; tried?: string[] }[]> {
  const cands = buildCandidates({ env: process.env, random: () => 0 });
  const byKey = new Map<string, RouteCandidate[]>();
  for (const c of cands) byKey.set(c.keyId, [...(byKey.get(c.keyId) ?? []), c]);
  return Promise.all(
    [...byKey.values()].slice(0, 30).map(async (list) => {
      const tried: string[] = [];
      let last: { provider: RouteProvider; model: string; keyId: string; ok: boolean; ms: number; kind?: string; reason?: string } | null = null;
      for (const c of list.slice(0, 4)) {
        const t0 = Date.now();
        tried.push(c.model);
        try {
          const r = await callOne(c, { system: "Reply with the single word OK.", messages: [{ role: "user", content: "ping" }], temperature: 0, maxTokens: 256 }, 20_000);
          if (r.text) return { provider: c.provider, model: c.model, keyId: c.keyId, ok: true, ms: Date.now() - t0, tried };
          last = { provider: c.provider, model: c.model, keyId: c.keyId, ok: false, ms: Date.now() - t0, kind: "other", reason: "empty answer" };
        } catch (e) {
          const msg = (e as Error).message ?? "";
          const cl = classifyError(msg);
          last = { provider: c.provider, model: c.model, keyId: c.keyId, ok: false, ms: Date.now() - t0, kind: cl.kind, reason: readable(msg) };
          if (cl.kind === "auth") break; // a bad key fails on every model
        }
      }
      return { ...last!, tried };
    }),
  );
}

/**
 * Speed upgrade — the provider that a routed call would try first, and a second configured
 * provider for a hedged (parallel) attempt; null when only one provider is configured.
 */
export async function hedgePlan(preferred?: string | null, model?: string | null): Promise<{ first: string; second: string } | null> {
  const cands = buildCandidates({ preferred, model, env: process.env });
  if (!cands.length) return null;
  const rests = await loadRests();
  const usable = cands.filter((c) => !isResting(c, rests));
  const first = (usable[0] ?? cands[0])!.provider;
  const second = usable.find((c) => c.provider !== first)?.provider;
  return second ? { first, second } : null;
}

