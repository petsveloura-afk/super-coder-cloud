import "server-only";
import { limitErrorKey } from "@scc/shared/billing";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateAndStoreImage, imagesConfigured } from "@/lib/ai/images";

/**
 * Wave 45 / stage A — metered wrapper around generateAndStoreImage (images.ts is not modified).
 * Same credit rules as runAISystem: reserve_ai_credits_system (demo guard + rate limit + plan cap,
 * feature "image_gen") → generate + store → finalize_ai_usage_system. One image = one credit;
 * a failed generation is finalized as an error and costs nothing.
 */
export type MeteredImage = { ok: true; url: string; model: string } | { ok: false; error: string };

export async function generateMeteredImage(orgId: string, prompt: string): Promise<MeteredImage> {
  if (!imagesConfigured()) return { ok: false, error: "social.studio.notConfigured" };
  const admin = createAdminClient();
  const { data: usageId, error: reserveError } = await admin.rpc("reserve_ai_credits_system", { p_org: orgId, p_feature: "image_gen", p_agent: null });
  if (reserveError || usageId === null || usageId === undefined) {
    return { ok: false, error: limitErrorKey(reserveError?.message) ?? "ai.failed" };
  }
  try {
    const img = await generateAndStoreImage(orgId, prompt);
    await admin.rpc("finalize_ai_usage_system", { p_usage_id: usageId, p_provider: "gemini", p_model: img.model, p_input: 0, p_output: 0, p_ok: true });
    return { ok: true, url: img.url, model: img.model };
  } catch (e) {
    await admin.rpc("finalize_ai_usage_system", { p_usage_id: usageId, p_provider: "gemini", p_model: "none", p_input: 0, p_output: 0, p_ok: false });
    console.error("studio image failed", (e as Error).message);
    return { ok: false, error: "social.studio.imageFailed" };
  }
}
