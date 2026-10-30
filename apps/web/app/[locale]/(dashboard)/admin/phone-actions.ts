"use server";

import { revalidatePath } from "next/cache";
import { uuidSchema } from "@scc/shared/validators";
import { getOrgContext } from "@/lib/auth";
import type { ActionState } from "@/lib/action-state";

/** Wave 57 — platform admin: give a business a phone number from the platform's Twilio account, or take it back. */
const loc = (l: unknown) => (l === "ar" || l === "en" ? l : "he") as "he" | "ar" | "en";

export async function adminAssignPhoneAction(input: { locale: string; orgId: string; phone: string }): Promise<ActionState> {
  const locale = loc(input.locale);
  const ctx = await getOrgContext(locale);
  if (!ctx.isPlatformAdmin) return { error: "errors.forbidden" };
  const org = uuidSchema.safeParse(input.orgId);
  if (!org.success) return { error: "validation.invalidId" };
  const { toE164 } = await import("@/lib/channels/secrets");
  const phone = toE164(input.phone);
  if (!phone) return { error: "validation.phone" };
  const { assignToOrg } = await import("@/lib/voice/platform-phone");
  const r = await assignToOrg(org.data, phone);
  revalidatePath(`/${locale}/admin`);
  return r.ok ? { ok: true, message: "phone.assigned" } : { error: r.error ?? "errors.generic" };
}

export async function adminBuyPhoneAction(input: { locale: string; orgId: string }): Promise<ActionState> {
  const locale = loc(input.locale);
  const ctx = await getOrgContext(locale);
  if (!ctx.isPlatformAdmin) return { error: "errors.forbidden" };
  const org = uuidSchema.safeParse(input.orgId);
  if (!org.success) return { error: "validation.invalidId" };
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const { data } = await createAdminClient().from("organizations").select("name").eq("id", org.data).maybeSingle();
  const { provisionForOrg } = await import("@/lib/voice/platform-phone");
  const r = await provisionForOrg(org.data, (data?.name as string | undefined) ?? "");
  revalidatePath(`/${locale}/admin`);
  return r.ok ? { ok: true, message: "phone.gotNumber" } : { error: r.error };
}

export async function adminReleasePhoneAction(input: { locale: string; orgId: string }): Promise<ActionState> {
  const locale = loc(input.locale);
  const ctx = await getOrgContext(locale);
  if (!ctx.isPlatformAdmin) return { error: "errors.forbidden" };
  const org = uuidSchema.safeParse(input.orgId);
  if (!org.success) return { error: "validation.invalidId" };
  const { releaseForOrg } = await import("@/lib/voice/platform-phone");
  const ok = await releaseForOrg(org.data);
  revalidatePath(`/${locale}/admin`);
  return ok ? { ok: true, message: "phone.released" } : { error: "errors.generic" };
}
