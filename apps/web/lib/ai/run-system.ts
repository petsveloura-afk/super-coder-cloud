import "server-only";
import { limitErrorKey } from "@scc/shared/billing";
import { createAdminClient } from "@/lib/supabase/admin";
import { DEFAULT_MODELS, pickProvider, routerExtrasConfigured, type AIMessage, type AIProviderName } from "./providers";
import { generateRouted, hedgePlan, RouterError } from "./router";
import { hedgeDelayMs, hedged } from "./speed-core";
import { hintForFeature } from "./task-hint-core";
import { busyWaitMs, secondPassBudget } from "./busy-wait-core";
import type { AIOutcome } from "./run";

/**
 * Metered AI call made by the server itself (automatic replies to customers from
 * webhooks / cron — there is no signed-in user). Same credit rules as runAI:
 * reserve_ai_credits_system (demo guard + rate limit + monthly plan cap) →
 * provider → finalize_ai_usage_system. Service role only.
 */
export async function runAISystem(input: {
  orgId: string;
  /** waves 15-18: background insights, voice/vision understanding, KB answers, phone agent */
  feature: "autopilot" | "insights" | "vision" | "transcribe" | "voice" | "kb" | "social" | "marketing" | "sales_manager" | "brief" | "collections" | "review_reply" | "copilot";
  agentId?: string | null;
  provider?: AIProviderName;
  model?: string;
  system: string;
  messages: AIMessage[];
  temperature?: number;
  maxTokens?: number;
  /** wait for a busy provider (background replies) — default 45s */
  patienceMs?: number;
  /** digital team model routing: the engine to try first for this kind of work (the router's chain still follows) */
  routeProvider?: string | null;
  routeModel?: string | null;
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
    const routedArgs = {
      preferred: input.routeProvider || input.provider || provider,
      model: input.routeProvider && input.routeModel ? input.routeModel : model,
      system: input.system,
      messages: input.messages,
      temperature: input.temperature ?? 0.4,
      maxTokens: input.maxTokens ?? 600,
      budgetMs: input.patienceMs ?? (Number(process.env.AI_AUTOPILOT_PATIENCE_MS) > 0 ? Number(process.env.AI_AUTOPILOT_PATIENCE_MS) : 30_000),
      // wave 55: more engines in the chain → more of them may be tried within the same time budget
      maxCalls: 12,
      // wave 55: team agents / insights / summaries use the background lane (live chats keep the fast engines)
      lane: (["autopilot", "voice", "kb", "vision", "transcribe"].includes(input.feature) ? "interactive" : "background") as "interactive" | "background",
      // wave 66: kind-of-work hint for the MODEL inside a provider; a team routeProvider/routeModel (explicit choice) always wins
      hint: input.routeProvider ? null : hintForFeature(input.feature),
    };
    // speed upgrade — live conversations (chat, phone, help-center answers): when the main engine is
    // slow, a second configured engine starts in parallel after AI_HEDGE_MS (default 6s); first answer wins
    const hedgeMs = ["autopilot", "voice", "kb"].includes(input.feature) ? hedgeDelayMs(process.env) : 0;
    const plan = hedgeMs > 0 ? await hedgePlan(routedArgs.preferred, model).catch(() => null) : null;
    const callStarted = Date.now();
    const result = await (async () =>
      plan
        ? await hedged(
            () => generateRouted(routedArgs),
            () => generateRouted({ ...routedArgs, preferred: plan.second, model: null, skipProviders: [plan.first] }),
            hedgeMs,
            () => console.info("ai hedge: second engine started", plan.first, "→", plan.second),
          )
        : await generateRouted(routedArgs))().catch(async (e: unknown) => {
      // resilience upgrade (additive): every engine resting for only a few seconds → wait exactly that long and make ONE more pass
      // (before, the work failed at once and waited minutes for the next clock tick). Anything else is re-thrown unchanged.
      if (!(e instanceof RouterError)) throw e;
      const elapsed = Date.now() - callStarted;
      const wait = busyWaitMs({ retryInMs: e.retryInMs, lane: routedArgs.lane, elapsedMs: elapsed, busy: e.busy }, process.env);
      if (!wait) throw e;
      console.info("ai busy — waiting before one more pass", wait, "ms", routedArgs.lane);
      await new Promise((r) => setTimeout(r, wait));
      return generateRouted({ ...routedArgs, budgetMs: secondPassBudget(elapsed, wait, process.env) });
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
