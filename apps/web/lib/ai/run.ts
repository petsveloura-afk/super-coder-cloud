import "server-only";
import { limitErrorKey } from "@scc/shared/billing";
import { createClient } from "@/lib/supabase/server";
import { DEFAULT_MODELS, pickProvider, routerExtrasConfigured, type AIMessage, type AIProviderName } from "./providers";
import { generateRouted, RouterError } from "./router";

export type AIFeature =
  | "contact_summary"
  | "followup_draft"
  | "agent_chat"
  | "site_builder"
  // waves 15-18
  | "insights"
  | "copilot"
  | "segment"
  | "site_copy"
  | "vision"
  | "transcribe"
  | "voice"
  | "kb"
  | "forecast"
  | "ab_variant";

export type AIOutcome =
  | { ok: true; text: string; provider: AIProviderName | string; model: string; credits: number }
  | { ok: false; error: string; retryInMs?: number | null };

/**
 * Metered AI call:
 *   reserve_ai_credits (permission + demo guard + rate limit + monthly cap, in Postgres)
 *   → provider call → finalize_ai_usage (tokens → credits).
 * Failures are recorded with 0 credits. Errors are returned as i18n keys.
 */
export async function runAI(input: {
  orgId: string;
  feature: AIFeature;
  agentId?: string | null;
  provider?: AIProviderName;
  model?: string;
  system: string;
  messages: AIMessage[];
  temperature?: number;
  maxTokens?: number;
  /** ask for a single JSON object (site builder) */
  json?: boolean;
}): Promise<AIOutcome> {
  const provider = pickProvider(input.provider) ?? (routerExtrasConfigured() ? input.provider ?? "gemini" : null);
  if (!provider) return { ok: false, error: "ai.notConfigured" };

  const supabase = await createClient();
  const { data: usageId, error: reserveError } = await supabase.rpc("reserve_ai_credits", {
    p_org: input.orgId,
    p_feature: input.feature,
    p_agent: input.agentId ?? null,
  });
  if (reserveError || usageId === null) {
    if (reserveError?.code === "42501") return { ok: false, error: "errors.forbidden" };
    return { ok: false, error: limitErrorKey(reserveError?.message) ?? "ai.failed" };
  }

  const model = input.provider === provider && input.model ? input.model : DEFAULT_MODELS[provider];
  try {
    // AI router: the chosen provider first, then every other configured provider — fast failover, no retry storms
    const result = await generateRouted({
      preferred: input.provider ?? provider,
      model,
      system: input.system,
      messages: input.messages,
      temperature: input.temperature ?? 0.3,
      maxTokens: input.maxTokens ?? 700,
      json: input.json,
      budgetMs: input.feature === "site_builder" ? 55_000 : 30_000,
    });
    await supabase.rpc("finalize_ai_usage", {
      p_usage_id: usageId,
      p_provider: result.provider,
      p_model: result.model,
      p_input: result.inputTokens,
      p_output: result.outputTokens,
      p_ok: true,
    });
    if (!result.text) return { ok: false, error: "ai.failed" };
    return {
      ok: true,
      text: result.text,
      provider: result.provider,
      model: result.model,
      credits: Math.max(1, Math.ceil((result.inputTokens + result.outputTokens) / 1000)),
    };
  } catch (err) {
    console.error("ai call failed", (err as Error).message);
    await supabase.rpc("finalize_ai_usage", {
      p_usage_id: usageId,
      p_provider: provider,
      p_model: model,
      p_input: 0,
      p_output: 0,
      p_ok: false,
    });
    // provider overloaded / rate-limited → tell the user to retry shortly instead of a generic failure
    if (err instanceof RouterError) return { ok: false, error: err.busy ? "ai.busy" : "ai.failed", retryInMs: err.retryInMs };
    if (/_(429|500|502|503|504)\b/.test((err as Error).message ?? "")) return { ok: false, error: "ai.busy" };
    return { ok: false, error: "ai.failed" };
  }
}
