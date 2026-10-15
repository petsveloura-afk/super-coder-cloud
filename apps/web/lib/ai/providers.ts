import "server-only";

/**
 * AI provider abstraction (OpenAI + Anthropic) over plain HTTPS — no SDKs,
 * keys stay on the server. Add providers by implementing `AIProvider`.
 */
export type AIProviderName = "openai" | "anthropic";

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
};

export function providerConfigured(p: AIProviderName): boolean {
  return p === "openai" ? Boolean(process.env.OPENAI_API_KEY) : Boolean(process.env.ANTHROPIC_API_KEY);
}

/** First configured provider, preferring the requested one. */
export function pickProvider(preferred?: AIProviderName): AIProviderName | null {
  if (preferred && providerConfigured(preferred)) return preferred;
  if (providerConfigured("anthropic")) return "anthropic";
  if (providerConfigured("openai")) return "openai";
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

export async function generate(provider: AIProviderName, req: AIRequest): Promise<AIResult> {
  return provider === "openai" ? openai(req) : anthropic(req);
}
