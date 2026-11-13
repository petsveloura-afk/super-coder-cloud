"use server";

import { revalidatePath } from "next/cache";
import { getOrgContext } from "@/lib/auth";
import type { ActionState } from "@/lib/action-state";
import type { SetupCheck } from "@/lib/channels/meta-mode-core";

/**
 * Round 16 — the own-app wizard's "check & fix everything" button: repairs what the app's keys can repair (webhooks,
 * the Page subscription, the addresses Meta requires before Live) and says, in order, what is still missing.
 */
const loc = (l: string) => (l === "ar" || l === "en" ? l : "he");

export async function checkOwnSetupAction(input: { locale: string }): Promise<ActionState<{ checks: SetupCheck[]; appId: string | null }>> {
  const locale = loc(input.locale);
  const ctx = await getOrgContext(locale);
  if (!ctx.can("integrations.manage")) return { error: "errors.forbidden" };
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return { error: "common.error" };
  const { publicEnv } = await import("@/lib/env");
  const { ownSetupStatus } = await import("@/lib/channels/meta-mode");
  const r = await ownSetupStatus(ctx.org.id, publicEnv.appUrl).catch(() => ({ checks: [] as SetupCheck[], appId: null }));
  revalidatePath(`/${locale}/integrations`);
  return { ok: true, data: r };
}
