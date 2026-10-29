"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { fieldErrors } from "@scc/shared/validators";
import { getOrgContext } from "@/lib/auth";
import { LOCALES, isLocale, type Locale } from "@/lib/i18n/config";
import { createClient } from "@/lib/supabase/server";
import { dbErrorKey, formValues, type ActionState } from "@/lib/action-state";

function loc(fd: FormData): Locale {
  const l = fd.get("locale");
  return isLocale(l) ? l : "he";
}

const TIMEZONES = new Set(Intl.supportedValuesOf("timeZone"));

const orgSchema = z.object({
  name: z.string().trim().min(2, "validation.tooShort").max(120, "validation.tooLong"),
  timezone: z.string().refine((tz) => TIMEZONES.has(tz) || tz === "UTC", "validation.required"),
  currency: z.enum(["ILS", "USD", "EUR", "GBP", "AED"]),
  defaultLocale: z.enum(LOCALES),
});

export async function updateOrganizationAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const locale = loc(fd);
  const ctx = await getOrgContext(locale);
  const values = formValues(fd, ["name", "timezone", "currency", "defaultLocale"]);
  if (!ctx.can("org.update")) return { error: "errors.forbidden", values };
  const parsed = orgSchema.safeParse({
    name: fd.get("name"),
    timezone: fd.get("timezone"),
    currency: fd.get("currency"),
    defaultLocale: fd.get("defaultLocale"),
  });
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error), values };
  const supabase = await createClient();
  const { error } = await supabase
    .from("organizations")
    .update({ name: parsed.data.name, timezone: parsed.data.timezone, currency: parsed.data.currency, locale: parsed.data.defaultLocale })
    .eq("id", ctx.org.id);
  if (error) return { error: dbErrorKey(error), values };
  await supabase.rpc("log_event", { p_org: ctx.org.id, p_action: "settings.updated", p_entity_type: "organization", p_entity_id: ctx.org.id });
  revalidatePath(`/${locale}`, "layout");
  return { ok: true, message: "settings.saved" };
}

const profileSchema = z.object({
  fullName: z.string().trim().min(2, "validation.tooShort").max(120, "validation.tooLong"),
  preferredLocale: z.enum(LOCALES),
});

export async function updateProfileAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const locale = loc(fd);
  const ctx = await getOrgContext(locale);
  const parsed = profileSchema.safeParse({ fullName: fd.get("fullName"), preferredLocale: fd.get("preferredLocale") });
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
  const supabase = await createClient();
  const { error } = await supabase
    .from("profiles")
    .update({ full_name: parsed.data.fullName, locale: parsed.data.preferredLocale })
    .eq("id", ctx.userId);
  if (error) return { error: dbErrorKey(error) };
  revalidatePath(`/${locale}`, "layout");
  return { ok: true, message: "settings.saved" };
}

export async function markNotificationsReadAction(fd: FormData) {
  const locale = loc(fd);
  const ctx = await getOrgContext(locale);
  const supabase = await createClient();
  await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("organization_id", ctx.org.id)
    .eq("user_id", ctx.userId)
    .is("read_at", null);
  revalidatePath(`/${locale}`, "layout");
}

/* ---------------------------------------------------------------- wave 52 — personal profile pro (additive) */

const profileProSchema = z.object({
  job_title: z.string().trim().max(120, "validation.tooLong").optional().default(""),
  phone: z.string().trim().max(40, "validation.tooLong").optional().default(""),
  bio: z.string().trim().max(500, "validation.tooLong").optional().default(""),
});

/** Job title, phone and a short bio (shown to the team). */
export async function updateProfileProAction(input: { locale: string; job_title?: string; phone?: string; bio?: string }): Promise<ActionState> {
  const locale = isLocale(input.locale) ? input.locale : "he";
  const ctx = await getOrgContext(locale);
  const p = profileProSchema.safeParse(input);
  if (!p.success) return { error: "validation.invalid" };
  const { cleanPhone } = await import("@/lib/profile/profile-core");
  const phone = p.data.phone ? cleanPhone(p.data.phone) : null;
  if (p.data.phone && !phone) return { error: "settings.pro.badPhone" };
  const supabase = await createClient();
  const { error } = await supabase
    .from("profiles")
    .update({ job_title: p.data.job_title || null, phone, bio: p.data.bio || null })
    .eq("id", ctx.userId);
  if (error) return { error: dbErrorKey(error) };
  revalidatePath(`/${locale}`, "layout");
  return { ok: true, message: "settings.saved" };
}

/** One-time signed upload URL for the profile picture, inside the person's own folder (avatars/<user id>/…). */
export async function createAvatarUploadAction(input: { locale: string; type: string; size: number }): Promise<ActionState<{ signedUrl: string; publicUrl: string }>> {
  const locale = isLocale(input.locale) ? input.locale : "he";
  const ctx = await getOrgContext(locale);
  const { avatarCheck } = await import("@/lib/profile/profile-core");
  const chk = avatarCheck({ type: String(input.type ?? ""), size: Number(input.size) });
  if (!chk.ok) return { error: chk.error === "type" ? "settings.pro.avatarType" : "settings.pro.avatarSize" };
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return { error: "errors.generic" };
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const admin = createAdminClient();
  const { data: bucket } = await admin.storage.getBucket("avatars");
  if (!bucket) await admin.storage.createBucket("avatars", { public: true, fileSizeLimit: 2097152, allowedMimeTypes: ["image/png", "image/jpeg", "image/webp"] }).catch(() => undefined);
  const { randomUUID } = await import("node:crypto");
  const path = `${ctx.userId}/${randomUUID()}.${chk.ext}`;
  const { data, error } = await admin.storage.from("avatars").createSignedUploadUrl(path);
  if (error || !data?.signedUrl) return { error: "settings.pro.avatarFailed" };
  return { ok: true, data: { signedUrl: data.signedUrl, publicUrl: admin.storage.from("avatars").getPublicUrl(path).data.publicUrl } };
}

/** Saves (or clears, with an empty url) the profile picture — only a picture from the person's own folder is accepted. */
export async function setAvatarAction(input: { locale: string; url: string }): Promise<ActionState> {
  const locale = isLocale(input.locale) ? input.locale : "he";
  const ctx = await getOrgContext(locale);
  const url = String(input.url ?? "").trim();
  if (url) {
    const { isOwnAvatarUrl } = await import("@/lib/profile/profile-core");
    const { publicEnv } = await import("@/lib/env");
    if (!isOwnAvatarUrl(url, ctx.userId, publicEnv.supabaseUrl)) return { error: "validation.invalid" };
  }
  const supabase = await createClient();
  const { error } = await supabase.from("profiles").update({ avatar_url: url || null }).eq("id", ctx.userId);
  if (error) return { error: dbErrorKey(error) };
  revalidatePath(`/${locale}`, "layout");
  return { ok: true, message: url ? "settings.pro.avatarSaved" : "settings.pro.avatarRemoved" };
}
