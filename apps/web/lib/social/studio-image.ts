import "server-only";
import { randomUUID } from "node:crypto";
import { limitErrorKey } from "@scc/shared/billing";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateAndStoreImage, imagesConfigured } from "@/lib/ai/images";
import { generateRouted } from "@/lib/ai/router";
import { chainFor } from "./image-providers-core";
import { PRIMARY_COOLDOWN_MS, buildFallbackUrl, cleanTranslation, isQuotaError, needsEnglishTopic, postToSceneSeed, primaryAvailable, type StudioPlatform } from "./studio-core";

/**
 * Wave 45 / stage A — metered image generation for the post studio (images.ts is not modified).
 * Credits: reserve_ai_credits_system → generate + store → finalize_ai_usage_system (feature "image_gen").
 * One image = one credit; a failed generation is finalized as an error and costs nothing.
 *
 * Providers, in order:
 *  1. Gemini image models (existing key pool). After a quota error (429) it is skipped for 10 minutes
 *     so each click does not burn ~6 provider calls.
 *  2. Keyless fallback generator (Pollinations by default; STUDIO_IMAGE_FALLBACK=off disables it,
 *     STUDIO_IMAGE_FALLBACK_URL points to another compatible endpoint, POLLINATIONS_API_KEY is sent
 *     as a bearer token when set). The picture is downloaded and stored in the same public bucket.
 */
export type MeteredImage = { ok: true; url: string; model: string } | { ok: false; error: string };

let primaryCoolUntil = 0;

async function fallbackAndStore(orgId: string, prompt: string, platform: StudioPlatform): Promise<{ url: string; model: string }> {
  if ((process.env.STUDIO_IMAGE_FALLBACK ?? "pollinations").toLowerCase() === "off") throw new Error("fallback_off");
  const key = process.env.POLLINATIONS_API_KEY;
  const url = buildFallbackUrl(prompt, platform, Date.now(), process.env.STUDIO_IMAGE_FALLBACK_URL || undefined);
  const res = await fetch(url, { headers: key ? { Authorization: `Bearer ${key}` } : undefined, signal: AbortSignal.timeout(55_000), cache: "no-store" });
  if (!res.ok) throw new Error(`fallback_${res.status}`);
  const mime = (res.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
  if (!mime.startsWith("image/")) throw new Error("fallback_not_image");
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 2_000 || buf.length > 8 * 1024 * 1024) throw new Error("fallback_bad_size");
  const ext = mime.includes("jpeg") ? "jpg" : mime.includes("webp") ? "webp" : "png";
  const path = `${orgId}/${randomUUID()}.${ext}`;
  const admin = createAdminClient();
  const { error } = await admin.storage.from("site-assets").upload(path, buf, { contentType: mime, upsert: false, cacheControl: "31536000" });
  if (error) throw new Error(`image_store:${error.message}`);
  return { url: admin.storage.from("site-assets").getPublicUrl(path).data.publicUrl, model: "flux-fallback" };
}

async function produce(orgId: string, prompt: string, platform: StudioPlatform): Promise<{ url: string; model: string; provider: string }> {
  let primaryError = "";
  if (imagesConfigured() && primaryAvailable(primaryCoolUntil, Date.now())) {
    try {
      const r = await generateAndStoreImage(orgId, prompt);
      return { ...r, provider: "gemini" };
    } catch (e) {
      primaryError = (e as Error).message;
      if (isQuotaError(primaryError)) primaryCoolUntil = Date.now() + PRIMARY_COOLDOWN_MS;
    }
  }
  // wave 49 — free AI generators (Cloudflare / Hugging Face / Together) before the keyless fallback
  const chain = chainFor(process.env);
  if (chain.before.length) {
    try {
      const { runFreeChain } = await import("./image-providers");
      return await runFreeChain(orgId, prompt, platform, chain.before, 45_000);
    } catch (e) {
      console.error("studio free chain (before) failed", (e as Error).message);
    }
  }
  try {
    const r = await fallbackAndStore(orgId, prompt, platform);
    return { ...r, provider: "fallback" };
  } catch (e) {
    const fb = (e as Error).message;
    console.error("studio fallback failed", fb);
    // wave 49 — real photos (Pexels / Pixabay / Openverse) and, last, the branded design that always works
    if (chain.after.length) {
      try {
        const { runFreeChain } = await import("./image-providers");
        return await runFreeChain(orgId, prompt, platform, chain.after, 30_000);
      } catch (e2) {
        console.error("studio free chain (after) failed", (e2 as Error).message);
      }
    }
    // while the primary provider is cooling down after a quota error, report it as a quota problem
    throw new Error(primaryError || (primaryAvailable(primaryCoolUntil, Date.now()) ? fb : "image_429:cooldown"));
  }
}

export async function generateMeteredImage(orgId: string, prompt: string, platform: StudioPlatform = "facebook"): Promise<MeteredImage> {
  const admin = createAdminClient();
  const { data: usageId, error: reserveError } = await admin.rpc("reserve_ai_credits_system", { p_org: orgId, p_feature: "image_gen", p_agent: null });
  if (reserveError || usageId === null || usageId === undefined) {
    return { ok: false, error: limitErrorKey(reserveError?.message) ?? "ai.failed" };
  }
  try {
    const img = await produce(orgId, prompt, platform);
    await admin.rpc("finalize_ai_usage_system", { p_usage_id: usageId, p_provider: img.provider, p_model: img.model, p_input: 0, p_output: 0, p_ok: true });
    return { ok: true, url: img.url, model: img.model };
  } catch (e) {
    await admin.rpc("finalize_ai_usage_system", { p_usage_id: usageId, p_provider: "none", p_model: "none", p_input: 0, p_output: 0, p_ok: false });
    const msg = (e as Error).message;
    console.error("studio image failed", msg);
    return { ok: false, error: isQuotaError(msg) ? "social.studio.quota" : "social.studio.imageFailed" };
  }
}

/**
 * Hebrew/Arabic topic → short English picture description for the image model (free text call through the
 * AI router, no credit). Any failure returns the original topic, so generation is never blocked by this step.
 */
export async function topicForImage(topic: string): Promise<string> {
  if (!needsEnglishTopic(topic)) return topic;
  try {
    const r = await generateRouted({
      system: "Translate the user's text into a short, concrete English description of a photograph (max 25 words). Output only the translation: no quotes, no explanations.",
      messages: [{ role: "user", content: topic.slice(0, 400) }],
      temperature: 0.2,
      maxTokens: 120,
      budgetMs: 8000,
      maxCalls: 2,
    });
    return cleanTranslation(r.text, topic);
  } catch (e) {
    console.error("studio topic translation failed", (e as Error).message);
    return topic;
  }
}

/**
 * Stage B — a finished post (any language) → one concrete English photo scene for the image model
 * (free text call through the AI router, no credit). Falls back to translating a short seed of the post,
 * so image generation is never blocked by this step.
 */
export async function sceneForImage(postText: string): Promise<string> {
  const seed = postToSceneSeed(postText) || postText.slice(0, 400);
  try {
    const r = await generateRouted({
      system:
        "You are an art director. Read the social media post and describe ONE concrete, photographable scene in English that visually matches its message (max 45 words): subject, setting, mood, colors, lighting. No text, letters, logos, prices or numbers in the scene. Output only the description: no quotes, no explanations.",
      messages: [{ role: "user", content: postText.slice(0, 1500) }],
      temperature: 0.4,
      maxTokens: 160,
      budgetMs: 9000,
      maxCalls: 2,
    });
    const scene = cleanTranslation(r.text, "");
    if (scene.length >= 8) return scene;
  } catch (e) {
    console.error("studio scene from post failed", (e as Error).message);
  }
  return topicForImage(seed);
}
