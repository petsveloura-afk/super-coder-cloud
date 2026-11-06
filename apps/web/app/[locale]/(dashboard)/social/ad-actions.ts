"use server";

import { getOrgContext } from "@/lib/auth";
import type { ActionState } from "@/lib/action-state";
import { AD_ASPECTS, AD_COPY_SYSTEM, AD_STYLES, adVisualPrompt, parseAdCopy, type AdAspect, type AdCopy, type AdStyle } from "@/lib/social/ad-creative-core";

/**
 * Ad creative studio: the copy (1 credit) and, when asked, a cinematic key visual without text (1 image credit). The
 * designed text layer is drawn in the browser, so Hebrew is always spelled right.
 */
const loc = (l: string): "he" | "en" | "ar" => (l === "ar" || l === "en" ? l : "he");

export async function aiAdCreativeAction(input: { locale: string; topic: string; style: string; aspect: string; withImage: boolean }): Promise<ActionState<{ copy: AdCopy; imageUrl?: string; imageError?: string }>> {
  const locale = loc(input.locale);
  const ctx = await getOrgContext(locale);
  if (!ctx.can("campaigns.manage") || !ctx.can("ai.use")) return { error: "errors.forbidden" };
  const topic = String(input.topic ?? "").trim().slice(0, 1200);
  if (topic.length < 3) return { error: "validation.invalid" };
  const style: AdStyle = (AD_STYLES as readonly string[]).includes(input.style) ? (input.style as AdStyle) : "neon";
  const aspect: AdAspect = (AD_ASPECTS as string[]).includes(input.aspect) ? (input.aspect as AdAspect) : "1:1";
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return { error: "errors.generic" };
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const admin = createAdminClient();
  const { data: allowed } = await admin.rpc("public_rate_limit", { p_bucket: `socialai:${ctx.org.id}`, p_limit: 8, p_window_seconds: 60 });
  if (allowed === false) return { error: "ai.busy" };
  const { data: org } = await admin.from("organizations").select("name").eq("id", ctx.org.id).maybeSingle();
  const rtl = locale !== "en" && !/^[\x00-\x7F\s]+$/.test(topic);
  const { runAISystem } = await import("@/lib/ai/run-system");
  const copyP = runAISystem({
    orgId: ctx.org.id,
    feature: "social",
    system: `${AD_COPY_SYSTEM}\nBusiness: "${String(org?.name ?? "").slice(0, 120)}". Visual style: ${style}.`,
    messages: [{ role: "user", content: topic }],
    temperature: 0.8,
    maxTokens: 700,
    patienceMs: 20_000,
  });
  const imageP = input.withImage
    ? (async () => {
        const { generateMeteredImage, topicForImage } = await import("@/lib/social/studio-image");
        const subject = await topicForImage(topic.slice(0, 400));
        const r = await generateMeteredImage(ctx.org.id, adVisualPrompt(subject, style, aspect, rtl), aspect === "16:9" ? "facebook" : "instagram", { aspectRatio: aspect });
        return r;
      })()
    : Promise.resolve(null);
  const [out, img] = await Promise.all([copyP, imageP]);
  if (!out.ok) return { error: out.error };
  const copy = parseAdCopy(out.text, topic);
  if (!copy) return { error: "ai.failed" };
  if (img && img.ok) {
    const { createClient } = await import("@/lib/supabase/server");
    const { normalizeAsset } = await import("@/lib/social/studio-core");
    const row = normalizeAsset({ url: img.url, title: copy.headline, prompt: "ad key visual" });
    if (row) await (await createClient()).from("social_assets").insert({ ...row, organization_id: ctx.org.id, source: "ai", model: img.model, created_by: ctx.userId });
  }
  return { ok: true, data: { copy, imageUrl: img && img.ok ? img.url : undefined, imageError: img && !img.ok ? img.error : undefined } };
}
