"use server";

import { revalidatePath } from "next/cache";
import { getOrgContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { ActionState } from "@/lib/action-state";
import { META_MODE_FLAG } from "@/lib/channels/meta-mode-core";

/**
 * Round 16 — platform admin: how businesses connect Facebook + Instagram. "own_app" (each business's own Meta app,
 * guided wizard) or "platform" (the platform app's one-click button). Nothing already connected is touched.
 */
export async function setMetaModeAction(input: { locale: string; mode: "platform" | "own_app" }): Promise<ActionState> {
  const locale = input.locale === "ar" || input.locale === "en" ? input.locale : "he";
  const ctx = await getOrgContext(locale);
  if (!ctx.isPlatformAdmin) return { error: "errors.forbidden" };
  if (input.mode !== "platform" && input.mode !== "own_app") return { error: "validation.invalid" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("platform_set_flag", { p_key: META_MODE_FLAG, p_org: null, p_enabled: input.mode === "own_app" });
  if (error) return { error: "common.error" };
  revalidatePath(`/${locale}/admin`);
  revalidatePath(`/${locale}/integrations`);
  return { ok: true, message: input.mode === "own_app" ? "metaMode.savedOwn" : "metaMode.savedPlatform" };
}
