"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { PLAN_KEYS } from "@scc/shared/billing";
import { uuidSchema } from "@scc/shared/validators";
import { getOrgContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { dbErrorKey, type ActionState } from "@/lib/action-state";
import { formLocale, str } from "@/lib/form";

/** Platform-admin only. Every RPC re-checks is_platform_admin() in the database. */
export async function setPlanAction(fd: FormData): Promise<ActionState> {
  const locale = formLocale(fd);
  const ctx = await getOrgContext(locale);
  if (!ctx.isPlatformAdmin) return { error: "errors.forbidden" };
  const org = uuidSchema.safeParse(str(fd, "org"));
  const plan = z.enum(PLAN_KEYS).safeParse(str(fd, "plan"));
  const end = str(fd, "period_end");
  if (!org.success || !plan.success) return { error: "validation.invalidOption" };
  if (end && Number.isNaN(Date.parse(end))) return { error: "validation.date" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_set_plan", { p_org: org.data, p_plan: plan.data, p_period_end: end ? new Date(end).toISOString() : null });
  if (error) return { error: dbErrorKey(error) };
  revalidatePath(`/${locale}/admin`);
  return { ok: true, message: "admin.planChanged" };
}

export async function setFlagAction(fd: FormData): Promise<ActionState> {
  const locale = formLocale(fd);
  const ctx = await getOrgContext(locale);
  if (!ctx.isPlatformAdmin) return { error: "errors.forbidden" };
  const key = str(fd, "key").trim().toLowerCase();
  if (!/^[a-z0-9_.-]{2,60}$/.test(key)) return { error: "admin.badFlagKey" };
  const rawOrg = str(fd, "org");
  const org = rawOrg ? uuidSchema.safeParse(rawOrg) : null;
  if (org && !org.success) return { error: "validation.invalidId" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("platform_set_flag", { p_key: key, p_org: org?.data ?? null, p_enabled: str(fd, "enabled") === "true" });
  if (error) return { error: dbErrorKey(error) };
  revalidatePath(`/${locale}/admin`);
  return { ok: true, message: "admin.flagSaved" };
}

/* ------------------------------------------------ wave 9: AI health (platform admin) */

export interface AiProbeRow {
  provider: string;
  model: string;
  keyId: string;
  ok: boolean;
  ms: number;
  kind?: string;
  reason?: string;
}

/** Sends one tiny request through every configured AI key and reports the real status of each. */
export async function probeAiAction(locale: string): Promise<ActionState<{ rows: AiProbeRow[] }>> {
  const ctx = await getOrgContext(locale === "en" || locale === "ar" ? locale : "he");
  if (!ctx.isPlatformAdmin) return { error: "errors.forbidden" };
  const { probeAll } = await import("@/lib/ai/router");
  const rows = await probeAll();
  return { ok: true, data: { rows } };
}

/** Forget every "resting" key/model (after adding new keys or upgrading a plan). */
export async function resetAiRestsAction(locale: string): Promise<ActionState> {
  const ctx = await getOrgContext(locale === "en" || locale === "ar" ? locale : "he");
  if (!ctx.isPlatformAdmin) return { error: "errors.forbidden" };
  const { clearRests } = await import("@/lib/ai/router");
  await clearRests();
  return { ok: true, message: "admin.aiHealth.resetDone" };
}
