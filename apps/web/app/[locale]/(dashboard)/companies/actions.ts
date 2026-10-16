"use server";

import { revalidatePath } from "next/cache";
import { companySchema, fieldErrors, uuidSchema } from "@scc/shared/validators";
import { getOrgContext } from "@/lib/auth";
import { kickJobs } from "@/lib/jobs/kick";
import { createClient } from "@/lib/supabase/server";
import { dbErrorKey, type ActionState } from "@/lib/action-state";
import { formLocale, pick, str } from "@/lib/form";

const FIELDS = ["name", "domain", "industry", "phone"];

export async function createCompanyAction(_prev: ActionState<{ id: string }>, fd: FormData): Promise<ActionState<{ id: string }>> {
  const locale = formLocale(fd);
  const ctx = await getOrgContext(locale);
  const values = pick(fd, FIELDS);
  if (!ctx.can("companies.write")) return { error: "errors.forbidden", values };
  const parsed = companySchema.safeParse(values);
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error), values };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("companies")
    .insert({
      organization_id: ctx.org.id,
      name: parsed.data.name,
      domain: parsed.data.domain || null,
      industry: parsed.data.industry || null,
      phone: parsed.data.phone || null,
      owner_id: ctx.userId,
      created_by: ctx.userId,
    })
    .select("id")
    .single();
  if (error) return { error: dbErrorKey(error), values };
  revalidatePath(`/${locale}/companies`);
  kickJobs();
  return { ok: true, message: "companies.created", data: { id: data.id } };
}

export async function updateCompanyAction(_prev: ActionState<{ id: string }>, fd: FormData): Promise<ActionState<{ id: string }>> {
  const locale = formLocale(fd);
  const ctx = await getOrgContext(locale);
  const values = pick(fd, FIELDS);
  const id = uuidSchema.safeParse(str(fd, "id"));
  if (!id.success) return { error: "validation.invalidId", values };
  if (!ctx.can("companies.write")) return { error: "errors.forbidden", values };
  const parsed = companySchema.safeParse(values);
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error), values };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("companies")
    .update({
      name: parsed.data.name,
      domain: parsed.data.domain || null,
      industry: parsed.data.industry || null,
      phone: parsed.data.phone || null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id.data)
    .eq("organization_id", ctx.org.id)
    .select("id");
  if (error) return { error: dbErrorKey(error), values };
  if (!data?.length) return { error: "errors.notFound", values };
  revalidatePath(`/${locale}/companies`);
  revalidatePath(`/${locale}/companies/${id.data}`);
  kickJobs();
  return { ok: true, message: "companies.updated", data: { id: id.data } };
}

export async function deleteCompanyAction(fd: FormData): Promise<ActionState> {
  const locale = formLocale(fd);
  const ctx = await getOrgContext(locale);
  const id = uuidSchema.safeParse(str(fd, "id"));
  if (!id.success || !ctx.can("companies.delete")) return { error: "errors.forbidden" };
  const supabase = await createClient();
  const { error } = await supabase.from("companies").delete().eq("id", id.data).eq("organization_id", ctx.org.id);
  if (error) return { error: dbErrorKey(error) };
  revalidatePath(`/${locale}/companies`);
  kickJobs();
  return { ok: true, message: "companies.deleted" };
}

/** Link / unlink an existing contact to a company (contacts.write). */
export async function linkContactAction(fd: FormData): Promise<ActionState> {
  const locale = formLocale(fd);
  const ctx = await getOrgContext(locale);
  if (!ctx.can("contacts.write")) return { error: "errors.forbidden" };
  const contactId = uuidSchema.safeParse(str(fd, "contactId"));
  const companyRaw = str(fd, "companyId");
  const companyId = companyRaw ? uuidSchema.safeParse(companyRaw) : null;
  if (!contactId.success || (companyId && !companyId.success)) return { error: "validation.invalidId" };
  const supabase = await createClient();
  let companyName: string | null = null;
  if (companyId?.success) {
    const { data: co } = await supabase.from("companies").select("name").eq("id", companyId.data).eq("organization_id", ctx.org.id).maybeSingle();
    if (!co) return { error: "errors.notFound" };
    companyName = co.name;
  }
  const patch: Record<string, unknown> = { company_id: companyId?.success ? companyId.data : null };
  if (companyName) patch.company_name = companyName;
  const { error } = await supabase.from("contacts").update(patch).eq("id", contactId.data).eq("organization_id", ctx.org.id);
  if (error) return { error: dbErrorKey(error) };
  revalidatePath(`/${locale}/companies`);
  if (companyId?.success) revalidatePath(`/${locale}/companies/${companyId.data}`);
  revalidatePath(`/${locale}/crm/${contactId.data}`);
  kickJobs();
  return { ok: true, message: companyId ? "companies.contactLinked" : "companies.contactUnlinked" };
}
