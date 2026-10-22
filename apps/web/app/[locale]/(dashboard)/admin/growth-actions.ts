"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { uuidSchema } from "@scc/shared/validators";
import { getOrgContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { dbErrorKey, type ActionState } from "@/lib/action-state";

/**
 * Wave 18 — platform admin: per-organization limits (quota overrides), a custom price
 * (white-label / negotiated) and AI credits granted by hand. Every RPC re-checks
 * is_platform_admin() in the database.
 */
const loc = (l: unknown) => (l === "ar" || l === "en" ? l : "he") as "he" | "ar" | "en";
const LIMIT_KEYS = ["contacts", "members", "ai_credits_monthly", "ai_agents", "notify_recipients"] as const;

export interface OrgOverrides {
  id: string;
  name: string;
  slug: string;
  plan: string;
  limit_overrides: Record<string, number>;
  price_overrides: Record<string, Record<string, number>>;
  balance: number;
}

export async function loadOrgOverridesAction(input: { locale: string; org: string }): Promise<ActionState<OrgOverrides>> {
  const ctx = await getOrgContext(loc(input.locale));
  if (!ctx.isPlatformAdmin) return { error: "errors.forbidden" };
  const key = String(input.org ?? "").trim().toLowerCase().slice(0, 80);
  if (!key) return { error: "validation.required" };
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const admin = createAdminClient();
  const q = admin.from("organizations").select("id, name, slug, plan, limit_overrides, price_overrides");
  const { data: o } = await (uuidSchema.safeParse(key).success ? q.eq("id", key) : q.eq("slug", key)).maybeSingle();
  if (!o) return { error: "errors.notFound" };
  const { data: bal } = await admin.rpc("ai_credit_balance", { org: o.id });
  return {
    ok: true,
    data: {
      id: o.id as string,
      name: o.name as string,
      slug: o.slug as string,
      plan: String(o.plan),
      limit_overrides: (o.limit_overrides ?? {}) as Record<string, number>,
      price_overrides: (o.price_overrides ?? {}) as Record<string, Record<string, number>>,
      balance: Number(bal ?? 0),
    },
  };
}

const num = z.union([z.literal(""), z.coerce.number().int().min(-1).max(1_000_000_000)]);
const price = z.union([z.literal(""), z.coerce.number().min(0.01).max(1_000_000)]);

export async function saveOverridesAction(input: { locale: string; org: string; limits: Record<string, string>; prices: Record<string, Record<string, string>> }): Promise<ActionState> {
  const locale = loc(input.locale);
  const ctx = await getOrgContext(locale);
  if (!ctx.isPlatformAdmin) return { error: "errors.forbidden" };
  const org = uuidSchema.safeParse(input.org);
  if (!org.success) return { error: "validation.invalidId" };
  const limits: Record<string, number> = {};
  for (const k of LIMIT_KEYS) {
    const p = num.safeParse(input.limits?.[k] ?? "");
    if (!p.success) return { error: "admin.badOverride" };
    if (p.data !== "") limits[k] = p.data;
  }
  const prices: Record<string, Record<string, number>> = {};
  for (const plan of ["pro", "business"] as const) {
    for (const iv of ["month", "year", "month_usd", "year_usd"] as const) {
      const p = price.safeParse(input.prices?.[plan]?.[iv] ?? "");
      if (!p.success) return { error: "admin.badOverride" };
      if (p.data !== "") (prices[plan] ??= {})[iv] = p.data;
    }
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc("platform_set_overrides", { p_org: org.data, p_limits: limits, p_prices: prices });
  if (error) return { error: dbErrorKey(error) };
  revalidatePath(`/${locale}/admin`);
  return { ok: true, message: "admin.overridesSaved" };
}

export async function grantCreditsAction(input: { locale: string; org: string; credits: number; note?: string }): Promise<ActionState<{ balance: number }>> {
  const locale = loc(input.locale);
  const ctx = await getOrgContext(locale);
  if (!ctx.isPlatformAdmin) return { error: "errors.forbidden" };
  const org = uuidSchema.safeParse(input.org);
  const credits = z.coerce.number().int().min(-10_000_000).max(10_000_000).refine((n) => n !== 0).safeParse(input.credits);
  if (!org.success || !credits.success) return { error: "admin.badOverride" };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("platform_grant_credits", { p_org: org.data, p_credits: credits.data, p_note: String(input.note ?? "").slice(0, 300) || null });
  if (error) return { error: dbErrorKey(error) };
  revalidatePath(`/${locale}/admin`);
  return { ok: true, message: "admin.creditsGranted", data: { balance: Number(data ?? 0) } };
}
