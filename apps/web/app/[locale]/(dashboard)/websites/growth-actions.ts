"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { uuidSchema } from "@scc/shared/validators";
import { getOrgContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { ActionState } from "@/lib/action-state";

/**
 * Wave 17 — website growth tools:
 *  - A/B test of the hero (variant B title / text / button), stats, stop / restart
 *  - AI variant for the test, "improve this text" (AI copywriting) in the editor
 */
const loc = (l: unknown) => (l === "ar" || l === "en" ? l : "he") as "he" | "ar" | "en";

const abSchema = z.object({
  title: z.string().trim().max(160).optional().default(""),
  subtitle: z.string().trim().max(500).optional().default(""),
  cta_label: z.string().trim().max(60).optional().default(""),
  min_views: z.coerce.number().int().min(30).max(100_000).optional().default(100),
});

export async function saveAbTestAction(input: { locale: string; siteId: string; data: unknown; start: boolean }): Promise<ActionState> {
  const locale = loc(input.locale);
  const ctx = await getOrgContext(locale);
  if (!ctx.can("websites.manage")) return { error: "errors.forbidden" };
  const id = uuidSchema.safeParse(input.siteId);
  if (!id.success) return { error: "validation.invalidId" };
  const p = abSchema.safeParse(input.data);
  if (!p.success) return { error: "abtest.invalid" };
  if (!p.data.title && !p.data.subtitle && !p.data.cta_label) return { error: "abtest.needChange" };
  const { orgHasFeature } = await import("@/lib/billing/features");
  if (!(await orgHasFeature(ctx.org.id, "ab_testing"))) return { error: "plans.locked.ab_testing.title" };
  const supabase = await createClient();
  const { data: site } = await supabase.from("sites").select("id, blocks, ab").eq("id", id.data).eq("organization_id", ctx.org.id).maybeSingle();
  if (!site) return { error: "errors.notFound" };
  if (!((site.blocks ?? []) as { type: string }[]).some((b) => b.type === "hero")) return { error: "abtest.needHero" };
  const prev = (site.ab ?? {}) as Record<string, unknown>;
  const ab = { ...p.data, active: input.start, winner: null, decided_at: null, started_at: input.start ? new Date().toISOString() : (prev.started_at ?? null) };
  const { error } = await supabase.from("sites").update({ ab }).eq("id", id.data).eq("organization_id", ctx.org.id);
  if (error) return { error: "errors.generic" };
  revalidatePath(`/${locale}/websites/${id.data}`);
  return { ok: true, message: input.start ? "abtest.started" : "abtest.saved" };
}

export async function stopAbTestAction(input: { locale: string; siteId: string; keep?: "a" | "b" }): Promise<ActionState> {
  const locale = loc(input.locale);
  const ctx = await getOrgContext(locale);
  if (!ctx.can("websites.manage")) return { error: "errors.forbidden" };
  const id = uuidSchema.safeParse(input.siteId);
  if (!id.success) return { error: "validation.invalidId" };
  const supabase = await createClient();
  const { data: site } = await supabase.from("sites").select("id, blocks, ab").eq("id", id.data).eq("organization_id", ctx.org.id).maybeSingle();
  if (!site?.ab) return { error: "errors.notFound" };
  const { applyVariant } = await import("@/lib/site/ab-core");
  const ab = site.ab as import("@/lib/site/ab-core").SiteAb;
  const patch: Record<string, unknown> = { ab: { ...ab, active: false, winner: input.keep ?? null, decided_at: new Date().toISOString() } };
  if (input.keep === "b") patch.blocks = applyVariant((site.blocks ?? []) as import("@scc/shared/engagement").SiteBlock[], ab, "b");
  const { error } = await supabase.from("sites").update(patch).eq("id", id.data).eq("organization_id", ctx.org.id);
  if (error) return { error: "errors.generic" };
  revalidatePath(`/${locale}/websites/${id.data}`);
  return { ok: true, message: "abtest.stopped" };
}

/** AI writes variant B of the hero (a different angle, same facts). */
export async function aiAbVariantAction(input: { locale: string; siteId: string }): Promise<ActionState<{ title: string; subtitle: string; cta_label: string }>> {
  const locale = loc(input.locale);
  const ctx = await getOrgContext(locale);
  if (!ctx.can("websites.manage") || !ctx.can("ai.use")) return { error: "errors.forbidden" };
  const id = uuidSchema.safeParse(input.siteId);
  if (!id.success) return { error: "validation.invalidId" };
  const supabase = await createClient();
  const { data: allowed } = await supabase.rpc("check_rate_limit", { p_key: "ab_variant", p_limit: 30, p_window_seconds: 3600 });
  if (allowed !== true) return { error: "errors.rateLimited" };
  const { data: site } = await supabase.from("sites").select("name, blocks").eq("id", id.data).eq("organization_id", ctx.org.id).maybeSingle();
  const hero = ((site?.blocks ?? []) as { type: string; data: Record<string, string> }[]).find((b) => b.type === "hero");
  if (!hero) return { error: "abtest.needHero" };
  const { runAI } = await import("@/lib/ai/run");
  const { baseSystem } = await import("@/lib/ai/prompt");
  const { extractJsonObject } = await import("@/lib/crm/insights-core");
  const out = await runAI({
    orgId: ctx.org.id,
    feature: "ab_variant",
    system: baseSystem(locale, "You are a conversion copywriter. Reply with JSON only."),
    messages: [
      {
        role: "user",
        content: `Write ONE alternative version of this website hero to A/B test against the original: a different angle (benefit, urgency or social proof) with the SAME facts — never invent prices, numbers, awards or reviews. Keep the original language. JSON: {"title":"≤ 80 chars","subtitle":"≤ 220 chars","cta_label":"≤ 30 chars"}\n\nBusiness: ${String(site?.name ?? "").slice(0, 120)}\nOriginal title: ${hero.data.title ?? ""}\nOriginal subtitle: ${hero.data.subtitle ?? ""}\nOriginal button: ${hero.data.cta_label ?? ""}`,
      },
    ],
    temperature: 0.8,
    maxTokens: 400,
    json: true,
  });
  if (!out.ok) return { error: out.error };
  const o = extractJsonObject(out.text);
  if (!o) return { error: "ai.badAnswer" };
  const s = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  const res = { title: s(o.title, 160), subtitle: s(o.subtitle, 500), cta_label: s(o.cta_label, 60) };
  if (!res.title && !res.subtitle) return { error: "ai.badAnswer" };
  return { ok: true, data: res };
}

/** "Improve this text" in the site editor: clearer, more persuasive, same facts and language. */
export async function improveCopyAction(input: { locale: string; text: string; field?: string; tone?: string }): Promise<ActionState<{ text: string }>> {
  const locale = loc(input.locale);
  const ctx = await getOrgContext(locale);
  if (!ctx.can("websites.manage") || !ctx.can("ai.use")) return { error: "errors.forbidden" };
  const text = String(input.text ?? "").trim();
  if (text.length < 2) return { error: "validation.required" };
  if (text.length > 3000) return { error: "validation.tooLong" };
  const supabase = await createClient();
  const { data: allowed } = await supabase.rpc("check_rate_limit", { p_key: "site_copy", p_limit: 80, p_window_seconds: 3600 });
  if (allowed !== true) return { error: "errors.rateLimited" };
  const tone = ["professional", "friendly", "short", "persuasive"].includes(String(input.tone)) ? String(input.tone) : "persuasive";
  const field = String(input.field ?? "text").replace(/[^a-z_]/g, "").slice(0, 30);
  const { runAI } = await import("@/lib/ai/run");
  const { baseSystem } = await import("@/lib/ai/prompt");
  const { cleanCopy } = await import("@/lib/site/copy-core");
  const out = await runAI({
    orgId: ctx.org.id,
    feature: "site_copy",
    system: baseSystem(locale, "You are a website copywriter. Return ONLY the improved text — no quotes, no explanations, no markdown."),
    messages: [{ role: "user", content: `Improve this website ${field} (${tone} tone). Keep the SAME language, facts, prices, names and roughly the same length; never invent details.\n\n${text}` }],
    temperature: 0.6,
    maxTokens: 700,
  });
  if (!out.ok) return { error: out.error };
  const improved = cleanCopy(out.text, text.length);
  if (!improved) return { error: "ai.badAnswer" };
  return { ok: true, data: { text: improved } };
}
