"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { dealSchema, fieldErrors, pipelineSchema, stageSchema, uuidSchema } from "@scc/shared/validators";
import { getOrgContext } from "@/lib/auth";
import { kickJobs } from "@/lib/jobs/kick";
import { createClient } from "@/lib/supabase/server";
import { dbErrorKey, type ActionState } from "@/lib/action-state";
import { formLocale, pick, str } from "@/lib/form";

const DEAL_FIELDS = ["title", "value", "currency", "pipelineId", "stageId", "contactId", "companyId", "expectedCloseDate", "ownerId"];

function revalidateDeals(locale: string) {
  revalidatePath(`/${locale}/pipelines`);
  revalidatePath(`/${locale}/overview`);
  revalidatePath(`/${locale}/analytics`);
}

function dealRow(d: z.infer<typeof dealSchema>) {
  return {
    title: d.title,
    value: d.value,
    currency: d.currency,
    pipeline_id: d.pipelineId,
    stage_id: d.stageId,
    contact_id: d.contactId ?? null,
    company_id: d.companyId ?? null,
    expected_close_date: d.expectedCloseDate ?? null,
    owner_id: d.ownerId ?? null,
  };
}

function dealError(error: { code?: string; message?: string }) {
  if (error.message?.includes("stage_not_in_pipeline")) return "deals.stageMismatch";
  return dbErrorKey(error);
}

export async function createDealAction(_prev: ActionState<{ id: string }>, fd: FormData): Promise<ActionState<{ id: string }>> {
  const locale = formLocale(fd);
  const ctx = await getOrgContext(locale);
  const values = pick(fd, DEAL_FIELDS);
  if (!ctx.can("deals.write")) return { error: "errors.forbidden", values };
  const parsed = dealSchema.safeParse({ ...values, ownerId: values.ownerId || ctx.userId });
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error), values };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("deals")
    .insert({ ...dealRow(parsed.data), organization_id: ctx.org.id, created_by: ctx.userId })
    .select("id")
    .single();
  if (error) return { error: dealError(error), values };
  revalidateDeals(locale);
  if (parsed.data.contactId) revalidatePath(`/${locale}/crm/${parsed.data.contactId}`);
  kickJobs();
  return { ok: true, message: "deals.created", data: { id: data.id } };
}

export async function updateDealAction(_prev: ActionState<{ id: string }>, fd: FormData): Promise<ActionState<{ id: string }>> {
  const locale = formLocale(fd);
  const ctx = await getOrgContext(locale);
  const values = pick(fd, DEAL_FIELDS);
  const id = uuidSchema.safeParse(str(fd, "id"));
  if (!id.success) return { error: "validation.invalidId", values };
  if (!ctx.can("deals.write")) return { error: "errors.forbidden", values };
  const parsed = dealSchema.safeParse(values);
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error), values };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("deals")
    .update(dealRow(parsed.data))
    .eq("id", id.data)
    .eq("organization_id", ctx.org.id)
    .select("id");
  if (error) return { error: dealError(error), values };
  if (!data?.length) return { error: "errors.notFound", values };
  revalidateDeals(locale);
  kickJobs();
  return { ok: true, message: "deals.updated", data: { id: id.data } };
}

/** Kanban drag & drop / "move to" menu. */
export async function moveDealAction(input: { locale: string; id: string; stageId: string; position?: number }): Promise<ActionState> {
  const locale = input.locale === "ar" || input.locale === "en" ? input.locale : "he";
  const ctx = await getOrgContext(locale);
  if (!ctx.can("deals.write")) return { error: "errors.forbidden" };
  const id = uuidSchema.safeParse(input.id);
  const stage = uuidSchema.safeParse(input.stageId);
  if (!id.success || !stage.success) return { error: "validation.invalidId" };
  const supabase = await createClient();
  const patch: Record<string, unknown> = { stage_id: stage.data };
  if (typeof input.position === "number" && Number.isFinite(input.position)) patch.position = input.position;
  const { data, error } = await supabase.from("deals").update(patch).eq("id", id.data).eq("organization_id", ctx.org.id).select("id");
  if (error) return { error: dealError(error) };
  if (!data?.length) return { error: "errors.notFound" };
  revalidateDeals(locale);
  kickJobs();
  return { ok: true, message: "deals.moved" };
}

const statusSchema = z.object({ id: uuidSchema, status: z.enum(["open", "won", "lost"]), lostReason: z.string().trim().max(500).optional() });

export async function setDealStatusAction(fd: FormData): Promise<ActionState> {
  const locale = formLocale(fd);
  const ctx = await getOrgContext(locale);
  if (!ctx.can("deals.write")) return { error: "errors.forbidden" };
  const parsed = statusSchema.safeParse({ id: str(fd, "id"), status: str(fd, "status"), lostReason: str(fd, "lostReason") || undefined });
  if (!parsed.success) return { error: "validation.invalidId" };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("deals")
    .update({ status: parsed.data.status, lost_reason: parsed.data.status === "lost" ? (parsed.data.lostReason ?? null) : null })
    .eq("id", parsed.data.id)
    .eq("organization_id", ctx.org.id)
    .select("id");
  if (error) return { error: dbErrorKey(error) };
  if (!data?.length) return { error: "errors.notFound" };
  revalidateDeals(locale);
  kickJobs();
  return { ok: true, message: `deals.status_${parsed.data.status}` };
}

export async function deleteDealAction(fd: FormData): Promise<ActionState> {
  const locale = formLocale(fd);
  const ctx = await getOrgContext(locale);
  if (!ctx.can("deals.delete")) return { error: "errors.forbidden" };
  const id = uuidSchema.safeParse(str(fd, "id"));
  if (!id.success) return { error: "validation.invalidId" };
  const supabase = await createClient();
  const { error } = await supabase.from("deals").delete().eq("id", id.data).eq("organization_id", ctx.org.id);
  if (error) return { error: dbErrorKey(error) };
  revalidateDeals(locale);
  kickJobs();
  return { ok: true, message: "deals.deleted" };
}

/* ------------------------------------------------ pipelines & stages ---- */

export async function createPipelineAction(_prev: ActionState<{ id: string }>, fd: FormData): Promise<ActionState<{ id: string }>> {
  const locale = formLocale(fd);
  const ctx = await getOrgContext(locale);
  const values = pick(fd, ["name"]);
  if (!ctx.can("settings.manage")) return { error: "errors.forbidden", values };
  const parsed = pipelineSchema.safeParse(values);
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error), values };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("pipelines")
    .insert({ organization_id: ctx.org.id, name: parsed.data.name, is_default: false })
    .select("id")
    .single();
  if (error) return { error: dbErrorKey(error), values };
  const defaults = [
    { name: "New", probability: 10 },
    { name: "Qualified", probability: 30 },
    { name: "Proposal", probability: 60 },
    { name: "Negotiation", probability: 80 },
  ];
  await supabase
    .from("pipeline_stages")
    .insert(defaults.map((s, i) => ({ organization_id: ctx.org.id, pipeline_id: data.id, name: s.name, probability: s.probability, position: i })));
  revalidatePath(`/${locale}/pipelines`);
  kickJobs();
  return { ok: true, message: "deals.pipelineCreated", data: { id: data.id } };
}

export async function renamePipelineAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const locale = formLocale(fd);
  const ctx = await getOrgContext(locale);
  const values = pick(fd, ["name"]);
  if (!ctx.can("settings.manage")) return { error: "errors.forbidden", values };
  const id = uuidSchema.safeParse(str(fd, "id"));
  const parsed = pipelineSchema.safeParse(values);
  if (!id.success) return { error: "validation.invalidId", values };
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error), values };
  const supabase = await createClient();
  const { error } = await supabase.from("pipelines").update({ name: parsed.data.name, updated_at: new Date().toISOString() }).eq("id", id.data).eq("organization_id", ctx.org.id);
  if (error) return { error: dbErrorKey(error), values };
  revalidatePath(`/${locale}/pipelines`);
  kickJobs();
  return { ok: true, message: "common.saved" };
}

export async function deletePipelineAction(fd: FormData): Promise<ActionState> {
  const locale = formLocale(fd);
  const ctx = await getOrgContext(locale);
  if (!ctx.can("settings.manage")) return { error: "errors.forbidden" };
  const id = uuidSchema.safeParse(str(fd, "id"));
  if (!id.success) return { error: "validation.invalidId" };
  const supabase = await createClient();
  const { data: p } = await supabase.from("pipelines").select("is_default").eq("id", id.data).eq("organization_id", ctx.org.id).maybeSingle();
  if (!p) return { error: "errors.notFound" };
  if (p.is_default) return { error: "deals.cannotDeleteDefault" };
  const { error } = await supabase.from("pipelines").delete().eq("id", id.data).eq("organization_id", ctx.org.id);
  if (error) return { error: dbErrorKey(error) };
  revalidatePath(`/${locale}/pipelines`);
  kickJobs();
  return { ok: true, message: "deals.pipelineDeleted" };
}

export async function addStageAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const locale = formLocale(fd);
  const ctx = await getOrgContext(locale);
  const values = pick(fd, ["name", "probability"]);
  if (!ctx.can("settings.manage")) return { error: "errors.forbidden", values };
  const pipelineId = uuidSchema.safeParse(str(fd, "pipelineId"));
  const parsed = stageSchema.safeParse(values);
  if (!pipelineId.success) return { error: "validation.invalidId", values };
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error), values };
  const supabase = await createClient();
  const { data: last } = await supabase
    .from("pipeline_stages")
    .select("position")
    .eq("organization_id", ctx.org.id)
    .eq("pipeline_id", pipelineId.data)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();
  const { error } = await supabase.from("pipeline_stages").insert({
    organization_id: ctx.org.id,
    pipeline_id: pipelineId.data,
    name: parsed.data.name,
    probability: parsed.data.probability,
    position: (last?.position ?? -1) + 1,
  });
  if (error) return { error: dbErrorKey(error), values };
  revalidatePath(`/${locale}/pipelines`);
  kickJobs();
  return { ok: true, message: "deals.stageAdded" };
}

export async function updateStageAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const locale = formLocale(fd);
  const ctx = await getOrgContext(locale);
  const values = pick(fd, ["name", "probability"]);
  if (!ctx.can("settings.manage")) return { error: "errors.forbidden", values };
  const id = uuidSchema.safeParse(str(fd, "id"));
  const parsed = stageSchema.safeParse(values);
  if (!id.success) return { error: "validation.invalidId", values };
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error), values };
  const supabase = await createClient();
  const { error } = await supabase
    .from("pipeline_stages")
    .update({ name: parsed.data.name, probability: parsed.data.probability })
    .eq("id", id.data)
    .eq("organization_id", ctx.org.id);
  if (error) return { error: dbErrorKey(error), values };
  revalidatePath(`/${locale}/pipelines`);
  kickJobs();
  return { ok: true, message: "common.saved" };
}

/** Wave 15 — stage automation: events that move deals into this stage by themselves. */
export async function updateStageAutomationAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const locale = formLocale(fd);
  const ctx = await getOrgContext(locale);
  if (!ctx.can("settings.manage")) return { error: "errors.forbidden" };
  const id = uuidSchema.safeParse(str(fd, "id"));
  if (!id.success) return { error: "validation.invalidId" };
  const { isStageEvent } = await import("@/lib/crm/stage-events");
  const events = fd.getAll("auto_on").map(String).filter(isStageEvent);
  const supabase = await createClient();
  const { error } = await supabase
    .from("pipeline_stages")
    .update({ auto_on: [...new Set(events)], marks_won: fd.get("marks_won") === "on" })
    .eq("id", id.data)
    .eq("organization_id", ctx.org.id);
  if (error) return { error: dbErrorKey(error) };
  revalidatePath(`/${locale}/pipelines`);
  return { ok: true, message: "stageAuto.saved" };
}

/** Swap a stage with its neighbour (direction -1 = earlier, +1 = later). */
export async function moveStageAction(fd: FormData): Promise<ActionState> {
  const locale = formLocale(fd);
  const ctx = await getOrgContext(locale);
  if (!ctx.can("settings.manage")) return { error: "errors.forbidden" };
  const id = uuidSchema.safeParse(str(fd, "id"));
  const dir = str(fd, "direction") === "-1" ? -1 : 1;
  if (!id.success) return { error: "validation.invalidId" };
  const supabase = await createClient();
  const { data: stage } = await supabase.from("pipeline_stages").select("id, pipeline_id, position").eq("id", id.data).eq("organization_id", ctx.org.id).maybeSingle();
  if (!stage) return { error: "errors.notFound" };
  const { data: all } = await supabase
    .from("pipeline_stages")
    .select("id, position")
    .eq("organization_id", ctx.org.id)
    .eq("pipeline_id", stage.pipeline_id)
    .order("position", { ascending: true });
  const list = all ?? [];
  const i = list.findIndex((s) => s.id === stage.id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= list.length) return { ok: true };
  const reordered = [...list];
  [reordered[i], reordered[j]] = [reordered[j]!, reordered[i]!];
  for (const [pos, s] of reordered.entries()) {
    if (s.position !== pos) await supabase.from("pipeline_stages").update({ position: pos }).eq("id", s.id).eq("organization_id", ctx.org.id);
  }
  revalidatePath(`/${locale}/pipelines`);
  kickJobs();
  return { ok: true };
}

export async function deleteStageAction(fd: FormData): Promise<ActionState> {
  const locale = formLocale(fd);
  const ctx = await getOrgContext(locale);
  if (!ctx.can("settings.manage")) return { error: "errors.forbidden" };
  const id = uuidSchema.safeParse(str(fd, "id"));
  if (!id.success) return { error: "validation.invalidId" };
  const supabase = await createClient();
  const { count } = await supabase.from("deals").select("id", { count: "exact", head: true }).eq("organization_id", ctx.org.id).eq("stage_id", id.data);
  if ((count ?? 0) > 0) return { error: "deals.stageHasDeals" };
  const { data: st } = await supabase.from("pipeline_stages").select("pipeline_id").eq("id", id.data).eq("organization_id", ctx.org.id).maybeSingle();
  if (!st) return { error: "errors.notFound" };
  const { count: stages } = await supabase.from("pipeline_stages").select("id", { count: "exact", head: true }).eq("organization_id", ctx.org.id).eq("pipeline_id", st.pipeline_id);
  if ((stages ?? 0) <= 1) return { error: "deals.lastStage" };
  const { error } = await supabase.from("pipeline_stages").delete().eq("id", id.data).eq("organization_id", ctx.org.id);
  if (error) return { error: dbErrorKey(error) };
  revalidatePath(`/${locale}/pipelines`);
  kickJobs();
  return { ok: true, message: "deals.stageDeleted" };
}
