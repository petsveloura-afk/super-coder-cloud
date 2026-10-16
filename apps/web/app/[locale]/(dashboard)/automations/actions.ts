"use server";

import { revalidatePath } from "next/cache";
import { automationSchema, type AutomationInput } from "@scc/shared/automations";
import { fieldErrors, uuidSchema } from "@scc/shared/validators";
import { getOrgContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { dbErrorKey, type ActionState } from "@/lib/action-state";
import { kickJobs } from "@/lib/jobs/kick";
import { formLocale, str } from "@/lib/form";
import type { Locale } from "@/lib/i18n/config";

function asLocale(l: string): Locale {
  return l === "ar" || l === "en" ? l : "he";
}

export async function saveAutomationAction(input: { locale: string; id?: string; data: unknown }): Promise<ActionState<{ id: string }>> {
  const locale = asLocale(input.locale);
  const ctx = await getOrgContext(locale);
  if (!ctx.can("automations.manage")) return { error: "errors.forbidden" };
  const parsed = automationSchema.safeParse(input.data);
  if (!parsed.success) return { error: "automations.invalid", fieldErrors: fieldErrors(parsed.error) };
  const a: AutomationInput = parsed.data;
  const row = {
    name: a.name,
    description: a.description || null,
    enabled: a.enabled,
    trigger_type: a.trigger_type,
    trigger_config: a.trigger_config,
    conditions: a.conditions,
    actions: a.actions,
  };
  const supabase = await createClient();
  if (input.id) {
    const id = uuidSchema.safeParse(input.id);
    if (!id.success) return { error: "validation.invalidId" };
    const { data, error } = await supabase
      .from("automations")
      .update({ ...row, updated_at: new Date().toISOString() })
      .eq("id", id.data)
      .eq("organization_id", ctx.org.id)
      .select("id");
    if (error) return { error: dbErrorKey(error) };
    if (!data?.length) return { error: "errors.notFound" };
    revalidatePath(`/${locale}/automations`);
    revalidatePath(`/${locale}/automations/${id.data}`);
    return { ok: true, message: "automations.saved", data: { id: id.data } };
  }
  const { data, error } = await supabase
    .from("automations")
    .insert({ ...row, organization_id: ctx.org.id, created_by: ctx.userId })
    .select("id")
    .single();
  if (error) return { error: dbErrorKey(error) };
  revalidatePath(`/${locale}/automations`);
  return { ok: true, message: "automations.created", data: { id: data.id } };
}

export async function toggleAutomationAction(fd: FormData): Promise<ActionState> {
  const locale = formLocale(fd);
  const ctx = await getOrgContext(locale);
  if (!ctx.can("automations.manage")) return { error: "errors.forbidden" };
  const id = uuidSchema.safeParse(str(fd, "id"));
  if (!id.success) return { error: "validation.invalidId" };
  const enabled = str(fd, "enabled") === "true";
  const supabase = await createClient();
  const { error } = await supabase.from("automations").update({ enabled, updated_at: new Date().toISOString() }).eq("id", id.data).eq("organization_id", ctx.org.id);
  if (error) return { error: dbErrorKey(error) };
  revalidatePath(`/${locale}/automations`);
  revalidatePath(`/${locale}/automations/${id.data}`);
  return { ok: true, message: enabled ? "automations.enabledMsg" : "automations.disabledMsg" };
}

export async function deleteAutomationAction(fd: FormData): Promise<ActionState> {
  const locale = formLocale(fd);
  const ctx = await getOrgContext(locale);
  if (!ctx.can("automations.manage")) return { error: "errors.forbidden" };
  const id = uuidSchema.safeParse(str(fd, "id"));
  if (!id.success) return { error: "validation.invalidId" };
  const supabase = await createClient();
  const { error } = await supabase.from("automations").delete().eq("id", id.data).eq("organization_id", ctx.org.id);
  if (error) return { error: dbErrorKey(error) };
  revalidatePath(`/${locale}/automations`);
  return { ok: true, message: "automations.deleted" };
}

export async function testAutomationAction(input: { locale: string; id: string; contactId?: string }): Promise<ActionState<{ steps: { type: string; status: string; detail?: string }[] }>> {
  const locale = asLocale(input.locale);
  const ctx = await getOrgContext(locale);
  if (!ctx.can("automations.manage")) return { error: "errors.forbidden" };
  const id = uuidSchema.safeParse(input.id);
  const contact = input.contactId ? uuidSchema.safeParse(input.contactId) : null;
  if (!id.success || (contact && !contact.success)) return { error: "validation.invalidId" };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("test_automation", { p_org: ctx.org.id, p_automation: id.data, p_contact: contact?.success ? contact.data : null, p_deal: null });
  if (error) return { error: dbErrorKey(error) };
  kickJobs();
  revalidatePath(`/${locale}/automations/${id.data}`);
  return { ok: true, message: "automations.testDone", data: data as { steps: { type: string; status: string; detail?: string }[] } };
}
