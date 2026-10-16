"use server";

import { revalidatePath } from "next/cache";
import { fieldErrors, taskSchema, TASK_STATUSES, uuidSchema } from "@scc/shared/validators";
import { getOrgContext } from "@/lib/auth";
import { kickJobs } from "@/lib/jobs/kick";
import { createClient } from "@/lib/supabase/server";
import { dbErrorKey, type ActionState } from "@/lib/action-state";
import { formLocale, pick, str } from "@/lib/form";

const FIELDS = ["title", "description", "status", "dueAt", "assigneeId", "contactId", "dealId"];

function revalidateTasks(locale: string, contactId?: string) {
  revalidatePath(`/${locale}/tasks`);
  revalidatePath(`/${locale}/overview`);
  if (contactId) revalidatePath(`/${locale}/crm/${contactId}`);
}

function toRow(t: ReturnType<typeof taskSchema.parse>) {
  return {
    title: t.title,
    description: t.description || null,
    status: t.status,
    due_at: t.dueAt ? new Date(t.dueAt).toISOString() : null,
    assignee_id: t.assigneeId ?? null,
    contact_id: t.contactId ?? null,
    deal_id: t.dealId ?? null,
  };
}

export async function createTaskAction(_prev: ActionState<{ id: string }>, fd: FormData): Promise<ActionState<{ id: string }>> {
  const locale = formLocale(fd);
  const ctx = await getOrgContext(locale);
  const values = pick(fd, FIELDS);
  if (!ctx.can("tasks.write")) return { error: "errors.forbidden", values };
  const parsed = taskSchema.safeParse({ ...values, assigneeId: values.assigneeId || ctx.userId, status: values.status || "open" });
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error), values };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("tasks")
    .insert({ ...toRow(parsed.data), organization_id: ctx.org.id, created_by: ctx.userId })
    .select("id")
    .single();
  if (error) return { error: dbErrorKey(error), values };
  revalidateTasks(locale, parsed.data.contactId);
  kickJobs();
  return { ok: true, message: "tasks.created", data: { id: data.id } };
}

export async function updateTaskAction(_prev: ActionState<{ id: string }>, fd: FormData): Promise<ActionState<{ id: string }>> {
  const locale = formLocale(fd);
  const ctx = await getOrgContext(locale);
  const values = pick(fd, FIELDS);
  const id = uuidSchema.safeParse(str(fd, "id"));
  if (!id.success) return { error: "validation.invalidId", values };
  if (!ctx.can("tasks.write")) return { error: "errors.forbidden", values };
  const parsed = taskSchema.safeParse(values);
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error), values };
  const supabase = await createClient();
  const { data, error } = await supabase.from("tasks").update(toRow(parsed.data)).eq("id", id.data).eq("organization_id", ctx.org.id).select("id");
  if (error) return { error: dbErrorKey(error), values };
  if (!data?.length) return { error: "errors.notFound", values };
  revalidateTasks(locale, parsed.data.contactId);
  kickJobs();
  return { ok: true, message: "tasks.updated", data: { id: id.data } };
}

/** One-click status change from the list (checkbox / menu). */
export async function setTaskStatusAction(fd: FormData): Promise<ActionState> {
  const locale = formLocale(fd);
  const ctx = await getOrgContext(locale);
  if (!ctx.can("tasks.write")) return { error: "errors.forbidden" };
  const id = uuidSchema.safeParse(str(fd, "id"));
  const status = str(fd, "status");
  if (!id.success || !(TASK_STATUSES as readonly string[]).includes(status)) return { error: "validation.invalidId" };
  const supabase = await createClient();
  const { data, error } = await supabase.from("tasks").update({ status }).eq("id", id.data).eq("organization_id", ctx.org.id).select("id, contact_id");
  if (error) return { error: dbErrorKey(error) };
  if (!data?.length) return { error: "errors.notFound" };
  revalidateTasks(locale, data[0]!.contact_id ?? undefined);
  kickJobs();
  return { ok: true, message: status === "done" ? "tasks.completed" : "tasks.updated" };
}

export async function deleteTaskAction(fd: FormData): Promise<ActionState> {
  const locale = formLocale(fd);
  const ctx = await getOrgContext(locale);
  if (!ctx.can("tasks.write")) return { error: "errors.forbidden" };
  const id = uuidSchema.safeParse(str(fd, "id"));
  if (!id.success) return { error: "validation.invalidId" };
  const supabase = await createClient();
  const { error } = await supabase.from("tasks").delete().eq("id", id.data).eq("organization_id", ctx.org.id);
  if (error) return { error: dbErrorKey(error) };
  revalidateTasks(locale);
  kickJobs();
  return { ok: true, message: "tasks.deleted" };
}
