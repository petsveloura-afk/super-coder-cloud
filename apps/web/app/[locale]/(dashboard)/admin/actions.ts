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
