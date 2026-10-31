"use server";

import { revalidatePath } from "next/cache";
import { uuidSchema } from "@scc/shared/validators";
import { getOrgContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { dbErrorKey, type ActionState } from "@/lib/action-state";
import type { AgentProfile } from "@/lib/ai/autopilot-core";

/**
 * Wave 59 — the smarter-agent actions: set up from the website, learn from the owner's answers, A/B test the
 * opening line, and the weekly AI coach on demand. All scoped to the signed-in business (RLS + permissions).
 */
const loc = (l: unknown) => (l === "ar" || l === "en" ? l : "he") as "he" | "ar" | "en";

async function agentProfile(orgId: string, agentId: string): Promise<{ profile: AgentProfile } | null> {
  const supabase = await createClient();
  const { data } = await supabase.from("ai_agents").select("profile").eq("id", agentId).eq("organization_id", orgId).maybeSingle();
  return data ? { profile: ((data.profile as AgentProfile | null) ?? {}) as AgentProfile } : null;
}

/* ---------------------------------------------------------------- set up from the website */
export async function importSiteAction(input: { locale: string; agentId: string; url: string }): Promise<ActionState<{ profile: Partial<AgentProfile>; pages: number }>> {
  const locale = loc(input.locale);
  const ctx = await getOrgContext(locale);
  if (!ctx.can("ai.manage")) return { error: "errors.forbidden" };
  const id = uuidSchema.safeParse(input.agentId);
  if (!id.success) return { error: "validation.invalidId" };
  if (ctx.org.is_demo) return { error: "ai.demoBlocked" };
  if (!(await agentProfile(ctx.org.id, id.data))) return { error: "errors.notFound" };
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const { data: allowed } = await createAdminClient().rpc("public_rate_limit", { p_bucket: `site-import:${ctx.org.id}`, p_limit: 6, p_window_seconds: 3600 });
  if (allowed === false) return { error: "errors.rateLimited" };
  const { importFromSite } = await import("@/lib/ai/site-import");
  const r = await importFromSite({ orgId: ctx.org.id, agentId: id.data, url: String(input.url ?? ""), locale });
  if (!r.ok) return { error: r.error };
  return { ok: true, data: { profile: r.profile, pages: r.pages } };
}

export async function applySiteImportAction(input: { locale: string; agentId: string; url: string; profile: unknown }): Promise<ActionState<{ filled: string[] }>> {
  const locale = loc(input.locale);
  const ctx = await getOrgContext(locale);
  if (!ctx.can("ai.manage")) return { error: "errors.forbidden" };
  const id = uuidSchema.safeParse(input.agentId);
  if (!id.success) return { error: "validation.invalidId" };
  const cur = await agentProfile(ctx.org.id, id.data);
  if (!cur) return { error: "errors.notFound" };
  const { normalizeImport, mergeImported } = await import("@/lib/ai/site-import-core");
  const { normalizeSiteUrl } = await import("@/lib/ai/site-import");
  const { profile, filled } = mergeImported(cur.profile, normalizeImport(input.profile), normalizeSiteUrl(String(input.url ?? "")) ?? "");
  if (!filled.length) return { ok: true, message: "siteImport.nothingNew", data: { filled } };
  const supabase = await createClient();
  const { error } = await supabase.from("ai_agents").update({ profile }).eq("id", id.data).eq("organization_id", ctx.org.id);
  if (error) return { error: dbErrorKey(error) };
  revalidatePath(`/${locale}/ai-agents/${id.data}/setup`);
  return { ok: true, message: "siteImport.applied", data: { filled } };
}

/* ---------------------------------------------------------------- learn from the owner */
export async function decideLearningAction(input: { locale: string; id: string; approve: boolean; answer?: string; question?: string }): Promise<ActionState> {
  const locale = loc(input.locale);
  const ctx = await getOrgContext(locale);
  if (!ctx.can("ai.manage")) return { error: "errors.forbidden" };
  const id = uuidSchema.safeParse(input.id);
  if (!id.success) return { error: "validation.invalidId" };
  const supabase = await createClient();
  const { data: row } = await supabase.from("ai_learning_suggestions").select("id, question, answer, status, conversation_id").eq("id", id.data).eq("organization_id", ctx.org.id).maybeSingle();
  if (!row || row.status !== "pending") return { error: "errors.notFound" };
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const admin = createAdminClient();
  if (input.approve) {
    const { cleanLearned, faqAppend } = await import("@/lib/ai/learn-core");
    const item = cleanLearned({ question: input.question ?? (row.question as string), answer: input.answer ?? (row.answer as string) });
    if (!item) return { error: "learn.invalid" };
    // the agent that answers this conversation's channel (or the business's first agent)
    const { data: conv } = row.conversation_id ? await supabase.from("conversations").select("channel").eq("id", row.conversation_id as string).maybeSingle() : { data: null };
    const { data: agents } = await supabase.from("ai_agents").select("id, profile, autopilot_channels").eq("organization_id", ctx.org.id).eq("enabled", true).order("created_at").limit(10);
    const list = (agents ?? []) as { id: string; profile: AgentProfile | null; autopilot_channels: string[] | null }[];
    const agent = list.find((a) => conv?.channel && (a.autopilot_channels ?? []).includes(conv.channel as string)) ?? list[0];
    if (!agent) return { error: "learn.noAgent" };
    const profile = { ...(agent.profile ?? {}), faq: faqAppend(agent.profile?.faq, item.question, item.answer) };
    const { error } = await supabase.from("ai_agents").update({ profile }).eq("id", agent.id).eq("organization_id", ctx.org.id);
    if (error) return { error: dbErrorKey(error) };
  }
  await admin.from("ai_learning_suggestions").update({ status: input.approve ? "approved" : "dismissed", decided_at: new Date().toISOString(), decided_by: ctx.userId }).eq("id", id.data).eq("organization_id", ctx.org.id);
  revalidatePath(`/${locale}/ai-agents`);
  return { ok: true, message: input.approve ? "learn.approved" : "learn.dismissed" };
}

/* ---------------------------------------------------------------- A/B opening line */
export async function saveOpenersAction(input: { locale: string; agentId: string; openers: string[] }): Promise<ActionState> {
  const locale = loc(input.locale);
  const ctx = await getOrgContext(locale);
  if (!ctx.can("ai.manage")) return { error: "errors.forbidden" };
  const id = uuidSchema.safeParse(input.agentId);
  if (!id.success) return { error: "validation.invalidId" };
  const cur = await agentProfile(ctx.org.id, id.data);
  if (!cur) return { error: "errors.notFound" };
  const { openersOf } = await import("@/lib/ai/opener-ab-core");
  const openers = openersOf({ openers: Array.isArray(input.openers) ? input.openers : [] });
  const supabase = await createClient();
  const { error } = await supabase
    .from("ai_agents")
    .update({ profile: { ...cur.profile, openers } })
    .eq("id", id.data)
    .eq("organization_id", ctx.org.id);
  if (error) return { error: dbErrorKey(error) };
  revalidatePath(`/${locale}/ai-agents/${id.data}/setup`);
  return { ok: true, message: "abOpener.saved" };
}

/* ---------------------------------------------------------------- weekly AI coach (on demand) */
export async function coachNowAction(input: { locale: string }): Promise<ActionState> {
  const locale = loc(input.locale);
  const ctx = await getOrgContext(locale);
  if (!ctx.can("ai.manage")) return { error: "errors.forbidden" };
  if (ctx.org.is_demo) return { error: "ai.demoBlocked" };
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const { data: allowed } = await createAdminClient().rpc("public_rate_limit", { p_bucket: `coach:${ctx.org.id}`, p_limit: 3, p_window_seconds: 86_400 });
  if (allowed === false) return { error: "errors.rateLimited" };
  const { generateCoachReport } = await import("@/lib/ai/coach");
  const r = await generateCoachReport(ctx.org.id);
  if (!r.ok) return { error: r.error ?? "errors.generic" };
  revalidatePath(`/${locale}/ai-agents`);
  return { ok: true, message: "coach.ready" };
}
