"use server";

import { revalidatePath } from "next/cache";
import { uuidSchema } from "@scc/shared/validators";
import { getOrgContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { baseSystem } from "@/lib/ai/prompt";
import { runAI } from "@/lib/ai/run";
import type { ActionState } from "@/lib/action-state";

/**
 * Wave 15 — customer insights on the contact page:
 *  - refreshScoreAction: rule-based lead score (free, instant, explainable)
 *  - analyzeContactAction: AI reads the whole history (all channels, deals, quotes,
 *    meetings, notes) → score, sentiment, buying stage, next best action, offer.
 */
const loc = (l: unknown) => (l === "ar" || l === "en" ? l : "he") as "he" | "ar" | "en";

export async function refreshScoreAction(input: { locale: string; contactId: string }): Promise<ActionState<{ score: number | null }>> {
  const ctx = await getOrgContext(loc(input.locale));
  const id = uuidSchema.safeParse(input.contactId);
  if (!id.success) return { error: "validation.invalidId" };
  if (!ctx.can("contacts.read")) return { error: "errors.forbidden" };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("refresh_contact_score", { p_org: ctx.org.id, p_contact: id.data });
  if (error) return { error: error.code === "42501" ? "errors.forbidden" : "errors.generic" };
  revalidatePath(`/${loc(input.locale)}/crm/${id.data}`);
  return { ok: true, message: "insights.scored", data: { score: ((data ?? {}) as { lead_score?: number }).lead_score ?? null } };
}

export async function analyzeContactAction(input: { locale: string; contactId: string }): Promise<ActionState<{ score: number | null }>> {
  const locale = loc(input.locale);
  const ctx = await getOrgContext(locale);
  const id = uuidSchema.safeParse(input.contactId);
  if (!id.success) return { error: "validation.invalidId" };
  if (!ctx.can("ai.use") || !ctx.can("contacts.read")) return { error: "errors.forbidden" };
  const { orgHasFeature } = await import("@/lib/billing/features");
  if (!(await orgHasFeature(ctx.org.id, "ai_insights"))) return { error: "plans.locked.ai_insights.title" };
  const supabase = await createClient();
  const { data: allowed } = await supabase.rpc("check_rate_limit", { p_key: "insights", p_limit: 30, p_window_seconds: 3600 });
  if (allowed !== true) return { error: "errors.rateLimited" };
  const { contactContext } = await import("@/lib/crm/context");
  const cc = await contactContext(supabase, ctx.org.id, id.data);
  if (!cc) return { error: "errors.notFound" };
  const { insightsTask, parseInsights } = await import("@/lib/crm/insights-core");
  const out = await runAI({
    orgId: ctx.org.id,
    feature: "insights",
    system: baseSystem(locale, "You are a senior sales analyst. Reply with JSON only. Human-readable values must be in the answer language."),
    messages: [{ role: "user", content: `${insightsTask()}\n\n${cc.block}` }],
    temperature: 0.2,
    maxTokens: 700,
    json: true,
  });
  if (!out.ok) return { error: out.error };
  const parsed = parseInsights(out.text);
  if (!parsed) return { error: "insights.badAnswer" };
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const { data, error } = await createAdminClient().rpc("save_contact_ai_insights", {
    p_org: ctx.org.id,
    p_contact: id.data,
    p_ai: { ...parsed, model: out.model, by: ctx.userId },
    p_sentiment: parsed.sentiment,
    p_stage: parsed.stage,
    p_ai_score: parsed.score,
  });
  if (error) return { error: "errors.generic" };
  revalidatePath(`/${locale}/crm/${id.data}`);
  return { ok: true, message: "insights.analyzed", data: { score: ((data ?? {}) as { lead_score?: number }).lead_score ?? null } };
}

/** Wave 16 — the AI voice agent calls this customer now (Twilio, plan "voice_ai"). */
export async function callWithAgentAction(input: { locale: string; contactId: string }): Promise<ActionState> {
  const ctx = await getOrgContext(loc(input.locale));
  const id = uuidSchema.safeParse(input.contactId);
  if (!id.success) return { error: "validation.invalidId" };
  if (!ctx.can("contacts.write") || !ctx.can("inbox.reply")) return { error: "errors.forbidden" };
  const { startAgentCall } = await import("@/lib/voice/agent");
  const r = await startAgentCall(ctx.org.id, id.data);
  return r.ok ? { ok: true, message: "voice.calling" } : { error: r.error ?? "voice.callFailed" };
}
