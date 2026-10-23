"use server";

import { revalidatePath } from "next/cache";
import { campaignSchema } from "@scc/shared/engagement";
import { fieldErrors, uuidSchema } from "@scc/shared/validators";
import { getOrgContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { dbErrorKey, type ActionState } from "@/lib/action-state";
import { kickJobs } from "@/lib/jobs/kick";
import { formLocale, str } from "@/lib/form";

const loc = (l: string) => (l === "ar" || l === "en" ? l : "he");

export async function saveCampaignAction(input: { locale: string; id?: string; data: unknown }): Promise<ActionState<{ id: string }>> {
  const locale = loc(input.locale);
  const ctx = await getOrgContext(locale);
  if (!ctx.can("campaigns.manage")) return { error: "errors.forbidden" };
  const parsed = campaignSchema.safeParse(input.data);
  if (!parsed.success) return { error: "campaigns.invalid", fieldErrors: fieldErrors(parsed.error) };
  const c = parsed.data;
  const row = {
    name: c.name,
    channel: c.channel,
    subject: c.subject || null,
    body: c.body,
    audience: c.audience,
    scheduled_at: c.scheduled_at ? new Date(c.scheduled_at).toISOString() : null,
    // wave 17
    ...(c.wa_template !== undefined ? { wa_template: c.channel === "whatsapp" ? c.wa_template : null } : {}),
  };
  const supabase = await createClient();
  if (input.id) {
    const id = uuidSchema.safeParse(input.id);
    if (!id.success) return { error: "validation.invalidId" };
    const { data, error } = await supabase.from("campaigns").update(row).eq("id", id.data).eq("organization_id", ctx.org.id).eq("status", "draft").select("id");
    if (error) return { error: dbErrorKey(error) };
    if (!data?.length) return { error: "campaigns.notDraft" };
    revalidatePath(`/${locale}/campaigns/${id.data}`);
    return { ok: true, message: "campaigns.saved", data: { id: id.data } };
  }
  const { data, error } = await supabase.from("campaigns").insert({ ...row, organization_id: ctx.org.id, created_by: ctx.userId }).select("id").single();
  if (error) return { error: dbErrorKey(error) };
  revalidatePath(`/${locale}/campaigns`);
  return { ok: true, message: "campaigns.saved", data: { id: data.id } };
}

export async function previewAudienceAction(input: { locale: string; channel: string; audience: unknown }): Promise<ActionState<{ count: number }>> {
  const ctx = await getOrgContext(loc(input.locale));
  if (!ctx.can("campaigns.manage")) return { error: "errors.forbidden" };
  const parsed = campaignSchema.safeParse({ name: "x", channel: input.channel, subject: "x", body: "x", audience: input.audience });
  if (!parsed.success) return { error: "campaigns.invalid" };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("preview_campaign_audience", { p_org: ctx.org.id, p_channel: parsed.data.channel, p_audience: parsed.data.audience });
  if (error) return { error: dbErrorKey(error) };
  return { ok: true, data: { count: Number(data) } };
}

export async function launchCampaignAction(fd: FormData): Promise<ActionState> {
  const locale = formLocale(fd);
  const ctx = await getOrgContext(locale);
  if (!ctx.can("campaigns.manage")) return { error: "errors.forbidden" };
  const id = uuidSchema.safeParse(str(fd, "id"));
  if (!id.success) return { error: "validation.invalidId" };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("launch_campaign", { p_org: ctx.org.id, p_campaign: id.data });
  if (error) {
    if (error.message.includes("demo_mode")) return { error: "campaigns.demoBlocked" };
    if (error.message.includes("campaign_already_launched")) return { error: "campaigns.alreadyLaunched" };
    return { error: dbErrorKey(error) };
  }
  kickJobs();
  revalidatePath(`/${locale}/campaigns`);
  revalidatePath(`/${locale}/campaigns/${id.data}`);
  return { ok: true, message: "campaigns.launched", messageParams: { count: (data as { recipients: number }).recipients } };
}

export async function cancelCampaignAction(fd: FormData): Promise<ActionState> {
  const locale = formLocale(fd);
  const ctx = await getOrgContext(locale);
  if (!ctx.can("campaigns.manage")) return { error: "errors.forbidden" };
  const id = uuidSchema.safeParse(str(fd, "id"));
  if (!id.success) return { error: "validation.invalidId" };
  const supabase = await createClient();
  const { error } = await supabase.from("campaigns").update({ status: "canceled" }).eq("id", id.data).eq("organization_id", ctx.org.id).in("status", ["draft", "scheduled", "sending"]);
  if (error) return { error: dbErrorKey(error) };
  kickJobs();
  revalidatePath(`/${locale}/campaigns`);
  revalidatePath(`/${locale}/campaigns/${id.data}`);
  return { ok: true, message: "campaigns.canceled" };
}

export async function deleteCampaignAction(fd: FormData): Promise<ActionState> {
  const locale = formLocale(fd);
  const ctx = await getOrgContext(locale);
  if (!ctx.can("campaigns.manage")) return { error: "errors.forbidden" };
  const id = uuidSchema.safeParse(str(fd, "id"));
  if (!id.success) return { error: "validation.invalidId" };
  const supabase = await createClient();
  const { error } = await supabase.from("campaigns").delete().eq("id", id.data).eq("organization_id", ctx.org.id).in("status", ["draft", "canceled", "sent"]);
  if (error) return { error: dbErrorKey(error) };
  revalidatePath(`/${locale}/campaigns`);
  return { ok: true, message: "campaigns.deleted" };
}

/**
 * Wave 17 — AI segmentation: "customers who bought over 1000 and were quiet for 2 months"
 * → audience filters (validated by the same schema, so the AI can never widen consent rules).
 */
export async function aiSegmentAction(input: { locale: string; text: string }): Promise<ActionState<{ audience: Record<string, unknown> }>> {
  const locale = loc(input.locale) as "he" | "en" | "ar";
  const ctx = await getOrgContext(locale);
  if (!ctx.can("campaigns.manage") || !ctx.can("ai.use")) return { error: "errors.forbidden" };
  const text = String(input.text ?? "").trim().slice(0, 600);
  if (text.length < 3) return { error: "validation.required" };
  const supabase = await createClient();
  const { data: allowed } = await supabase.rpc("check_rate_limit", { p_key: "ai_segment", p_limit: 40, p_window_seconds: 3600 });
  if (allowed !== true) return { error: "errors.rateLimited" };
  const [{ data: tags }, { buildSegmentPrompt, parseSegment }] = await Promise.all([supabase.from("tags").select("name").eq("organization_id", ctx.org.id).order("name").limit(200), import("@/lib/campaigns/segment-core")]);
  const { runAI } = await import("@/lib/ai/run");
  const { baseSystem } = await import("@/lib/ai/prompt");
  const out = await runAI({
    orgId: ctx.org.id,
    feature: "segment",
    system: baseSystem(locale, "You convert a marketer's description of an audience into JSON filters. Reply with JSON only."),
    messages: [{ role: "user", content: buildSegmentPrompt(text, ((tags ?? []) as { name: string }[]).map((x) => x.name)) }],
    temperature: 0,
    maxTokens: 300,
    json: true,
  });
  if (!out.ok) return { error: out.error };
  const audience = parseSegment(out.text, ((tags ?? []) as { name: string }[]).map((x) => x.name));
  if (!audience) return { error: "campaigns.segmentFailed" };
  return { ok: true, message: "campaigns.segmentReady", data: { audience } };
}
