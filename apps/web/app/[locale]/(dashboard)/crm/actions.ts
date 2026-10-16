"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { contactSchema, fieldErrors, uuidSchema } from "@scc/shared/validators";
import { getOrgContext } from "@/lib/auth";
import { kickJobs } from "@/lib/jobs/kick";
import { isLocale, type Locale } from "@/lib/i18n/config";
import { createClient } from "@/lib/supabase/server";
import { dbErrorKey, formValues, type ActionState } from "@/lib/action-state";

const FIELDS = ["firstName", "lastName", "email", "phone", "companyName", "jobTitle", "status", "source", "notes"];

function loc(fd: FormData): Locale {
  const l = fd.get("locale");
  return isLocale(l) ? l : "he";
}

function parseContact(fd: FormData) {
  return contactSchema.safeParse({
    firstName: fd.get("firstName"),
    lastName: fd.get("lastName") ?? "",
    email: fd.get("email") ?? "",
    phone: fd.get("phone") ?? "",
    companyName: fd.get("companyName") ?? "",
    jobTitle: fd.get("jobTitle") ?? "",
    status: fd.get("status") || undefined,
    source: fd.get("source") || undefined,
    notes: fd.get("notes") ?? "",
    marketingConsent: fd.get("marketingConsent") === "on",
  });
}

function toRow(c: z.infer<typeof contactSchema>) {
  return {
    first_name: c.firstName,
    last_name: c.lastName,
    email: c.email || null,
    phone: c.phone || null,
    company_name: c.companyName || null,
    job_title: c.jobTitle || null,
    status: c.status,
    source: c.source,
    marketing_consent: c.marketingConsent,
  };
}

export async function createContactAction(_prev: ActionState<{ id: string }>, fd: FormData): Promise<ActionState<{ id: string }>> {
  const locale = loc(fd);
  const ctx = await getOrgContext(locale);
  const values = formValues(fd, FIELDS);
  if (!ctx.can("contacts.write")) return { error: "errors.forbidden", values };
  const parsed = parseContact(fd);
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error), values };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("contacts")
    // organization_id comes from the server-resolved context, never from the form.
    .insert({ ...toRow(parsed.data), organization_id: ctx.org.id, created_by: ctx.userId, owner_id: ctx.userId })
    .select("id")
    .single();
  if (error) {
    if (error.code === "23505") return { fieldErrors: { email: "crm.duplicateEmail" }, values };
    return { error: dbErrorKey(error), values };
  }
  if (parsed.data.notes) {
    await supabase.from("notes").insert({ organization_id: ctx.org.id, contact_id: data.id, body: parsed.data.notes, created_by: ctx.userId });
  }
  revalidatePath(`/${locale}/crm`);
  revalidatePath(`/${locale}/overview`);
  kickJobs();
  return { ok: true, message: "crm.created", data: { id: data.id } };
}

export async function updateContactAction(_prev: ActionState<{ id: string }>, fd: FormData): Promise<ActionState<{ id: string }>> {
  const locale = loc(fd);
  const ctx = await getOrgContext(locale);
  const values = formValues(fd, FIELDS);
  const id = uuidSchema.safeParse(fd.get("id"));
  if (!id.success) return { error: "validation.invalidId", values };
  if (!ctx.can("contacts.write")) return { error: "errors.forbidden", values };
  const parsed = parseContact(fd);
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error), values };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("contacts")
    .update(toRow(parsed.data))
    .eq("id", id.data)
    .eq("organization_id", ctx.org.id)
    .select("id");
  if (error) {
    if (error.code === "23505") return { fieldErrors: { email: "crm.duplicateEmail" }, values };
    return { error: dbErrorKey(error), values };
  }
  if (!data?.length) return { error: "errors.notFound", values }; // RLS hid it or it doesn't exist
  revalidatePath(`/${locale}/crm`);
  revalidatePath(`/${locale}/crm/${id.data}`);
  kickJobs();
  return { ok: true, message: "crm.updated", data: { id: id.data } };
}

export async function deleteContactAction(fd: FormData) {
  const locale = loc(fd);
  const ctx = await getOrgContext(locale);
  const id = uuidSchema.safeParse(fd.get("id"));
  if (!id.success || !ctx.can("contacts.delete")) redirect(`/${locale}/crm?error=forbidden`);
  const supabase = await createClient();
  await supabase.from("contacts").delete().eq("id", id.data).eq("organization_id", ctx.org.id);
  revalidatePath(`/${locale}/crm`);
  revalidatePath(`/${locale}/overview`);
  redirect(`/${locale}/crm?deleted=1`);
}

const noteSchema = z.object({ contactId: uuidSchema, body: z.string().trim().min(1, "validation.required").max(10000, "validation.tooLong") });

export async function addNoteAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const locale = loc(fd);
  const ctx = await getOrgContext(locale);
  if (!ctx.can("contacts.write")) return { error: "errors.forbidden" };
  const parsed = noteSchema.safeParse({ contactId: fd.get("contactId"), body: fd.get("body") });
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
  const supabase = await createClient();
  const { error } = await supabase.from("notes").insert({
    organization_id: ctx.org.id,
    contact_id: parsed.data.contactId,
    body: parsed.data.body,
    created_by: ctx.userId,
  });
  // A contact id from another tenant fails the composite FK / RLS check here.
  if (error) return { error: dbErrorKey(error) };
  revalidatePath(`/${locale}/crm/${parsed.data.contactId}`);
  kickJobs();
  return { ok: true, message: "crm.noteAdded" };
}
