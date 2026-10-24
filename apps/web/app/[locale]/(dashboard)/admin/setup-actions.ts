"use server";

import { getOrgContext } from "@/lib/auth";
import type { LiveChecks } from "@/lib/admin/setup";

/** Wave 20 — "check now" in the setup wizard (platform admins only). */
export async function checkPlatformSetupAction(input: { locale: string }): Promise<{ error?: string; data?: LiveChecks }> {
  const locale = input.locale === "ar" || input.locale === "en" ? input.locale : "he";
  const ctx = await getOrgContext(locale);
  if (!ctx.isPlatformAdmin) return { error: "errors.forbidden" };
  const { runLiveChecks } = await import("@/lib/admin/setup");
  return { data: await runLiveChecks() };
}
