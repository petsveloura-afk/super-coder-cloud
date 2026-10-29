"use server";

import { revalidatePath } from "next/cache";
import { getOrgContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { dbErrorKey, type ActionState } from "@/lib/action-state";
import { TRIAL_FEATURES, type PlanFeature } from "@/lib/billing/features";

/** Wave 55 — starts the 7-day free trial of one paid feature (once per business, checked in Postgres). */
const loc = (l: unknown) => (l === "ar" || l === "en" ? l : "he") as "he" | "ar" | "en";

export async function startTrialAction(input: { locale: string; feature: string; path?: string }): Promise<ActionState<{ endsAt: string }>> {
  const locale = loc(input.locale);
  const ctx = await getOrgContext(locale);
  if (!(ctx.can("billing.manage") || ctx.can("ai.manage"))) return { error: "errors.forbidden" };
  if (!(TRIAL_FEATURES as string[]).includes(input.feature)) return { error: "trial.notAvailable" };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("start_feature_trial", { p_org: ctx.org.id, p_feature: input.feature as PlanFeature });
  if (error) return { error: dbErrorKey(error) };
  const r = (data ?? {}) as { ok?: boolean; error?: string; ends_at?: string };
  if (!r.ok) return { error: r.error ?? "errors.generic" };
  const path = typeof input.path === "string" && /^\/[a-z]{2}\/[\w\-/[\]]*$/.test(input.path) ? input.path : `/${locale}/billing`;
  revalidatePath(path);
  return { ok: true, message: "trial.started", data: { endsAt: r.ends_at ?? "" } };
}
