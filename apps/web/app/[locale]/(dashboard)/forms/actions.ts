"use server";

import { revalidatePath } from "next/cache";
import { formSchema } from "@scc/shared/engagement";
import { fieldErrors, uuidSchema } from "@scc/shared/validators";
import { getOrgContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { dbErrorKey, type ActionState } from "@/lib/action-state";
import { formLocale, str } from "@/lib/form";

const loc = (l: string) => (l === "ar" || l === "en" ? l : "he");

export async function saveFormAction(input: { locale: string; id?: string; data: unknown }): Promise<ActionState<{ id: string }>> {
  const locale = loc(input.locale);
  const ctx = await getOrgContext(locale);
  if (!ctx.can("forms.manage")) return { error: "errors.forbidden" };
  const parsed = formSchema.safeParse(input.data);
  if (!parsed.success) return { error: "forms.invalid", fieldErrors: fieldErrors(parsed.error) };
  const f = parsed.data;
  const row = { name: f.name, slug: f.slug, status: f.status, fields: f.fields, settings: f.settings, updated_at: new Date().toISOString() };
  const supabase = await createClient();
  if (input.id) {
    const id = uuidSchema.safeParse(input.id);
    if (!id.success) return { error: "validation.invalidId" };
    const { data, error } = await supabase.from("forms").update(row).eq("id", id.data).eq("organization_id", ctx.org.id).select("id");
    if (error) return { error: error.code === "23505" ? "forms.slugTaken" : dbErrorKey(error), fieldErrors: error.code === "23505" ? { slug: "forms.slugTaken" } : undefined };
    if (!data?.length) return { error: "errors.notFound" };
    revalidatePath(`/${locale}/forms`);
    revalidatePath(`/${locale}/forms/${id.data}`);
    return { ok: true, message: "forms.saved", data: { id: id.data } };
  }
  const { data, error } = await supabase.from("forms").insert({ ...row, organization_id: ctx.org.id, created_by: ctx.userId }).select("id").single();
  if (error) return { error: error.code === "23505" ? "forms.slugTaken" : dbErrorKey(error), fieldErrors: error.code === "23505" ? { slug: "forms.slugTaken" } : undefined };
  revalidatePath(`/${locale}/forms`);
  return { ok: true, message: "forms.created", data: { id: data.id } };
}

export async function deleteFormAction(fd: FormData): Promise<ActionState> {
  const locale = formLocale(fd);
  const ctx = await getOrgContext(locale);
  if (!ctx.can("forms.manage")) return { error: "errors.forbidden" };
  const id = uuidSchema.safeParse(str(fd, "id"));
  if (!id.success) return { error: "validation.invalidId" };
  const supabase = await createClient();
  const { error } = await supabase.from("forms").delete().eq("id", id.data).eq("organization_id", ctx.org.id);
  if (error) return { error: dbErrorKey(error) };
  revalidatePath(`/${locale}/forms`);
  return { ok: true, message: "forms.deleted" };
}
