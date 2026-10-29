"use server";

import { z } from "zod";
import { uuidSchema } from "@scc/shared/validators";
import { getOrgContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { dbErrorKey, type ActionState } from "@/lib/action-state";
import { buildImagePrompt, extraVariations, normalizeAsset, splitVariants, variationCount, STUDIO_MORE_EXTRA } from "@/lib/social/studio-core";

/** Wave 45 / stage A — post studio: metered AI images, "more options", asset library. */
const loc = (l: string) => (l === "ar" || l === "en" ? l : "he");

export interface AssetRow {
  id: string;
  url: string;
  title: string | null;
  prompt: string | null;
  source: "ai" | "url";
  created_at: string;
}

const imageSchema = z.object({
  topic: z.string().trim().min(2).max(400),
  platform: z.enum(["facebook", "instagram"]),
  more: z.boolean().optional(),
  existing: z.number().int().min(0).max(3).optional(),
});

/**
 * One image by default (one credit). `more: true` adds up to two more (one credit each) —
 * so credits are only spent when the person asks for more options.
 */
export async function aiImageAction(input: { locale: string; topic: string; platform: string; more?: boolean; existing?: number }): Promise<ActionState<{ images: { url: string }[]; partialError?: string }>> {
  const locale = loc(input.locale);
  const ctx = await getOrgContext(locale);
  if (!ctx.can("campaigns.manage") || !ctx.can("ai.use")) return { error: "errors.forbidden" };
  const p = imageSchema.safeParse(input);
  if (!p.success) return { error: "validation.invalid" };
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return { error: "social.studio.notConfigured" };
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const admin = createAdminClient();
  const { data: allowed } = await admin.rpc("public_rate_limit", { p_bucket: `socialimg:${ctx.org.id}`, p_limit: 6, p_window_seconds: 60 });
  if (allowed === false) return { error: "ai.busy" };
  const count = p.data.more ? extraVariations(p.data.existing ?? 1) : variationCount(false);
  if (count < 1) return { error: "social.studio.maxVariations" };
  const [{ data: org }, { data: social }] = await Promise.all([
    admin.from("organizations").select("name").eq("id", ctx.org.id).maybeSingle(),
    admin.from("social_settings").select("brand_voice").eq("organization_id", ctx.org.id).maybeSingle(),
  ]);
  const prompt = buildImagePrompt({ topic: p.data.topic, platform: p.data.platform, brandVoice: (social?.brand_voice as string | null) ?? null, business: (org?.name as string | null) ?? null });
  const { generateMeteredImage } = await import("@/lib/social/studio-image");
  const supabase = await createClient();
  const images: { url: string }[] = [];
  let partialError: string | undefined;
  for (let i = 0; i < count; i++) {
    const r = await generateMeteredImage(ctx.org.id, prompt, p.data.platform);
    if (!r.ok) {
      partialError = r.error;
      break; // stop at the first failure — nothing more is reserved
    }
    images.push({ url: r.url });
    const row = normalizeAsset({ url: r.url, title: p.data.topic, prompt });
    if (row) await supabase.from("social_assets").insert({ ...row, organization_id: ctx.org.id, source: "ai", model: r.model, created_by: ctx.userId });
  }
  if (!images.length) return { error: partialError ?? "social.studio.imageFailed" };
  return { ok: true, data: { images, partialError } };
}

const moreTextSchema = z.object({
  topic: z.string().trim().min(2).max(400),
  tone: z.enum(["friendly", "professional", "playful", "premium"]),
  platform: z.enum(["facebook", "instagram"]),
  current: z.string().trim().max(5000).optional(),
});

/** "More options" for the text: two alternative posts in ONE metered AI call (one credit). */
export async function aiMoreTextAction(input: { locale: string; topic: string; tone: string; platform: string; current?: string }): Promise<ActionState<{ variants: string[] }>> {
  const locale = loc(input.locale);
  const ctx = await getOrgContext(locale);
  if (!ctx.can("campaigns.manage") || !ctx.can("ai.use")) return { error: "errors.forbidden" };
  const p = moreTextSchema.safeParse(input);
  if (!p.success) return { error: "validation.invalid" };
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return { error: "errors.generic" };
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const admin = createAdminClient();
  const { data: allowed } = await admin.rpc("public_rate_limit", { p_bucket: `socialai:${ctx.org.id}`, p_limit: 8, p_window_seconds: 60 });
  if (allowed === false) return { error: "ai.busy" };
  const [{ data: org }, { data: agent }, { data: social }] = await Promise.all([
    admin.from("organizations").select("name").eq("id", ctx.org.id).maybeSingle(),
    admin.from("ai_agents").select("id, instructions, provider, model").eq("organization_id", ctx.org.id).eq("enabled", true).order("created_at").limit(1).maybeSingle(),
    admin.from("social_settings").select("brand_voice").eq("organization_id", ctx.org.id).maybeSingle(),
  ]);
  const lang = locale === "en" ? "English" : locale === "ar" ? "Arabic" : "Hebrew";
  const isIg = p.data.platform === "instagram";
  const { runAISystem } = await import("@/lib/ai/run-system");
  const out = await runAISystem({
    orgId: ctx.org.id,
    feature: "social",
    agentId: (agent?.id as string | undefined) ?? null,
    provider: (agent?.provider as "openai" | "anthropic" | "gemini" | null) ?? undefined,
    model: (agent?.model as string | null) ?? undefined,
    system: [
      `You are the social media manager of "${String(org?.name ?? "").slice(0, 120)}". Business information:\n${String(agent?.instructions ?? "").slice(0, 4000)}`,
      social?.brand_voice ? `Brand voice: ${String(social.brand_voice).slice(0, 800)}` : "",
      `Write ${STUDIO_MORE_EXTRA} DIFFERENT alternative ${isIg ? "Instagram" : "Facebook"} posts in ${lang}, tone: ${p.data.tone}, each with a different angle. ${isIg ? "Up to 6 short lines, 4-8 relevant hashtags at the end." : "2-5 short lines, 1-3 relevant hashtags at the end."} Emojis sparingly. End each with one clear call to action. NEVER invent prices, discounts, dates or facts that are not in the business information. Separate the posts with a line containing only === . Answer with the posts only — no numbering, no explanations.`,
      p.data.current ? `Already written (do not repeat it):\n${p.data.current.slice(0, 1500)}` : "",
    ].filter(Boolean).join("\n\n"),
    messages: [{ role: "user", content: p.data.topic }],
    temperature: 0.85,
    maxTokens: 1000,
    patienceMs: 20_000,
  });
  if (!out.ok) return { error: out.error };
  const variants = splitVariants(out.text, STUDIO_MORE_EXTRA, isIg ? 2200 : 5000);
  if (!variants.length) return { error: "ai.failed" };
  return { ok: true, data: { variants } };
}

export async function listAssetsAction(input: { locale: string }): Promise<ActionState<{ assets: AssetRow[] }>> {
  const locale = loc(input.locale);
  const ctx = await getOrgContext(locale);
  if (!ctx.can("campaigns.manage")) return { error: "errors.forbidden" };
  const supabase = await createClient();
  const { data, error } = await supabase.from("social_assets").select("id, url, title, prompt, source, created_at").eq("organization_id", ctx.org.id).order("created_at", { ascending: false }).limit(60);
  if (error) return { error: dbErrorKey(error) };
  return { ok: true, data: { assets: (data ?? []) as AssetRow[] } };
}

export async function saveAssetAction(input: { locale: string; url: string; title?: string }): Promise<ActionState> {
  const locale = loc(input.locale);
  const ctx = await getOrgContext(locale);
  if (!ctx.can("campaigns.manage")) return { error: "errors.forbidden" };
  const row = normalizeAsset({ url: input.url, title: input.title });
  if (!row) return { error: "social.studio.badUrl" };
  const supabase = await createClient();
  const { error } = await supabase.from("social_assets").insert({ ...row, organization_id: ctx.org.id, source: "url", created_by: ctx.userId });
  if (error) return { error: error.code === "23505" ? "social.studio.assetExists" : dbErrorKey(error) };
  return { ok: true, message: "social.studio.assetSaved" };
}

export async function deleteAssetAction(input: { locale: string; id: string }): Promise<ActionState> {
  const locale = loc(input.locale);
  const ctx = await getOrgContext(locale);
  if (!ctx.can("campaigns.manage")) return { error: "errors.forbidden" };
  if (!uuidSchema.safeParse(input.id).success) return { error: "validation.invalidId" };
  const supabase = await createClient();
  const { error } = await supabase.from("social_assets").delete().eq("id", input.id).eq("organization_id", ctx.org.id);
  if (error) return { error: dbErrorKey(error) };
  return { ok: true, message: "common.saved" };
}
