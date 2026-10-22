"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { uuidSchema } from "@scc/shared/validators";
import { getOrgContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { dbErrorKey, type ActionState } from "@/lib/action-state";

/** Wave 18 — marketing spend per source & month (ROI / CAC), and the AI forecast summary. */
const loc = (l: unknown) => (l === "ar" || l === "en" ? l : "he") as "he" | "ar" | "en";
const spendSchema = z.object({
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  source: z.string().regex(/^[a-z0-9_]{2,40}$/),
  amount: z.coerce.number().min(0).max(999_999_999),
  note: z.string().trim().max(300).optional().default(""),
});

export async function saveSpendAction(input: { locale: string; data: unknown }): Promise<ActionState> {
  const locale = loc(input.locale);
  const ctx = await getOrgContext(locale);
  if (!ctx.can("campaigns.manage") && !ctx.can("settings.manage")) return { error: "errors.forbidden" };
  const p = spendSchema.safeParse(input.data);
  if (!p.success) return { error: "growth.invalidSpend" };
  const supabase = await createClient();
  const { error } = await supabase.from("marketing_spend").upsert(
    { organization_id: ctx.org.id, month: `${p.data.month}-01`, source: p.data.source, amount: p.data.amount, currency: ctx.org.currency || "ILS", note: p.data.note || null, created_by: ctx.userId, updated_at: new Date().toISOString() },
    { onConflict: "organization_id,month,source" },
  );
  if (error) return { error: dbErrorKey(error) };
  revalidatePath(`/${locale}/analytics`);
  return { ok: true, message: "growth.spendSaved" };
}

export async function deleteSpendAction(input: { locale: string; id: string }): Promise<ActionState> {
  const locale = loc(input.locale);
  const ctx = await getOrgContext(locale);
  if (!ctx.can("campaigns.manage") && !ctx.can("settings.manage")) return { error: "errors.forbidden" };
  if (!uuidSchema.safeParse(input.id).success) return { error: "validation.invalidId" };
  const supabase = await createClient();
  const { error } = await supabase.from("marketing_spend").delete().eq("id", input.id).eq("organization_id", ctx.org.id);
  if (error) return { error: dbErrorKey(error) };
  revalidatePath(`/${locale}/analytics`);
  return { ok: true };
}

/** A short, plain-language reading of the numbers: what works, what to cut, what to expect. */
export async function aiGrowthInsightAction(input: { locale: string; days: number }): Promise<ActionState<{ text: string }>> {
  const locale = loc(input.locale);
  const ctx = await getOrgContext(locale);
  if (!ctx.can("analytics.read") || !ctx.can("ai.use")) return { error: "errors.forbidden" };
  const { orgHasFeature } = await import("@/lib/billing/features");
  if (!(await orgHasFeature(ctx.org.id, "advanced_analytics"))) return { error: "plans.locked.advanced_analytics.title" };
  const supabase = await createClient();
  const { data: allowed } = await supabase.rpc("check_rate_limit", { p_key: "ai_forecast", p_limit: 20, p_window_seconds: 3600 });
  if (allowed !== true) return { error: "errors.rateLimited" };
  const days = [30, 90, 365].includes(Number(input.days)) ? Number(input.days) : 90;
  const { data, error } = await supabase.rpc("growth_metrics", { p_org: ctx.org.id, p_days: days });
  if (error || !data) return { error: "errors.generic" };
  const { runAI } = await import("@/lib/ai/run");
  const { baseSystem } = await import("@/lib/ai/prompt");
  const out = await runAI({
    orgId: ctx.org.id,
    feature: "forecast",
    system: baseSystem(locale, "You are a growth analyst for a small business. Use ONLY the numbers given; never invent data. Plain language, no markdown tables."),
    messages: [
      {
        role: "user",
        content: `Currency: ${ctx.org.currency || "ILS"}. Period: last ${days} days. Data (by lead source: leads, new paying customers, revenue, marketing spend, CAC, ROAS, ROI; lifetime value; monthly revenue; 3-month forecast = run rate + weighted open deals):\n${JSON.stringify(data).slice(0, 12000)}\n\nWrite 4-6 short bullet points: which sources pay off, which to cut or fix, the LTV:CAC picture, and what revenue to expect in the next 3 months and why. If there is no spend data, say that adding monthly spend unlocks ROI/CAC.`,
      },
    ],
    temperature: 0.3,
    maxTokens: 600,
  });
  if (!out.ok) return { error: out.error };
  return { ok: true, data: { text: out.text.trim().slice(0, 3000) } };
}
