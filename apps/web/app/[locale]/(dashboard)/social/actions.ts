"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { uuidSchema } from "@scc/shared/validators";
import { getOrgContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { dbErrorKey, type ActionState } from "@/lib/action-state";
import { classifyPublishError, publishHintKey } from "@/lib/social/errors";

/** Wave 19 — comments board, scheduled posts, Google reviews, social settings. */
const loc = (l: string) => (l === "ar" || l === "en" ? l : "he");

async function pageAccount(orgId: string, platform: "facebook" | "instagram") {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const { data } = await createAdminClient().from("channel_accounts").select("id").eq("organization_id", orgId).eq("kind", platform === "instagram" ? "instagram" : "messenger").maybeSingle();
  if (!data) return null;
  const { loadAccountById } = await import("@/lib/social/accounts");
  return loadAccountById(data.id as string);
}

export async function replyCommentAction(input: { locale: string; id: string; text: string }): Promise<ActionState> {
  const locale = loc(input.locale);
  const ctx = await getOrgContext(locale);
  if (!ctx.can("inbox.reply")) return { error: "errors.forbidden" };
  if (!uuidSchema.safeParse(input.id).success) return { error: "validation.invalidId" };
  const text = input.text.trim();
  if (text.length < 1 || text.length > 2000) return { error: "validation.required" };
  const supabase = await createClient();
  const { data: c } = await supabase.from("social_comments").select("id, platform, comment_id").eq("id", input.id).eq("organization_id", ctx.org.id).maybeSingle();
  if (!c) return { error: "validation.invalidId" };
  const acc = await pageAccount(ctx.org.id, c.platform as "facebook" | "instagram");
  if (!acc?.secrets.page_token) return { error: "social.notConnected" };
  const { replyToComment } = await import("@/lib/channels/meta-pages");
  const r = await replyToComment(c.platform as "facebook" | "instagram", c.comment_id as string, acc.secrets.page_token, text);
  if (!r.ok) return { error: "social.replyFailed", messageParams: { detail: r.error ?? "" } };
  await supabase.from("social_comments").update({ status: "replied", reply_text: text, replied_by: ctx.userId, replied_at: new Date().toISOString() }).eq("id", c.id);
  revalidatePath(`/${locale}/social`);
  return { ok: true, message: "social.replied" };
}

export async function commentStatusAction(input: { locale: string; id: string; action: "hide" | "ignore" | "dm" }): Promise<ActionState> {
  const locale = loc(input.locale);
  const ctx = await getOrgContext(locale);
  if (!ctx.can("inbox.reply")) return { error: "errors.forbidden" };
  if (!uuidSchema.safeParse(input.id).success) return { error: "validation.invalidId" };
  const supabase = await createClient();
  const { data: c } = await supabase.from("social_comments").select("id, platform, comment_id").eq("id", input.id).eq("organization_id", ctx.org.id).maybeSingle();
  if (!c) return { error: "validation.invalidId" };
  if (input.action === "ignore") {
    await supabase.from("social_comments").update({ status: "ignored" }).eq("id", c.id);
  } else {
    const acc = await pageAccount(ctx.org.id, c.platform as "facebook" | "instagram");
    if (!acc?.secrets.page_token) return { error: "social.notConnected" };
    const meta = await import("@/lib/channels/meta-pages");
    if (input.action === "hide") {
      const r = await meta.hideComment(c.platform as "facebook" | "instagram", c.comment_id as string, acc.secrets.page_token, true);
      if (!r.ok) return { error: "social.replyFailed", messageParams: { detail: r.error ?? "" } };
      await supabase.from("social_comments").update({ status: "hidden" }).eq("id", c.id);
    } else {
      const { privateReplyText } = await import("@/lib/social/comments");
      const r = await meta.privateReplyToComment(c.comment_id as string, acc.secrets.page_token, privateReplyText(locale, "lead"));
      if (!r.ok) return { error: "social.replyFailed", messageParams: { detail: r.error ?? "" } };
      await supabase.from("social_comments").update({ status: "dm_sent" }).eq("id", c.id);
    }
  }
  revalidatePath(`/${locale}/social`);
  return { ok: true, message: "common.saved" };
}

const postSchema = z.object({
  body: z.string().trim().min(1).max(5000),
  platforms: z.array(z.enum(["facebook", "instagram"])).min(1).max(2),
  scheduled_at: z.string().trim().min(10).max(40),
  image_url: z.string().trim().max(1000).regex(/^https:\/\//).optional().or(z.literal("")),
});

export async function savePostAction(input: { locale: string; id?: string | null; body: string; platforms: string[]; scheduled_at: string; image_url?: string; draft?: boolean }): Promise<ActionState> {
  const locale = loc(input.locale);
  const ctx = await getOrgContext(locale);
  if (!ctx.can("campaigns.manage")) return { error: "errors.forbidden" };
  const p = postSchema.safeParse(input);
  if (!p.success) return { error: "social.invalidPost" };
  if (p.data.platforms.includes("instagram") && !p.data.image_url) return { error: "social.instagramNeedsImage" };
  const when = new Date(p.data.scheduled_at);
  if (Number.isNaN(when.getTime())) return { error: "social.invalidPost" };
  const row = { body: p.data.body, platforms: p.data.platforms, scheduled_at: when.toISOString(), image_url: p.data.image_url || null, status: input.draft ? "draft" : "scheduled", updated_at: new Date().toISOString() };
  const supabase = await createClient();
  const { error } = input.id && uuidSchema.safeParse(input.id).success
    ? await supabase.from("social_posts").update(row).eq("id", input.id).eq("organization_id", ctx.org.id).in("status", ["draft", "scheduled", "failed"])
    : await supabase.from("social_posts").insert({ ...row, organization_id: ctx.org.id, created_by: ctx.userId, source: "manual" });
  if (error) return { error: dbErrorKey(error) };
  revalidatePath(`/${locale}/social`);
  return { ok: true, message: input.draft ? "social.draftSaved" : "social.scheduled" };
}

export async function postStatusAction(input: { locale: string; id: string; action: "approve" | "cancel" | "now" }): Promise<ActionState> {
  const locale = loc(input.locale);
  const ctx = await getOrgContext(locale);
  if (!ctx.can("campaigns.manage")) return { error: "errors.forbidden" };
  if (!uuidSchema.safeParse(input.id).success) return { error: "validation.invalidId" };
  const supabase = await createClient();
  const patch = input.action === "cancel" ? { status: "canceled" } : input.action === "now" ? { status: "scheduled", scheduled_at: new Date().toISOString() } : { status: "scheduled" };
  const { error } = await supabase.from("social_posts").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", input.id).eq("organization_id", ctx.org.id).in("status", ["draft", "scheduled", "failed"]);
  if (error) return { error: dbErrorKey(error) };
  if (input.action === "now") {
    const { publishDuePosts } = await import("@/lib/social/publish");
    await publishDuePosts(20_000).catch(() => undefined);
    // wave 35: report what really happened instead of always saying "publishing"
    const { data: after } = await supabase.from("social_posts").select("status, results").eq("id", input.id).eq("organization_id", ctx.org.id).maybeSingle();
    revalidatePath(`/${locale}/social`);
    const res = (after?.results ?? {}) as Record<string, { ok?: boolean; error?: string }>;
    if (after?.status === "published") return { ok: true, message: "social.publishedNow" };
    if (after?.status === "partial") return { ok: true, message: "social.postStatus.partial" };
    if (after?.status === "failed" || (after?.status === "scheduled" && Object.values(res).some((r) => r && r.ok === false))) {
      const bad = Object.values(res).find((r) => r && r.ok === false);
      const kind = classifyPublishError(bad?.error);
      if (after?.status === "scheduled") return { ok: true, message: "social.retrying" };
      const key = publishHintKey(kind);
      return key ? { error: key } : { error: "social.replyFailed", messageParams: { detail: String(bad?.error ?? "").slice(0, 200) } };
    }
    return { ok: true, message: "social.publishing" };
  }
  revalidatePath(`/${locale}/social`);
  return { ok: true, message: input.action === "cancel" ? "social.canceled" : "social.scheduled" };
}

const settingsSchema = z.object({
  comment_drafts: z.boolean(),
  comment_auto_reply: z.boolean(),
  comment_private_reply: z.boolean(),
  hide_spam: z.boolean(),
  posts_per_week: z.number().int().min(1).max(14),
  brand_voice: z.string().trim().max(2000).optional().nullable(),
});

export async function saveSocialSettingsAction(input: { locale: string } & z.infer<typeof settingsSchema>): Promise<ActionState> {
  const locale = loc(input.locale);
  const ctx = await getOrgContext(locale);
  if (!ctx.can("settings.manage") && !ctx.can("campaigns.manage")) return { error: "errors.forbidden" };
  const p = settingsSchema.safeParse(input);
  if (!p.success) return { error: "validation.invalid" };
  const supabase = await createClient();
  const { error } = await supabase.from("social_settings").upsert({ organization_id: ctx.org.id, ...p.data, brand_voice: p.data.brand_voice || null, updated_at: new Date().toISOString() }, { onConflict: "organization_id" });
  if (error) return { error: dbErrorKey(error) };
  revalidatePath(`/${locale}/social`);
  return { ok: true, message: "common.saved" };
}

export async function replyReviewAction(input: { locale: string; id: string; text: string }): Promise<ActionState> {
  const locale = loc(input.locale);
  const ctx = await getOrgContext(locale);
  if (!ctx.can("inbox.reply")) return { error: "errors.forbidden" };
  if (!uuidSchema.safeParse(input.id).success) return { error: "validation.invalidId" };
  const text = input.text.trim();
  if (!text || text.length > 4000) return { error: "validation.required" };
  const supabase = await createClient();
  const { data: rv } = await supabase.from("reviews").select("id, external_id, source").eq("id", input.id).eq("organization_id", ctx.org.id).maybeSingle();
  if (!rv) return { error: "validation.invalidId" };
  const { loadIntegration } = await import("@/lib/integrations/store");
  const integ = await loadIntegration(ctx.org.id, "google_business");
  if (!integ?.secrets.refresh_token) return { error: "social.googleNotConnected" };
  const { postReviewReply } = await import("@/lib/google/reviews");
  const r = await postReviewReply(integ.secrets.refresh_token, rv.external_id as string, text);
  if (!r.ok) return { error: "social.replyFailed", messageParams: { detail: r.error ?? "" } };
  await supabase.from("reviews").update({ reply: text, replied_at: new Date().toISOString(), status: "replied" }).eq("id", rv.id);
  revalidatePath(`/${locale}/social`);
  return { ok: true, message: "social.replied" };
}

export async function reviewSettingsAction(input: { locale: string; autoReplyPositive: boolean }): Promise<ActionState> {
  const locale = loc(input.locale);
  const ctx = await getOrgContext(locale);
  if (!ctx.can("settings.manage")) return { error: "errors.forbidden" };
  const { loadIntegration, saveIntegration } = await import("@/lib/integrations/store");
  const integ = await loadIntegration(ctx.org.id, "google_business");
  if (!integ) return { error: "social.googleNotConnected" };
  await saveIntegration(ctx.org.id, "google_business", { ...integ.config, auto_reply_positive: Boolean(input.autoReplyPositive) });
  revalidatePath(`/${locale}/social`);
  return { ok: true, message: "common.saved" };
}

/* ------------------------------------------------------------------ wave 36 */

/** a copy of a post as a new draft (tomorrow, same time) — the original is untouched */
export async function duplicatePostAction(input: { locale: string; id: string }): Promise<ActionState> {
  const locale = loc(input.locale);
  const ctx = await getOrgContext(locale);
  if (!ctx.can("campaigns.manage")) return { error: "errors.forbidden" };
  if (!uuidSchema.safeParse(input.id).success) return { error: "validation.invalidId" };
  const supabase = await createClient();
  const { data: src } = await supabase.from("social_posts").select("body, platforms, image_url, scheduled_at").eq("id", input.id).eq("organization_id", ctx.org.id).maybeSingle();
  if (!src) return { error: "validation.invalidId" };
  const base = Math.max(new Date(src.scheduled_at as string).getTime(), Date.now());
  const { error } = await supabase.from("social_posts").insert({
    organization_id: ctx.org.id,
    created_by: ctx.userId,
    source: "manual",
    status: "draft",
    body: src.body,
    platforms: src.platforms,
    image_url: src.image_url,
    scheduled_at: new Date(base + 86_400_000).toISOString(),
  });
  if (error) return { error: dbErrorKey(error) };
  revalidatePath(`/${locale}/social`);
  return { ok: true, message: "social.pro.duplicated" };
}

/** approve every draft at once; drafts whose time has passed go out in 10 minutes instead of immediately */
export async function approveAllDraftsAction(input: { locale: string }): Promise<ActionState<{ count: number }>> {
  const locale = loc(input.locale);
  const ctx = await getOrgContext(locale);
  if (!ctx.can("campaigns.manage")) return { error: "errors.forbidden" };
  const supabase = await createClient();
  const nowIso = new Date().toISOString();
  const { data: late } = await supabase.from("social_posts").update({ status: "scheduled", scheduled_at: new Date(Date.now() + 10 * 60_000).toISOString(), updated_at: nowIso }).eq("organization_id", ctx.org.id).eq("status", "draft").lt("scheduled_at", nowIso).select("id");
  const { data: future } = await supabase.from("social_posts").update({ status: "scheduled", updated_at: nowIso }).eq("organization_id", ctx.org.id).eq("status", "draft").gte("scheduled_at", nowIso).select("id");
  const count = (late?.length ?? 0) + (future?.length ?? 0);
  revalidatePath(`/${locale}/social`);
  return { ok: true, message: count ? "social.pro.approvedAll" : "social.pro.noDrafts", messageParams: { count }, data: { count } };
}

const aiPostSchema = z.object({
  topic: z.string().trim().min(2).max(400),
  tone: z.enum(["friendly", "professional", "playful", "premium"]),
  platform: z.enum(["facebook", "instagram"]),
});

/** "Write it for me": one post in the business's voice, from its own agent instructions — never invents prices */
export async function aiWritePostAction(input: { locale: string; topic: string; tone: string; platform: string }): Promise<ActionState<{ text: string }>> {
  const locale = loc(input.locale);
  const ctx = await getOrgContext(locale);
  if (!ctx.can("campaigns.manage")) return { error: "errors.forbidden" };
  const p = aiPostSchema.safeParse(input);
  if (!p.success) return { error: "validation.invalid" };
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return { error: "errors.generic" };
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const admin = createAdminClient();
  const { data: allowed } = await admin.rpc("public_rate_limit", { p_bucket: `socialai:${ctx.org.id}`, p_limit: 8, p_window_seconds: 60 });
  if (allowed === false) return { error: "ai.busy" };
  const [{ data: org }, { data: agent }, { data: social }] = await Promise.all([
    admin.from("organizations").select("name").eq("id", ctx.org.id).maybeSingle(),
    admin.from("ai_agents").select("id, instructions, provider, model").eq("organization_id", ctx.org.id).eq("enabled", true).order("created_at").limit(1).maybeSingle(),
    admin.from("social_settings").select("brand_voice").eq("organization_id", ctx.org.id).maybeSingle(),
  ]);
  const lang = locale === "en" ? "English" : locale === "ar" ? "Arabic" : "Hebrew";
  const isIg = p.data.platform === "instagram";
  const { runAISystem } = await import("@/lib/ai/run-system");
  const out = await runAISystem({
    orgId: ctx.org.id,
    feature: "social",
    agentId: (agent?.id as string | undefined) ?? null,
    provider: (agent?.provider as "openai" | "anthropic" | "gemini" | null) ?? undefined,
    model: (agent?.model as string | null) ?? undefined,
    system: [
      `You are the social media manager of "${String(org?.name ?? "").slice(0, 120)}". Business information:\n${String(agent?.instructions ?? "").slice(0, 4000)}`,
      social?.brand_voice ? `Brand voice: ${String(social.brand_voice).slice(0, 800)}` : "",
      `Write ONE ${isIg ? "Instagram" : "Facebook"} post in ${lang}, tone: ${p.data.tone}. ${isIg ? "Up to 6 short lines, 4-8 relevant hashtags at the end." : "2-5 short lines, 1-3 relevant hashtags at the end."} Emojis sparingly. End with one clear call to action (message us / book / call). NEVER invent prices, discounts, dates or facts that are not in the business information. Answer with the post text only — no quotes, no explanations.`,
    ].filter(Boolean).join("\n\n"),
    messages: [{ role: "user", content: p.data.topic }],
    temperature: 0.7,
    maxTokens: 600,
    patienceMs: 15_000,
  });
  if (!out.ok) return { error: out.error };
  const text = out.text.trim().replace(/^["“«]+|["”»]+$/g, "").slice(0, isIg ? 2200 : 5000);
  if (!text) return { error: "ai.failed" };
  return { ok: true, data: { text } };
}
