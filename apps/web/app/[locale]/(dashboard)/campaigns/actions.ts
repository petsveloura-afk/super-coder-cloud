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

/**
 * Wave 26 — "duplicate campaign": a fresh DRAFT with the same channel, message, audience (and WhatsApp template).
 * Nothing is sent, nothing is scheduled; the original is untouched. Opens the copy for editing.
 */
export async function duplicateCampaignAction(fd: FormData): Promise<ActionState<{ id: string }>> {
  const locale = formLocale(fd);
  const ctx = await getOrgContext(locale);
  if (!ctx.can("campaigns.manage")) return { error: "errors.forbidden" };
  const id = uuidSchema.safeParse(str(fd, "id"));
  if (!id.success) return { error: "validation.invalidId" };
  const supabase = await createClient();
  const { data: src, error: e1 } = await supabase.from("campaigns").select("name, channel, subject, body, audience").eq("id", id.data).eq("organization_id", ctx.org.id).maybeSingle();
  if (e1) return { error: dbErrorKey(e1) };
  if (!src) return { error: "validation.invalidId" };
  const { copyName } = await import("@/lib/campaigns/metrics");
  const suffix = locale === "he" ? "(עותק)" : locale === "ar" ? "(نسخة)" : "(copy)";
  const row = { organization_id: ctx.org.id, created_by: ctx.userId, name: copyName(String(src.name), suffix), channel: src.channel, subject: src.subject, body: src.body, audience: src.audience, status: "draft" };
  const { data, error } = await supabase.from("campaigns").insert(row).select("id").single();
  if (error) return { error: dbErrorKey(error) };
  // wave 17 column — separate, best effort (works before that migration too)
  const { data: tpl } = await supabase.from("campaigns").select("wa_template").eq("id", id.data).maybeSingle();
  if (tpl && (tpl as { wa_template?: unknown }).wa_template) await supabase.from("campaigns").update({ wa_template: (tpl as { wa_template: unknown }).wa_template }).eq("id", data.id).eq("organization_id", ctx.org.id);
  revalidatePath(`/${locale}/campaigns`);
  return { ok: true, message: "campaigns.duplicated", data: { id: data.id as string } };
}

/* =====================================================================================================
 * Wave 39 — campaign AI studio (additive). Every action: permission (campaigns.manage + ai.use), a rate limit,
 * metered credits via runAI, strict parsing — and nothing is ever sent or launched by the AI.
 * ===================================================================================================== */
type AiLocale = "he" | "en" | "ar";
async function aiGate(localeIn: string, key: string, limit = 40) {
  const locale = loc(localeIn) as AiLocale;
  const ctx = await getOrgContext(locale);
  if (!ctx.can("campaigns.manage") || !ctx.can("ai.use")) return { error: "errors.forbidden" as const };
  const supabase = await createClient();
  const { data: allowed } = await supabase.rpc("check_rate_limit", { p_key: key, p_limit: limit, p_window_seconds: 3600 });
  if (allowed !== true) return { error: "errors.rateLimited" as const };
  return { locale, ctx, supabase };
}

/** Three message variants (different angles) from a goal + tone. */
export async function aiWriteCampaignAction(input: { locale: string; channel: string; goal: string; tone: string; offer?: string; audienceHint?: string }): Promise<ActionState<{ variants: { angle: string; subject: string; body: string }[] }>> {
  const g = await aiGate(input.locale, "ai_campaign_write");
  if ("error" in g) return { error: g.error };
  const { CAMPAIGN_CHANNELS } = await import("@scc/shared/engagement");
  if (!(CAMPAIGN_CHANNELS as readonly string[]).includes(input.channel)) return { error: "campaigns.invalid" };
  const { buildWriterPrompt, parseVariants, isGoal, isTone } = await import("@/lib/campaigns/ai-core");
  const channel = input.channel as "email" | "whatsapp" | "sms" | "telegram";
  const goal = isGoal(input.goal) ? input.goal : "promo";
  const tone = isTone(input.tone) ? input.tone : "friendly";
  const { runAI } = await import("@/lib/ai/run");
  const { baseSystem } = await import("@/lib/ai/prompt");
  const out = await runAI({
    orgId: g.ctx.org.id,
    feature: "copilot",
    system: baseSystem(g.locale, "You write high-converting, honest marketing copy for small businesses. Reply with JSON only."),
    messages: [{ role: "user", content: buildWriterPrompt({ channel, goal, tone, offer: String(input.offer ?? "").slice(0, 400), business: g.ctx.org.name, audienceHint: String(input.audienceHint ?? "").slice(0, 200) }) }],
    temperature: 0.8,
    maxTokens: 1100,
    json: true,
  });
  if (!out.ok) return { error: out.error };
  const variants = parseVariants(out.text, channel);
  if (!variants.length) return { error: "campaigns.ai.failed" };
  return { ok: true, message: "campaigns.ai.writerReady", data: { variants } };
}

/** One-click rewrite of the current message (shorter, friendlier, urgent, translate…). Keeps merge variables. */
export async function aiImproveMessageAction(input: { locale: string; mode: string; channel: string; subject?: string; body: string }): Promise<ActionState<{ subject: string; body: string }>> {
  const g = await aiGate(input.locale, "ai_campaign_improve", 60);
  if ("error" in g) return { error: g.error };
  const { CAMPAIGN_CHANNELS } = await import("@scc/shared/engagement");
  if (!(CAMPAIGN_CHANNELS as readonly string[]).includes(input.channel)) return { error: "campaigns.invalid" };
  const body = String(input.body ?? "").trim().slice(0, 4000);
  if (body.length < 3) return { error: "validation.required" };
  const { buildImprovePrompt, parseImproved, keepsVariables, isImproveMode } = await import("@/lib/campaigns/ai-core");
  if (!isImproveMode(input.mode)) return { error: "campaigns.invalid" };
  const channel = input.channel as "email" | "whatsapp" | "sms" | "telegram";
  const { runAI } = await import("@/lib/ai/run");
  const { baseSystem } = await import("@/lib/ai/prompt");
  const out = await runAI({
    orgId: g.ctx.org.id,
    feature: "copilot",
    system: baseSystem(g.locale, "You edit marketing messages. Reply with JSON only."),
    messages: [{ role: "user", content: buildImprovePrompt({ mode: input.mode, channel, subject: String(input.subject ?? "").slice(0, 200), body }) }],
    temperature: 0.4,
    maxTokens: 900,
    json: true,
  });
  if (!out.ok) return { error: out.error };
  const res = parseImproved(out.text, channel);
  if (!res) return { error: "campaigns.ai.failed" };
  if (input.mode !== "personalize" && !keepsVariables(body, res.body)) return { error: "campaigns.ai.lostVariables" };
  return { ok: true, message: "campaigns.ai.improved", data: res };
}

/** Five e-mail subject ideas for the current body. */
export async function aiSubjectIdeasAction(input: { locale: string; body: string; tone: string }): Promise<ActionState<{ subjects: string[] }>> {
  const g = await aiGate(input.locale, "ai_campaign_subjects", 60);
  if ("error" in g) return { error: g.error };
  const body = String(input.body ?? "").trim().slice(0, 2500);
  if (body.length < 10) return { error: "validation.required" };
  const { buildSubjectPrompt, parseSubjects, isTone } = await import("@/lib/campaigns/ai-core");
  const { runAI } = await import("@/lib/ai/run");
  const { baseSystem } = await import("@/lib/ai/prompt");
  const out = await runAI({
    orgId: g.ctx.org.id,
    feature: "copilot",
    system: baseSystem(g.locale, "You write e-mail subject lines. Reply with JSON only."),
    messages: [{ role: "user", content: buildSubjectPrompt({ body, tone: isTone(input.tone) ? input.tone : "friendly" }) }],
    temperature: 0.9,
    maxTokens: 400,
    json: true,
  });
  if (!out.ok) return { error: out.error };
  const subjects = parseSubjects(out.text);
  if (!subjects.length) return { error: "campaigns.ai.failed" };
  return { ok: true, message: "campaigns.ai.subjectsReady", data: { subjects } };
}

/**
 * Campaign agent: "get my quiet customers back with a 10% offer" → a COMPLETE DRAFT
 * (name, channel, message, audience, suggested send window). Saved as a draft only — the owner reviews and launches.
 */
export type AgentSendMode = "off" | "now" | "best";
export async function aiCampaignAgentAction(input: { locale: string; goal: string; autoSend?: AgentSendMode; tzOffsetMin?: number }): Promise<ActionState<{ id: string; rationale: string; sendHint: string | null; launched?: boolean; scheduledAt?: string | null; recipients?: number; blocked?: string }>> {
  const g = await aiGate(input.locale, "ai_campaign_agent", 20);
  if ("error" in g) return { error: g.error };
  const goal = String(input.goal ?? "").trim().slice(0, 700);
  if (goal.length < 8) return { error: "validation.required" };
  const [{ data: tags }, ready, mod, { runAI }, { baseSystem }] = await Promise.all([
    g.supabase.from("tags").select("name").eq("organization_id", g.ctx.org.id).order("name").limit(200),
    import("@/lib/campaign-channels").then((m) => m.channelsReady(g.ctx.org.id)),
    import("@/lib/campaigns/ai-core"),
    import("@/lib/ai/run"),
    import("@/lib/ai/prompt"),
  ]);
  const tagNames = ((tags ?? []) as { name: string }[]).map((x) => x.name);
  const connected = (["email", "whatsapp", "sms", "telegram"] as const).filter((c) => ready[c]);
  const out = await runAI({
    orgId: g.ctx.org.id,
    feature: "copilot",
    system: baseSystem(g.locale, "You plan marketing campaigns for small businesses. Reply with JSON only."),
    messages: [{ role: "user", content: mod.buildAgentPrompt({ goal, business: g.ctx.org.name, tags: tagNames, connected: [...connected] }) }],
    temperature: 0.6,
    maxTokens: 1000,
    json: true,
  });
  if (!out.ok) return { error: out.error };
  const plan = mod.parseAgentPlan(out.text, { tags: tagNames, allowed: connected.length ? [...connected] : undefined });
  if (!plan) return { error: "campaigns.ai.failed" };
  const { data, error } = await g.supabase
    .from("campaigns")
    .insert({ organization_id: g.ctx.org.id, created_by: g.ctx.userId, name: plan.name, channel: plan.channel, subject: plan.subject || null, body: plan.body, audience: plan.audience, status: "draft" })
    .select("id")
    .single();
  if (error) return { error: dbErrorKey(error) };
  const newId = data.id as string;
  revalidatePath(`/${g.locale}/campaigns`);
  const mode: AgentSendMode = input.autoSend === "now" || input.autoSend === "best" ? input.autoSend : "off";
  if (mode === "off") return { ok: true, message: "campaigns.ai.agentDone", data: { id: newId, rationale: plan.rationale, sendHint: plan.sendHint } };

  /* The owner approved sending in advance. Same gates a human launch has — any failed gate keeps the DRAFT and says why. */
  const blockedDraft = (blocked: string) => ({ ok: true as const, message: "campaigns.ai.agentBlocked", data: { id: newId, rationale: plan.rationale, sendHint: plan.sendHint, launched: false, blocked } });
  if (!ready[plan.channel]) return blockedDraft("channel");
  const { analyzeMessage, suggestSendInstants } = await import("@/lib/campaigns/brain");
  const quality = analyzeMessage({ channel: plan.channel, subject: plan.subject, body: plan.body, hasTemplate: false });
  if (quality.score < 50) return blockedDraft("quality");
  if (plan.channel === "whatsapp") return blockedDraft("template"); // official WhatsApp needs an approved template: never auto-sent without one
  const { data: cnt, error: cErr } = await g.supabase.rpc("preview_campaign_audience", { p_org: g.ctx.org.id, p_channel: plan.channel, p_audience: plan.audience });
  if (cErr) return { error: dbErrorKey(cErr) };
  const recipients = Number(cnt);
  if (!(recipients > 0)) return blockedDraft("audience");
  let scheduledAt: string | null = null;
  if (mode === "best") {
    const off = Number.isFinite(input.tzOffsetMin) ? Math.max(-840, Math.min(840, Number(input.tzOffsetMin))) : 0;
    const slots = suggestSendInstants(plan.channel, Date.now(), off, 3);
    const pick = slots.find((s) => s.reason === plan.sendHint) ?? slots[0];
    if (pick) scheduledAt = new Date(pick.atMs).toISOString();
    if (scheduledAt) {
      const { error: sErr } = await g.supabase.from("campaigns").update({ scheduled_at: scheduledAt }).eq("id", newId).eq("organization_id", g.ctx.org.id).eq("status", "draft");
      if (sErr) return { error: dbErrorKey(sErr) };
    }
  }
  const { data: launch, error: lErr } = await g.supabase.rpc("launch_campaign", { p_org: g.ctx.org.id, p_campaign: newId });
  if (lErr) {
    if (lErr.message.includes("demo_mode")) return blockedDraft("demo");
    return blockedDraft("launch");
  }
  kickJobs();
  revalidatePath(`/${g.locale}/campaigns/${newId}`);
  return { ok: true, message: scheduledAt ? "campaigns.ai.agentScheduled" : "campaigns.ai.agentLaunched", data: { id: newId, rationale: plan.rationale, sendHint: plan.sendHint, launched: true, scheduledAt, recipients: (launch as { recipients?: number } | null)?.recipients ?? recipients } };
}

/** Post-send coach: three concrete tips for the next campaign, from the real numbers and the real errors. */
export async function aiCampaignCoachAction(input: { locale: string; id: string }): Promise<ActionState<{ summary: string; tips: string[] }>> {
  const g = await aiGate(input.locale, "ai_campaign_coach", 30);
  if ("error" in g) return { error: g.error };
  const id = uuidSchema.safeParse(input.id);
  if (!id.success) return { error: "validation.invalidId" };
  const { data: c } = await g.supabase.from("campaigns").select("channel, status, subject, body, stats").eq("id", id.data).eq("organization_id", g.ctx.org.id).maybeSingle();
  if (!c) return { error: "validation.invalidId" };
  const { data: errs } = await g.supabase.from("campaign_recipients").select("error").eq("organization_id", g.ctx.org.id).eq("campaign_id", id.data).eq("status", "failed").not("error", "is", null).limit(200);
  const counts = new Map<string, number>();
  for (const r of (errs ?? []) as { error: string }[]) counts.set(r.error.slice(0, 120), (counts.get(r.error.slice(0, 120)) ?? 0) + 1);
  const topErrors = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([e, n]) => `${e} (x${n})`);
  const { campaignRates } = await import("@/lib/campaigns/metrics");
  const r = campaignRates(c.stats as never);
  const { buildCoachPrompt, parseCoach } = await import("@/lib/campaigns/ai-core");
  const { runAI } = await import("@/lib/ai/run");
  const { baseSystem } = await import("@/lib/ai/prompt");
  const out = await runAI({
    orgId: g.ctx.org.id,
    feature: "copilot",
    system: baseSystem(g.locale, "You analyse marketing campaign results. Reply with JSON only."),
    messages: [{ role: "user", content: buildCoachPrompt({ channel: c.channel as "email", status: c.status as string, recipients: r.recipients, sent: r.sent, failed: r.failed, subject: (c.subject as string | null) ?? "", body: c.body as string, topErrors }) }],
    temperature: 0.4,
    maxTokens: 500,
    json: true,
  });
  if (!out.ok) return { error: out.error };
  const res = parseCoach(out.text);
  if (!res) return { error: "campaigns.ai.failed" };
  return { ok: true, message: "campaigns.ai.coachReady", data: res };
}
