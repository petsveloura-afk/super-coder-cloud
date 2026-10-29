"use server";

import { z } from "zod";
import { uuidSchema } from "@scc/shared/validators";
import { getOrgContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { dbErrorKey, type ActionState } from "@/lib/action-state";
import { buildImagePrompt, buildTextBrief, extraVariations, normalizeAsset, splitVariants, validateVariants, variationCount, STUDIO_MORE_EXTRA } from "@/lib/social/studio-core";
import { STUDIO_GOALS, STUDIO_STYLES, buildSceneImagePrompt, goalDirection, parseFullPost, postToSceneSeed } from "@/lib/social/studio-core";

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
  const { generateMeteredImage, topicForImage } = await import("@/lib/social/studio-image");
  // image models understand English far better than Hebrew/Arabic: translate the topic first (free text call, no credit)
  const topicEn = await topicForImage(p.data.topic);
  const prompt = buildImagePrompt({ topic: topicEn, platform: p.data.platform, brandVoice: (social?.brand_voice as string | null) ?? null, business: (org?.name as string | null) ?? null });
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
      `Write ${STUDIO_MORE_EXTRA} DIFFERENT alternative ${isIg ? "Instagram" : "Facebook"} posts in ${lang}, tone: ${p.data.tone}, each with a different angle (for example: benefit, story, question). Each post must be a complete, ready-to-publish post of at least 2 full sentences, written about the subject the user gives. NEVER answer with just the subject or a single word. ${isIg ? "Up to 6 short lines, 4-8 relevant hashtags at the end." : "2-5 short lines, 1-3 relevant hashtags at the end."} Emojis sparingly. End each with one clear call to action. If the business information does not cover something, stay general: NEVER invent prices, discounts, dates, names or facts. Separate the posts with a line containing only === . Answer with the posts only: no numbering, no titles, no explanations.`,
      p.data.current ? `Already written (do not repeat it):\n${p.data.current.slice(0, 1500)}` : "",
    ].filter(Boolean).join("\n\n"),
    messages: [{ role: "user", content: buildTextBrief({ topic: p.data.topic, tone: p.data.tone, platform: p.data.platform, langName: lang }) }],
    temperature: 0.8,
    maxTokens: 1000,
    patienceMs: 20_000,
  });
  if (!out.ok) return { error: out.error };
  const variants = validateVariants(splitVariants(out.text, STUDIO_MORE_EXTRA, isIg ? 2200 : 5000), p.data.topic, p.data.current);
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

/* ---------------------------------------------------------------- stage B — text → image bridge & full post (additive) */

const proImageSchema = z.object({
  topic: z.string().trim().max(400).optional(),
  postText: z.string().trim().max(5000).optional(),
  platform: z.enum(["facebook", "instagram"]),
  style: z.enum(STUDIO_STYLES).optional(),
  more: z.boolean().optional(),
  existing: z.number().int().min(0).max(3).optional(),
});

/**
 * Image from the post itself (or from a topic) with a chosen visual style.
 * When `postText` is given, a free AI step turns the post into a concrete visual scene that matches it,
 * so the picture follows exactly what the agent wrote. Same credits rule: one image = one credit.
 */
export async function aiImageProAction(input: { locale: string; topic?: string; postText?: string; platform: string; style?: string; more?: boolean; existing?: number }): Promise<ActionState<{ images: { url: string }[]; partialError?: string; scene?: string }>> {
  const locale = loc(input.locale);
  const ctx = await getOrgContext(locale);
  if (!ctx.can("campaigns.manage") || !ctx.can("ai.use")) return { error: "errors.forbidden" };
  const p = proImageSchema.safeParse(input);
  if (!p.success) return { error: "validation.invalid" };
  const topic = (p.data.topic ?? "").trim();
  const postText = (p.data.postText ?? "").trim();
  if (topic.length < 2 && postText.length < 2) return { error: "validation.invalid" };
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
  const { generateMeteredImage, topicForImage, sceneForImage } = await import("@/lib/social/studio-image");
  // the post wins: the picture must match what was actually written; the topic box refines it when both exist
  const scene = postText.length >= 2 ? await sceneForImage(topic.length >= 2 ? `${topic}\n\n${postText}` : postText) : await topicForImage(topic);
  const prompt = buildSceneImagePrompt({ scene, platform: p.data.platform, style: p.data.style ?? "auto", brandVoice: (social?.brand_voice as string | null) ?? null, business: (org?.name as string | null) ?? null });
  const title = (topic || postToSceneSeed(postText) || postText).slice(0, 200);
  const supabase = await createClient();
  const images: { url: string }[] = [];
  let partialError: string | undefined;
  for (let i = 0; i < count; i++) {
    const r = await generateMeteredImage(ctx.org.id, prompt, p.data.platform);
    if (!r.ok) {
      partialError = r.error;
      break;
    }
    images.push({ url: r.url });
    const row = normalizeAsset({ url: r.url, title, prompt });
    if (row) await supabase.from("social_assets").insert({ ...row, organization_id: ctx.org.id, source: "ai", model: r.model, created_by: ctx.userId });
  }
  if (!images.length) return { error: partialError ?? "social.studio.imageFailed" };
  return { ok: true, data: { images, partialError, scene } };
}

const fullPostSchema = z.object({
  topic: z.string().trim().min(2).max(400),
  tone: z.enum(["friendly", "professional", "playful", "premium"]),
  platform: z.enum(["facebook", "instagram"]),
  style: z.enum(STUDIO_STYLES).optional(),
  goal: z.enum(STUDIO_GOALS).optional(),
  withImage: z.boolean().optional(),
});

export interface FullPostResult {
  text: string;
  imageUrl?: string;
  imageError?: string;
  scene?: string;
  headline?: string;
  firstComment?: string;
  alt?: string;
}

/**
 * "Full post in one click": ONE AI text call writes a complete post (hook, body, CTA, hashtags) plus an
 * art-directed scene, then ONE image is generated from that scene (one image credit). If the image fails
 * the text is still returned, so the person never loses the written post.
 */
export async function aiFullPostAction(input: { locale: string; topic: string; tone: string; platform: string; style?: string; goal?: string; withImage?: boolean }): Promise<ActionState<FullPostResult>> {
  const locale = loc(input.locale);
  const ctx = await getOrgContext(locale);
  if (!ctx.can("campaigns.manage") || !ctx.can("ai.use")) return { error: "errors.forbidden" };
  const p = fullPostSchema.safeParse(input);
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
  const maxLen = isIg ? 2200 : 5000;
  const { runAISystem } = await import("@/lib/ai/run-system");
  const out = await runAISystem({
    orgId: ctx.org.id,
    feature: "social",
    agentId: (agent?.id as string | undefined) ?? null,
    provider: (agent?.provider as "openai" | "anthropic" | "gemini" | null) ?? undefined,
    model: (agent?.model as string | null) ?? undefined,
    system: [
      `You are a senior social media strategist and copywriter for "${String(org?.name ?? "").slice(0, 120)}". Business information:\n${String(agent?.instructions ?? "").slice(0, 4000)}`,
      social?.brand_voice ? `Brand voice: ${String(social.brand_voice).slice(0, 800)}` : "",
      `Create ONE complete, ready-to-publish ${isIg ? "Instagram" : "Facebook"} post in ${lang}, tone: ${p.data.tone}.`,
      goalDirection(p.data.goal ?? "engage"),
      [
        "Structure of the post:",
        "1) First line = a scroll-stopping hook (max ~12 words) — a bold promise, a surprising fact or a direct question.",
        `2) Body: ${isIg ? "3-6 short lines" : "2-4 short lines"}, one idea per line, easy to scan, written for mobile, with line breaks between ideas.`,
        "3) One clear call to action line (message us / book / call / comment / share).",
        `4) Hashtags on the last line: ${isIg ? "5-10 relevant, mix of popular and niche, in the post language and English" : "1-3 relevant"}.`,
        "Use 2-4 fitting emojis, never more. Natural, human, native-level language — never robotic, never generic filler.",
        "NEVER invent prices, discounts, dates, names, addresses or facts that are not in the business information.",
      ].join("\n"),
      [
        "Also art-direct ONE image for the post: \"scene\" = a concrete English description of a photograph that matches the post (subject, setting, mood, colors, lighting; max 45 words; no text, letters, logos, prices or numbers in the image).",
        `Also write: "headline" = a 3-7 word headline in ${lang}; "firstComment" = an optional first comment in ${lang} that adds value or extra hashtags (may be empty); "alt" = short accessibility alt text in ${lang} for the image.`,
        'Answer with JSON ONLY, exactly: {"post": "...", "scene": "...", "headline": "...", "firstComment": "...", "alt": "..."} — use \\n for line breaks inside strings. No code fences, no explanations.',
      ].join("\n"),
    ].filter(Boolean).join("\n\n"),
    messages: [{ role: "user", content: buildTextBrief({ topic: p.data.topic, tone: p.data.tone, platform: p.data.platform, langName: lang }) }],
    temperature: 0.75,
    maxTokens: 1400,
    patienceMs: 20_000,
  });
  if (!out.ok) return { error: out.error };
  const parts = parseFullPost(out.text, maxLen);
  if (!parts || validateVariants([parts.post], p.data.topic).length === 0) return { error: "ai.failed" };
  const result: FullPostResult = {
    text: parts.post,
    headline: parts.headline ?? undefined,
    firstComment: parts.firstComment ?? undefined,
    alt: parts.alt ?? undefined,
  };
  if (p.data.withImage === false) return { ok: true, data: result };

  // image step — failures here never lose the text
  const { data: imgAllowed } = await admin.rpc("public_rate_limit", { p_bucket: `socialimg:${ctx.org.id}`, p_limit: 6, p_window_seconds: 60 });
  if (imgAllowed === false) return { ok: true, data: { ...result, imageError: "ai.busy" } };
  const { generateMeteredImage, sceneForImage } = await import("@/lib/social/studio-image");
  const scene = parts.scene && !/[\u0590-\u05FF\u0600-\u06FF]/.test(parts.scene) ? parts.scene : await sceneForImage(parts.post);
  const prompt = buildSceneImagePrompt({ scene, platform: p.data.platform, style: p.data.style ?? "photo", brandVoice: (social?.brand_voice as string | null) ?? null, business: (org?.name as string | null) ?? null });
  const img = await generateMeteredImage(ctx.org.id, prompt, p.data.platform);
  if (!img.ok) return { ok: true, data: { ...result, scene, imageError: img.error } };
  const row = normalizeAsset({ url: img.url, title: parts.headline ?? p.data.topic, prompt });
  if (row) {
    const supabase = await createClient();
    await supabase.from("social_assets").insert({ ...row, organization_id: ctx.org.id, source: "ai", model: img.model, created_by: ctx.userId });
  }
  return { ok: true, data: { ...result, scene, imageUrl: img.url } };
}

/* ---------------------------------------------------------------- wave 51 — upload images / videos from the device (additive) */

const MEDIA_BUCKET = "social-media";

/**
 * Issues a one-time signed upload URL in the business's own folder (<org>/…), after checking type and size.
 * The browser uploads the file straight to storage (no size limit of the server in between), then uses `publicUrl`.
 * The bucket is created on first use when the migration did not create it.
 */
export async function createMediaUploadAction(input: { locale: string; type: string; size: number }): Promise<ActionState<{ signedUrl: string; publicUrl: string; kind: "image" | "video" }>> {
  const locale = loc(input.locale);
  const ctx = await getOrgContext(locale);
  if (!ctx.can("campaigns.manage")) return { error: "errors.forbidden" };
  const { uploadCheck } = await import("@/lib/social/post-core");
  const chk = uploadCheck({ type: String(input.type ?? ""), size: Number(input.size) });
  if (!chk.ok) return { error: chk.error === "type" ? "social.post.uploadType" : "social.post.uploadSize" };
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return { error: "errors.generic" };
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const admin = createAdminClient();
  const { data: allowed } = await admin.rpc("public_rate_limit", { p_bucket: `socialupload:${ctx.org.id}`, p_limit: 30, p_window_seconds: 300 });
  if (allowed === false) return { error: "ai.busy" };
  const { data: bucket } = await admin.storage.getBucket(MEDIA_BUCKET);
  if (!bucket) {
    await admin.storage
      .createBucket(MEDIA_BUCKET, { public: true, fileSizeLimit: 52428800, allowedMimeTypes: ["image/png", "image/jpeg", "image/webp", "image/gif", "video/mp4", "video/quicktime", "video/webm"] })
      .catch(() => undefined);
  }
  const { randomUUID } = await import("node:crypto");
  const path = `${ctx.org.id}/${randomUUID()}.${chk.ext}`;
  const { data, error } = await admin.storage.from(MEDIA_BUCKET).createSignedUploadUrl(path);
  if (error || !data?.signedUrl) return { error: "social.post.uploadFailed" };
  const publicUrl = admin.storage.from(MEDIA_BUCKET).getPublicUrl(path).data.publicUrl;
  return { ok: true, data: { signedUrl: data.signedUrl, publicUrl, kind: chk.kind } };
}
