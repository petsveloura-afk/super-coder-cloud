"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { appointmentTypeSchema } from "@scc/shared/engagement";
import { fieldErrors, uuidSchema } from "@scc/shared/validators";
import { getOrgContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { dbErrorKey, type ActionState } from "@/lib/action-state";
import { kickJobs } from "@/lib/jobs/kick";
import { formLocale, str } from "@/lib/form";

const loc = (l: string) => (l === "ar" || l === "en" ? l : "he");

export async function saveAppointmentTypeAction(input: { locale: string; id?: string; data: unknown; hostId?: string }): Promise<ActionState<{ id: string }>> {
  const locale = loc(input.locale);
  const ctx = await getOrgContext(locale);
  if (!ctx.can("appointments.manage")) return { error: "errors.forbidden" };
  const parsed = appointmentTypeSchema.safeParse(input.data);
  if (!parsed.success) return { error: "booking.invalid", fieldErrors: fieldErrors(parsed.error) };
  const host = input.hostId && uuidSchema.safeParse(input.hostId).success ? input.hostId : ctx.userId;
  const row = { ...parsed.data, description: parsed.data.description || null, location: parsed.data.location || null, host_id: host };
  const supabase = await createClient();
  if (input.id) {
    const id = uuidSchema.safeParse(input.id);
    if (!id.success) return { error: "validation.invalidId" };
    const { error } = await supabase.from("appointment_types").update(row).eq("id", id.data).eq("organization_id", ctx.org.id);
    if (error) return { error: error.code === "23505" ? "forms.slugTaken" : dbErrorKey(error) };
    revalidatePath(`/${locale}/appointments`);
    return { ok: true, message: "booking.typeSaved", data: { id: id.data } };
  }
  const { data, error } = await supabase.from("appointment_types").insert({ ...row, organization_id: ctx.org.id }).select("id").single();
  if (error) return { error: error.code === "23505" ? "forms.slugTaken" : dbErrorKey(error) };
  revalidatePath(`/${locale}/appointments`);
  return { ok: true, message: "booking.typeSaved", data: { id: data.id } };
}

export async function deleteAppointmentTypeAction(fd: FormData): Promise<ActionState> {
  const locale = formLocale(fd);
  const ctx = await getOrgContext(locale);
  if (!ctx.can("appointments.manage")) return { error: "errors.forbidden" };
  const id = uuidSchema.safeParse(str(fd, "id"));
  if (!id.success) return { error: "validation.invalidId" };
  const supabase = await createClient();
  const { error } = await supabase.from("appointment_types").delete().eq("id", id.data).eq("organization_id", ctx.org.id);
  if (error) return { error: dbErrorKey(error) };
  revalidatePath(`/${locale}/appointments`);
  return { ok: true, message: "booking.typeDeleted" };
}

const manualSchema = z.object({
  title: z.string().trim().min(1, { message: "validation.required" }).max(200),
  start: z.string().refine((v) => !Number.isNaN(Date.parse(v)), { message: "validation.date" }),
  duration: z.coerce.number().int().min(5).max(720),
  contactId: z.string().optional().transform((v) => (v ? v : undefined)).pipe(z.uuid().optional()),
  hostId: z.string().optional().transform((v) => (v ? v : undefined)).pipe(z.uuid().optional()),
  location: z.string().trim().max(300).optional(),
  notes: z.string().trim().max(4000).optional(),
});

export async function createAppointmentAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const locale = formLocale(fd);
  const ctx = await getOrgContext(locale);
  const values = { title: str(fd, "title"), duration: str(fd, "duration"), location: str(fd, "location"), notes: str(fd, "notes") };
  if (!ctx.can("appointments.manage")) return { error: "errors.forbidden", values };
  const parsed = manualSchema.safeParse({ ...values, start: str(fd, "start"), contactId: str(fd, "contactId"), hostId: str(fd, "hostId") });
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error), values };
  const p = parsed.data;
  const starts = new Date(p.start);
  const ends = new Date(starts.getTime() + p.duration * 60_000);
  const supabase = await createClient();
  const { error } = await supabase.from("appointments").insert({
    organization_id: ctx.org.id,
    title: p.title,
    starts_at: starts.toISOString(),
    ends_at: ends.toISOString(),
    contact_id: p.contactId ?? null,
    host_id: p.hostId ?? ctx.userId,
    location: p.location || null,
    notes: p.notes || null,
    status: "confirmed",
    created_by: ctx.userId,
  });
  if (error) {
    if (error.message.includes("appointments_no_overlap")) return { error: "booking.taken", values };
    return { error: dbErrorKey(error), values };
  }
  kickJobs();
  revalidatePath(`/${locale}/appointments`);
  return { ok: true, message: "appointments.created" };
}

export async function setAppointmentStatusAction(fd: FormData): Promise<ActionState> {
  const locale = formLocale(fd);
  const ctx = await getOrgContext(locale);
  if (!ctx.can("appointments.manage")) return { error: "errors.forbidden" };
  const id = uuidSchema.safeParse(str(fd, "id"));
  const status = str(fd, "status");
  if (!id.success || !["scheduled", "confirmed", "canceled", "completed", "no_show"].includes(status)) return { error: "validation.invalidId" };
  const supabase = await createClient();
  const { error } = await supabase.from("appointments").update({ status }).eq("id", id.data).eq("organization_id", ctx.org.id);
  if (error) return { error: error.message.includes("appointments_no_overlap") ? "booking.taken" : dbErrorKey(error) };
  revalidatePath(`/${locale}/appointments`);
  return { ok: true, message: `appointments.status_${status}` };
}
