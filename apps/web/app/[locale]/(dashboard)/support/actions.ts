"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { TICKET_PRIORITIES, TICKET_STATUSES, ticketSchema } from "@scc/shared/engagement";
import { fieldErrors, uuidSchema } from "@scc/shared/validators";
import { getOrgContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { dbErrorKey, type ActionState } from "@/lib/action-state";
import { kickJobs } from "@/lib/jobs/kick";
import { formLocale, pick, str } from "@/lib/form";
import { publicEnv } from "@/lib/env";
import { emailConfigured } from "@/lib/email/send";

/** Queue an e-mail to the ticket's customer (retries via the job queue). */
async function emailCustomer(orgId: string, ticketId: string, locale: string, body: string) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY || !emailConfigured()) return;
  const admin = createAdminClient();
  const { data: t } = await admin.from("tickets").select("number, subject, public_token, contact_id, contacts(email)").eq("id", ticketId).eq("organization_id", orgId).maybeSingle();
  const email = (t?.contacts as unknown as { email: string | null } | null)?.email;
  if (!t || !email) return;
  const link = `${publicEnv.appUrl.replace(/\/$/, "")}/${locale}/t/${t.public_token}`;
  const footer = { he: "לצפייה בפנייה ולתשובה", ar: "لعرض التذكرة والرد", en: "View and reply" }[locale as "he" | "ar" | "en"] ?? "View and reply";
  await admin.from("jobs").insert({
    organization_id: orgId,
    kind: "email",
    payload: { to: email, subject: `[#${t.number}] ${t.subject}`, text: `${body}\n\n${footer}: ${link}` },
  });
  kickJobs();
}

export async function createTicketAction(_prev: ActionState<{ id: string }>, fd: FormData): Promise<ActionState<{ id: string }>> {
  const locale = formLocale(fd);
  const ctx = await getOrgContext(locale);
  const values = pick(fd, ["subject", "body", "priority", "contactId", "assigneeId"]);
  if (!ctx.can("tickets.write")) return { error: "errors.forbidden", values };
  const parsed = ticketSchema.safeParse(values);
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error), values };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("tickets")
    .insert({
      organization_id: ctx.org.id,
      subject: parsed.data.subject,
      priority: parsed.data.priority,
      contact_id: parsed.data.contactId ?? null,
      assignee_id: parsed.data.assigneeId ?? ctx.userId,
      channel: "manual",
      created_by: ctx.userId,
    })
    .select("id")
    .single();
  if (error) return { error: dbErrorKey(error), values };
  if (parsed.data.body) {
    await supabase.from("ticket_messages").insert({ organization_id: ctx.org.id, ticket_id: data.id, author_type: "agent", author_id: ctx.userId, body: parsed.data.body, internal: true });
  }
  kickJobs();
  revalidatePath(`/${locale}/support`);
  return { ok: true, message: "support.created", data: { id: data.id } };
}

const replySchema = z.object({ body: z.string().trim().min(1, { message: "validation.required" }).max(20000), internal: z.boolean() });

export async function replyTicketAction(input: { locale: string; ticketId: string; body: string; internal: boolean; status?: string }): Promise<ActionState> {
  const locale = input.locale === "ar" || input.locale === "en" ? input.locale : "he";
  const ctx = await getOrgContext(locale);
  if (!ctx.can("tickets.write")) return { error: "errors.forbidden" };
  const id = uuidSchema.safeParse(input.ticketId);
  const parsed = replySchema.safeParse({ body: input.body, internal: input.internal });
  if (!id.success) return { error: "validation.invalidId" };
  if (!parsed.success) return { error: "validation.required" };
  const supabase = await createClient();
  const { error } = await supabase.from("ticket_messages").insert({
    organization_id: ctx.org.id,
    ticket_id: id.data,
    author_type: "agent",
    author_id: ctx.userId,
    body: parsed.data.body,
    internal: parsed.data.internal,
  });
  if (error) return { error: dbErrorKey(error) };
  if (input.status && (TICKET_STATUSES as readonly string[]).includes(input.status)) {
    await supabase.from("tickets").update({ status: input.status }).eq("id", id.data).eq("organization_id", ctx.org.id);
  }
  await supabase.from("tickets").update({ assignee_id: ctx.userId }).eq("id", id.data).is("assignee_id", null);
  if (!parsed.data.internal) await emailCustomer(ctx.org.id, id.data, locale, parsed.data.body);
  revalidatePath(`/${locale}/support/${id.data}`);
  revalidatePath(`/${locale}/support`);
  return { ok: true, message: parsed.data.internal ? "support.noteAdded" : "support.replied" };
}

export async function updateTicketAction(input: { locale: string; ticketId: string; status?: string; priority?: string; assigneeId?: string | null }): Promise<ActionState> {
  const locale = input.locale === "ar" || input.locale === "en" ? input.locale : "he";
  const ctx = await getOrgContext(locale);
  if (!ctx.can("tickets.write")) return { error: "errors.forbidden" };
  const id = uuidSchema.safeParse(input.ticketId);
  if (!id.success) return { error: "validation.invalidId" };
  const patch: Record<string, unknown> = {};
  if (input.status && (TICKET_STATUSES as readonly string[]).includes(input.status)) patch.status = input.status;
  if (input.priority && (TICKET_PRIORITIES as readonly string[]).includes(input.priority)) patch.priority = input.priority;
  if (input.assigneeId !== undefined) {
    if (input.assigneeId && !uuidSchema.safeParse(input.assigneeId).success) return { error: "validation.invalidId" };
    patch.assignee_id = input.assigneeId || null;
  }
  const supabase = await createClient();
  const { error } = await supabase.from("tickets").update(patch).eq("id", id.data).eq("organization_id", ctx.org.id);
  if (error) return { error: dbErrorKey(error) };
  revalidatePath(`/${locale}/support/${id.data}`);
  revalidatePath(`/${locale}/support`);
  return { ok: true, message: "support.updated" };
}

export async function deleteTicketAction(fd: FormData): Promise<ActionState> {
  const locale = formLocale(fd);
  const ctx = await getOrgContext(locale);
  if (!ctx.can("tickets.write")) return { error: "errors.forbidden" };
  const id = uuidSchema.safeParse(str(fd, "id"));
  if (!id.success) return { error: "validation.invalidId" };
  const supabase = await createClient();
  const { error } = await supabase.from("tickets").delete().eq("id", id.data).eq("organization_id", ctx.org.id);
  if (error) return { error: dbErrorKey(error) };
  revalidatePath(`/${locale}/support`);
  return { ok: true, message: "support.deleted" };
}
