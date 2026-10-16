import "server-only";

/**
 * AI provider abstraction (OpenAI + Anthropic + Google Gemini) over plain HTTPS — no SDKs,
 * keys stay on the server. Add providers by implementing `AIProvider`.
 * Gemini has a free tier (aistudio.google.com → Get API key).
 */
export type AIProviderName = "openai" | "anthropic" | "gemini";
export const AI_PROVIDERS = ["anthropic", "openai", "gemini"] as const;

export interface AIMessage {
  role: "user" | "assistant";
  content: string;
}

export interface AIRequest {
  model: string;
  system: string;
  messages: AIMessage[];
  temperature: number;
  maxTokens: number;
}

export interface AIResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
  model: string;
  provider: AIProviderName;
}

export const DEFAULT_MODELS: Record<AIProviderName, string> = {
  openai: process.env.AI_OPENAI_MODEL || "gpt-4o-mini",
  anthropic: process.env.AI_ANTHROPIC_MODEL || "claude-haiku-5-5",
  // "latest" alias follows Google's current Flash model (older ids get retired for new users)
  gemini: process.env.AI_GEMINI_MODEL || "gemini-flash-latest",
};

/**
 * All configured Gemini keys: GEMINI_API_KEY, GEMINI_API_KEY_2 … GEMINI_API_KEY_10 and/or
 * GEMINI_API_KEYS (comma-separated). Cleaned of stray spaces/quotes, de-duplicated.
 */
export function geminiKeys(env: Record<string, string | undefined> = process.env): string[] {
  const raw = [env.GEMINI_API_KEY, ...Array.from({ length: 9 }, (_, i) => env[`GEMINI_API_KEY_${i + 2}`]), ...(env.GEMINI_API_KEYS ?? "").split(",")];
  return [...new Set(raw.map((k) => (k ?? "").trim().replace(/^["']|["']$/g, "")).filter((k) => k.length >= 20))];
}

export function providerConfigured(p: AIProviderName): boolean {
  if (p === "gemini") return geminiKeys().length > 0;
  return p === "openai" ? Boolean(process.env.OPENAI_API_KEY) : Boolean(process.env.ANTHROPIC_API_KEY);
}

/** First configured provider, preferring the requested one. */
export function pickProvider(preferred?: AIProviderName): AIProviderName | null {
  if (preferred && providerConfigured(preferred)) return preferred;
  if (providerConfigured("anthropic")) return "anthropic";
  if (providerConfigured("openai")) return "openai";
  if (providerConfigured("gemini")) return "gemini";
  return null;
}

async function openai(req: AIRequest): Promise<AIResult> {
  // AI_OPENAI_BASE_URL lets you use any OpenAI-compatible endpoint (Azure, gateway, local mock).
  const base = (process.env.AI_OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: req.model,
      temperature: req.temperature,
      max_tokens: req.maxTokens,
      messages: [{ role: "system", content: req.system }, ...req.messages],
    }),
    signal: AbortSignal.timeout(45_000),
    cache: "no-store",
  });
  const json = (await res.json().catch(() => ({}))) as {
    choices?: { message?: { content?: string } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
    model?: string;
    error?: { message?: string };
  };
  if (!res.ok) throw new Error(`openai_${res.status}`);
  return {
    text: json.choices?.[0]?.message?.content?.trim() ?? "",
    inputTokens: json.usage?.prompt_tokens ?? 0,
    outputTokens: json.usage?.completion_tokens ?? 0,
    model: json.model ?? req.model,
    provider: "openai",
  };
}

async function anthropic(req: AIRequest): Promise<AIResult> {
  const base = (process.env.AI_ANTHROPIC_BASE_URL || "https://api.anthropic.com/v1").replace(/\/$/, "");
  const res = await fetch(`${base}/messages`, {
    method: "POST",
    headers: {
      "x-api-key": process.env.ANTHROPIC_API_KEY ?? "",
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: req.model,
      max_tokens: req.maxTokens,
      temperature: req.temperature,
      system: req.system,
      messages: req.messages,
    }),
    signal: AbortSignal.timeout(45_000),
    cache: "no-store",
  });
  const json = (await res.json().catch(() => ({}))) as {
    content?: { type: string; text?: string }[];
    usage?: { input_tokens?: number; output_tokens?: number };
    model?: string;
  };
  if (!res.ok) throw new Error(`anthropic_${res.status}`);
  return {
    text: (json.content ?? []).filter((c) => c.type === "text").map((c) => c.text ?? "").join("\n").trim(),
    inputTokens: json.usage?.input_tokens ?? 0,
    outputTokens: json.usage?.output_tokens ?? 0,
    model: json.model ?? req.model,
    provider: "anthropic",
  };
}

/** Google Gemini (generateContent). AI_GEMINI_BASE_URL overrides the endpoint (tests / gateways). */
async function geminiOnce(req: AIRequest, key: string): Promise<AIResult> {
  const base = (process.env.AI_GEMINI_BASE_URL || "https://generativelanguage.googleapis.com/v1beta").replace(/\/$/, "");
  const url = `${base}/models/${encodeURIComponent(req.model)}:generateContent`;
  const body = JSON.stringify({
    systemInstruction: req.system ? { parts: [{ text: req.system }] } : undefined,
    contents: req.messages.map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] })),
    generationConfig: {
      temperature: req.temperature,
      // Gemini 2.5 "thinking" tokens count against maxOutputTokens and can leave the answer
      // empty; Flash models allow turning thinking off, others get extra room for it.
      maxOutputTokens: /2\.5-flash/.test(req.model) ? req.maxTokens : req.maxTokens + 2048,
      ...(/2\.5-flash/.test(req.model) ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
    },
  });
  const call = (withHeader: boolean) =>
    fetch(withHeader ? url : `${url}?key=${encodeURIComponent(key)}`, {
      method: "POST",
      headers: withHeader ? { "x-goog-api-key": key, "Content-Type": "application/json" } : { "Content-Type": "application/json" },
      body,
      signal: AbortSignal.timeout(30_000),
      cache: "no-store",
    });
  let res = await call(true);
  // Newer "AQ." keys are rejected by some header paths but accepted as ?key= — retry once that way.
  if (res.status === 400 || res.status === 401 || res.status === 403) {
    const first = await res.text().catch(() => "");
    console.error("gemini header auth failed, retrying with key param", res.status, first.slice(0, 300));
    res = await call(false);
  }
  const json = (await res.json().catch(() => ({}))) as {
    candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] }; finishReason?: string }[];
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
    modelVersion?: string;
    error?: { status?: string; message?: string };
  };
  // status + Google's reason go to the server log (never to the browser)
  if (!res.ok) throw new Error(`gemini_${res.status}${json.error?.status ? `:${json.error.status}` : ""}${json.error?.message ? `:${json.error.message.slice(0, 200)}` : ""}`);
  const text = (json.candidates?.[0]?.content?.parts ?? []).filter((p) => !p.thought).map((p) => p.text ?? "").join("").trim();
  if (!text) console.error("gemini empty answer", json.candidates?.[0]?.finishReason ?? "no_candidates");
  return {
    text,
    inputTokens: json.usageMetadata?.promptTokenCount ?? 0,
    outputTokens: json.usageMetadata?.candidatesTokenCount ?? 0,
    model: json.modelVersion ?? req.model,
    provider: "gemini",
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Overload / quota answers: try another key or model. */
const transient = (e: unknown) => /^gemini_(429|500|502|503|504)\b/.test((e as Error).message ?? "");
/** Model retired / unknown for this key → try the next model. */
const modelGone = (e: unknown) => /^gemini_404\b/.test((e as Error).message ?? "");

/**
 * Gemini with resilience:
 *  • several API keys (GEMINI_API_KEY, _2…_10, GEMINI_API_KEYS) — start at a random key to spread
 *    load, move to the next key on overload/quota (429/5xx);
 *  • fallback models (AI_GEMINI_FALLBACK_MODELS, comma-separated) when a model is busy or retired (404);
 *  • at most 6 calls per request so the user never waits for minutes.
 */
async function gemini(req: AIRequest): Promise<AIResult> {
  const keys = geminiKeys();
  if (!keys.length) throw new Error("gemini_not_configured");
  const fallbacks = (process.env.AI_GEMINI_FALLBACK_MODELS || "gemini-flash-latest,gemini-3.8-flash,gemini-flash-lite-latest,gemini-3.5-flash-lite")
    .split(",")
    .map((m) => m.trim())
    .filter((m) => m && m !== req.model);
  const models = [req.model, ...fallbacks].slice(0, 4);
  const start = Math.floor(Math.random() * keys.length);
  let last: unknown;
  let calls = 0;
  for (const model of models) {
    for (let k = 0; k < keys.length && calls < 6; k++) {
      const key = keys[(start + k) % keys.length]!;
      calls++;
      try {
        return await geminiOnce({ ...req, model }, key);
      } catch (e) {
        last = e;
        if (modelGone(e)) {
          console.error("gemini model unavailable, trying next model", model);
          break; // next model (same for every key)
        }
        if (!transient(e)) throw e;
        console.error("gemini busy/quota", model, `key#${((start + k) % keys.length) + 1}`, (e as Error).message.slice(0, 120));
        if (keys.length === 1) await sleep(700);
      }
    }
    if (calls >= 6) break;
  }
  throw last;
}

export async function generate(provider: AIProviderName, req: AIRequest): Promise<AIResult> {
  if (provider === "gemini") return gemini(req);
  return provider === "openai" ? openai(req) : anthropic(req);
}
