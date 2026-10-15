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
