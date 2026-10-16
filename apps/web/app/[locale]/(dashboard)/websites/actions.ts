"use server";

import { revalidatePath } from "next/cache";
import { siteSchema } from "@scc/shared/engagement";
import { fieldErrors, uuidSchema } from "@scc/shared/validators";
import { getOrgContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { dbErrorKey, type ActionState } from "@/lib/action-state";
import { formLocale, str } from "@/lib/form";

const loc = (l: string) => (l === "ar" || l === "en" ? l : "he");

export async function saveSiteAction(input: { locale: string; id?: string; data: unknown }): Promise<ActionState<{ id: string }>> {
  const locale = loc(input.locale);
  const ctx = await getOrgContext(locale);
  if (!ctx.can("websites.manage")) return { error: "errors.forbidden" };
  const parsed = siteSchema.safeParse(input.data);
  if (!parsed.success) return { error: "websites.invalid", fieldErrors: fieldErrors(parsed.error) };
  const s = parsed.data;
  const row = { name: s.name, slug: s.slug, status: s.status, theme: s.theme, seo: s.seo, blocks: s.blocks, updated_at: new Date().toISOString() };
  const supabase = await createClient();
  const taken = (code?: string) => (code === "23505" ? { error: "websites.slugTaken", fieldErrors: { slug: "websites.slugTaken" } } : null);
  if (input.id) {
    const id = uuidSchema.safeParse(input.id);
    if (!id.success) return { error: "validation.invalidId" };
    const { data: prev } = await supabase.from("sites").select("status, published_at").eq("id", id.data).eq("organization_id", ctx.org.id).maybeSingle();
    if (!prev) return { error: "errors.notFound" };
    const published_at = s.status === "published" ? ((prev.published_at as string | null) ?? new Date().toISOString()) : prev.published_at;
    const { error } = await supabase.from("sites").update({ ...row, published_at }).eq("id", id.data).eq("organization_id", ctx.org.id);
    if (error) return taken(error.code) ?? { error: dbErrorKey(error) };
    revalidatePath(`/${locale}/websites`);
    revalidatePath(`/${locale}/websites/${id.data}`);
    revalidatePath(`/${locale}/s/${s.slug}`);
    return { ok: true, message: s.status === "published" ? "websites.savedPublished" : "websites.saved", data: { id: id.data } };
  }
  const { data, error } = await supabase
    .from("sites")
    .insert({ ...row, organization_id: ctx.org.id, created_by: ctx.userId, published_at: s.status === "published" ? new Date().toISOString() : null })
    .select("id")
    .single();
  if (error) return taken(error.code) ?? { error: dbErrorKey(error) };
  revalidatePath(`/${locale}/websites`);
  return { ok: true, message: "websites.created", data: { id: data.id as string } };
}

export async function deleteSiteAction(fd: FormData): Promise<ActionState> {
  const locale = formLocale(fd);
  const ctx = await getOrgContext(locale);
  if (!ctx.can("websites.manage")) return { error: "errors.forbidden" };
  const id = uuidSchema.safeParse(str(fd, "id"));
  if (!id.success) return { error: "validation.invalidId" };
  const supabase = await createClient();
  const { error } = await supabase.from("sites").delete().eq("id", id.data).eq("organization_id", ctx.org.id);
  if (error) return { error: dbErrorKey(error) };
  revalidatePath(`/${locale}/websites`);
  return { ok: true, message: "websites.deleted" };
}
