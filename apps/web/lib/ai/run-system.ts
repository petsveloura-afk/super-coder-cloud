import "server-only";
import { limitErrorKey } from "@scc/shared/billing";
import { createAdminClient } from "@/lib/supabase/admin";
import { DEFAULT_MODELS, pickProvider, routerExtrasConfigured, type AIMessage, type AIProviderName } from "./providers";
import { generateRouted, RouterError } from "./router";
import type { AIOutcome } from "./run";

/**
 * Metered AI call made by the server itself (automatic replies to customers from
 * webhooks / cron — there is no signed-in user). Same credit rules as runAI:
 * reserve_ai_credits_system (demo guard + rate limit + monthly plan cap) →
 * provider → finalize_ai_usage_system. Service role only.
 */
export async function runAISystem(input: {
  orgId: string;
  feature: "autopilot";
  agentId?: string | null;
  provider?: AIProviderName;
  model?: string;
  system: string;
  messages: AIMessage[];
  temperature?: number;
  maxTokens?: number;
  /** wait for a busy provider (background replies) — default 45s */
  patienceMs?: number;
}): Promise<AIOutcome> {
  const provider = pickProvider(input.provider) ?? (routerExtrasConfigured() ? input.provider ?? "gemini" : null);
  if (!provider) return { ok: false, error: "ai.notConfigured" };
  const admin = createAdminClient();
  const { data: usageId, error: reserveError } = await admin.rpc("reserve_ai_credits_system", {
    p_org: input.orgId,
    p_feature: input.feature,
    p_agent: input.agentId ?? null,
  });
  if (reserveError || usageId === null || usageId === undefined) {
    return { ok: false, error: limitErrorKey(reserveError?.message) ?? (reserveError?.message?.includes("rate_limited") ? "ai.busy" : "ai.failed") };
  }
  const model = input.provider === provider && input.model ? input.model : DEFAULT_MODELS[provider];
  try {
    // AI router: agent's provider first, then every configured provider; each key/model once,
    // limited ones rest (shared across instances) — answers in seconds or reports "busy" fast
    const result = await generateRouted({
      preferred: input.provider ?? provider,
      model,
      system: input.system,
      messages: input.messages,
      temperature: input.temperature ?? 0.4,
      maxTokens: input.maxTokens ?? 600,
      budgetMs: input.patienceMs ?? (Number(process.env.AI_AUTOPILOT_PATIENCE_MS) > 0 ? Number(process.env.AI_AUTOPILOT_PATIENCE_MS) : 30_000),
    });
    await admin.rpc("finalize_ai_usage_system", {
      p_usage_id: usageId,
      p_provider: result.provider,
      p_model: result.model,
      p_input: result.inputTokens,
      p_output: result.outputTokens,
      p_ok: true,
    });
    return { ok: true, text: result.text, provider: result.provider, model: result.model, credits: Math.max(1, Math.ceil((result.inputTokens + result.outputTokens) / 1000)) };
  } catch (err) {
    console.error("autopilot ai call failed", (err as Error).message);
    await admin.rpc("finalize_ai_usage_system", { p_usage_id: usageId, p_provider: provider, p_model: model, p_input: 0, p_output: 0, p_ok: false });
    if (err instanceof RouterError) return { ok: false, error: err.busy ? "ai.busy" : "ai.failed", retryInMs: err.retryInMs };
    if (/_(429|500|502|503|504)\b/.test((err as Error).message ?? "")) return { ok: false, error: "ai.busy" };
    return { ok: false, error: "ai.failed" };
  }
}
