"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { uuidSchema } from "@scc/shared/validators";
import { getOrgContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { dbErrorKey, type ActionState } from "@/lib/action-state";
import { normalizeAutopilot } from "@/lib/social/brain-core";

/** Wave 61 — the social brain: daily autopilot, plan a week, post from a review, repurpose, hashtags, learning. */
const loc = (l: string): "he" | "en" | "ar" => (l === "ar" || l === "en" ? l : "he");

async function guard(locale: "he" | "en" | "ar", needAi = true) {
  const ctx = await getOrgContext(locale);
  if (!ctx.can("campaigns.manage") || (needAi && !ctx.can("ai.use"))) return { ctx, error: "errors.forbidden" as const };
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return { ctx, error: "errors.generic" as const };
  return { ctx, error: null };
}

async function limited(orgId: string, bucket: string, n: number, sec: number): Promise<boolean> {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const { data } = await createAdminClient().rpc("public_rate_limit", { p_bucket: `${bucket}:${orgId}`, p_limit: n, p_window_seconds: sec });
  return data === false;
}

const settingsSchema = z.object({
  enabled: z.boolean(),
  mode: z.enum(["draft", "auto"]),
  post_time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  days: z.array(z.number().int().min(0).max(6)).min(1).max(7),
  platforms: z.array(z.enum(["facebook", "instagram"])).min(1).max(2),
  media: z.enum(["image", "video", "mix", "none"]),
  style: z.string().max(20),
  tone: z.string().max(20),
  pillars: z.string().max(1200),
  hashtags: z.string().max(1500),
  avoid: z.string().max(500),
  cta_type: z.string().max(20),
  cta_value: z.string().max(500),
  holidays: z.boolean(),
  reviews_to_posts: z.boolean(),
  telegram_chat: z.string().max(120),
});

export async function saveAutopilotAction(input: { locale: string } & z.infer<typeof settingsSchema>): Promise<ActionState> {
  const locale = loc(input.locale);
  const ctx = await getOrgContext(locale);
  if (!ctx.can("campaigns.manage")) return { error: "errors.forbidden" };
  const p = settingsSchema.safeParse(input);
  if (!p.success) return { error: "validation.invalid" };
  if (p.data.telegram_chat.trim() && !/^(@[A-Za-z0-9_]{4,64}|-100\d{6,20})$/.test(p.data.telegram_chat.trim())) return { error: "social.brain.badChannel" };
  const s = normalizeAutopilot(p.data);
  const supabase = await createClient();
  const { error } = await supabase.from("social_autopilot").upsert(
    {
      organization_id: ctx.org.id,
      enabled: s.enabled,
      mode: s.mode,
      post_time: s.post_time,
      days: s.days,
      platforms: s.platforms,
      media: s.media,
      style: s.style,
      tone: s.tone,
      pillars: s.pillars,
      hashtags: s.hashtags,
      avoid: s.avoid,
      cta_type: s.cta_type,
      cta_value: s.cta_value,
      holidays: s.holidays,
      reviews_to_posts: s.reviews_to_posts,
      telegram_chat: s.telegram_chat,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "organization_id" },
  );
  if (error) return { error: dbErrorKey(error) };
  revalidatePath(`/${locale}/social`);
  return { ok: true, message: s.enabled ? "social.brain.savedOn" : "common.saved" };
}

/** "Make the next post now" — a finished post (text + picture / video) as a draft for the next slot. */
export async function smartPostNowAction(input: { locale: string; topic?: string; reviewId?: string }): Promise<ActionState<{ id: string }>> {
  const locale = loc(input.locale);
  const g = await guard(locale);
  if (g.error) return { error: g.error };
  if (input.reviewId && !uuidSchema.safeParse(input.reviewId).success) return { error: "validation.invalid" };
  if (await limited(g.ctx.org.id, "socialbrain", 6, 600)) return { error: "ai.busy" };
  const { loadAutopilot, makeSmartPost } = await import("@/lib/social/brain");
  const { nextSlot, weekSlots } = await import("@/lib/social/brain-core");
  const s = await loadAutopilot(g.ctx.org.id);
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const { data: org } = await createAdminClient().from("organizations").select("timezone").eq("id", g.ctx.org.id).maybeSingle();
  const tz = (org?.timezone as string | null) || "Asia/Jerusalem";
  const slot = nextSlot({ now: new Date(), tz, postTime: s.post_time, days: s.days, lastPlannedFor: null, horizonH: 24 * 8 }) ?? weekSlots({ now: new Date(), tz, postTime: s.post_time, days: [0, 1, 2, 3, 4, 5, 6], count: 1 })[0]!;
  const r = await makeSmartPost(g.ctx.org.id, { at: slot.at, date: slot.date, origin: input.reviewId ? "review" : "studio", status: "draft", reviewId: input.reviewId ?? null, topic: input.topic?.trim().slice(0, 300) || null });
  if (!r.ok) return { error: r.error.startsWith("save:") ? "errors.generic" : r.error.includes(".") ? r.error : "ai.failed" };
  revalidatePath(`/${locale}/social`);
  return { ok: true, data: { id: r.id }, message: "social.brain.postReady" };
}

/** "Plan my week" — drafts for every allowed day of the coming week; media follows in the background. */
export async function planWeekAction(input: { locale: string; count?: number }): Promise<ActionState<{ count: number }>> {
  const locale = loc(input.locale);
  const g = await guard(locale);
  if (g.error) return { error: g.error };
  if (await limited(g.ctx.org.id, "socialweek", 3, 3600)) return { error: "ai.busy" };
  const { planWeek } = await import("@/lib/social/brain");
  const r = await planWeek(g.ctx.org.id, Math.max(1, Math.min(7, Number(input.count ?? 7))));
  if (!r.ok) return { error: r.error.includes(".") ? r.error : "ai.failed" };
  revalidatePath(`/${locale}/social`);
  return { ok: true, data: { count: r.count }, message: "social.brain.weekReady", messageParams: { count: r.count } };
}

/** One post → versions for every place: Instagram, Facebook, Story, Reel script, Telegram, WhatsApp status. */
export async function repurposeAction(input: { locale: string; text: string }): Promise<ActionState<{ versions: Record<string, string> }>> {
  const locale = loc(input.locale);
  const g = await guard(locale);
  if (g.error) return { error: g.error };
  const text = String(input.text ?? "").trim();
  if (text.length < 20 || text.length > 5000) return { error: "validation.invalid" };
  if (await limited(g.ctx.org.id, "socialai", 8, 60)) return { error: "ai.busy" };
  const { runAISystem } = await import("@/lib/ai/run-system");
  const lang = locale === "en" ? "English" : locale === "ar" ? "Arabic" : "Hebrew";
  const out = await runAISystem({
    orgId: g.ctx.org.id,
    feature: "social",
    system: `You are a senior social media editor. Rewrite the same message natively for each format, in ${lang}. Keep every fact; never add prices, dates or claims. Answer JSON ONLY: {"instagram": "...", "facebook": "...", "story": "max 12 words for a story sticker", "reel": "a 15-second reel script: hook (0-3s), 2-3 beats, call to action — one line each", "telegram": "...", "whatsapp": "short status, max 2 lines", "linkedin": "professional version"}. Use \\n for line breaks.`,
    messages: [{ role: "user", content: text }],
    temperature: 0.7,
    maxTokens: 1800,
    patienceMs: 20_000,
  });
  if (!out.ok) return { error: out.error };
  const raw = out.text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "");
  try {
    const j = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1)) as Record<string, unknown>;
    const versions: Record<string, string> = {};
    for (const k of ["instagram", "facebook", "story", "reel", "telegram", "whatsapp", "linkedin"]) if (typeof j[k] === "string" && (j[k] as string).trim()) versions[k] = (j[k] as string).replace(/\\n/g, "\n").trim().slice(0, 2200);
    if (!Object.keys(versions).length) return { error: "ai.failed" };
    return { ok: true, data: { versions } };
  } catch {
    return { error: "ai.failed" };
  }
}

/** Smart hashtags for a post: popular + niche + local, in the post's language and English. */
export async function hashtagsAction(input: { locale: string; text: string; platform: string }): Promise<ActionState<{ tags: string[] }>> {
  const locale = loc(input.locale);
  const g = await guard(locale);
  if (g.error) return { error: g.error };
  const text = String(input.text ?? "").trim();
  if (text.length < 10 || text.length > 5000) return { error: "validation.invalid" };
  if (await limited(g.ctx.org.id, "socialai", 8, 60)) return { error: "ai.busy" };
  const { runAISystem } = await import("@/lib/ai/run-system");
  const out = await runAISystem({
    orgId: g.ctx.org.id,
    feature: "social",
    system: `Suggest ${input.platform === "instagram" ? 15 : 6} hashtags for this social post: a mix of broad, niche and local (Israel) tags, in the post's language and English. No spaces inside a tag. Answer ONLY the hashtags separated by spaces.`,
    messages: [{ role: "user", content: text }],
    temperature: 0.5,
    maxTokens: 300,
    patienceMs: 15_000,
  });
  if (!out.ok) return { error: out.error };
  const tags = [...new Set((out.text.match(/#[\p{L}\p{N}_]+/gu) ?? []).map((t) => t.slice(0, 60)))].slice(0, 20);
  return tags.length ? { ok: true, data: { tags } } : { error: "ai.failed" };
}

/** Recycle a top post: a fresh rewrite of a post that performed well, as a draft for next week. */
export async function recyclePostAction(input: { locale: string; id: string }): Promise<ActionState> {
  const locale = loc(input.locale);
  const g = await guard(locale);
  if (g.error) return { error: g.error };
  if (!uuidSchema.safeParse(input.id).success) return { error: "validation.invalid" };
  if (await limited(g.ctx.org.id, "socialai", 8, 60)) return { error: "ai.busy" };
  const supabase = await createClient();
  const { data: src } = await supabase.from("social_posts").select("body, platforms, image_url, video_url, pillar, cta_type, cta_value, telegram_chat").eq("id", input.id).eq("organization_id", g.ctx.org.id).maybeSingle();
  if (!src) return { error: "errors.notFound" };
  const { runAISystem } = await import("@/lib/ai/run-system");
  const lang = locale === "en" ? "English" : locale === "ar" ? "Arabic" : "Hebrew";
  const out = await runAISystem({
    orgId: g.ctx.org.id,
    feature: "social",
    system: `This post performed very well. Write a FRESH version in ${lang} with the same message and facts but a new hook, new wording and a new angle, so followers do not feel a repeat. Same length and structure, hashtags last. Answer only the post text.`,
    messages: [{ role: "user", content: String(src.body) }],
    temperature: 0.85,
    maxTokens: 1200,
    patienceMs: 20_000,
  });
  if (!out.ok) return { error: out.error };
  const body = out.text.replace(/^["“«]+|["”»]+$/g, "").trim().slice(0, 5000);
  if (body.length < 20) return { error: "ai.failed" };
  const { error } = await supabase.from("social_posts").insert({
    organization_id: g.ctx.org.id,
    platforms: src.platforms,
    body,
    image_url: src.image_url,
    video_url: src.video_url,
    scheduled_at: new Date(Date.now() + 7 * 86_400_000).toISOString(),
    status: "draft",
    source: "agent",
    origin: "evergreen",
    pillar: src.pillar,
    cta_type: src.cta_type,
    cta_value: src.cta_value,
    telegram_chat: src.telegram_chat,
    created_by: g.ctx.userId,
  });
  if (error) return { error: dbErrorKey(error) };
  revalidatePath(`/${locale}/social`);
  return { ok: true, message: "social.brain.recycled" };
}

/** Re-learn now (after connecting, or when the owner wants fresh numbers). */
export async function refreshBrainAction(input: { locale: string }): Promise<ActionState> {
  const locale = loc(input.locale);
  const g = await guard(locale, false);
  if (g.error) return { error: g.error };
  if (await limited(g.ctx.org.id, "socialbrainrefresh", 4, 3600)) return { error: "errors.rateLimited" };
  const { syncPostMetrics, refreshBrain } = await import("@/lib/social/brain");
  await syncPostMetrics(12_000).catch(() => undefined);
  await refreshBrain(g.ctx.org.id);
  revalidatePath(`/${locale}/social`);
  return { ok: true, message: "social.brain.learnedNow" };
}

/** Sends a test message to the Telegram channel (checks the bot is an admin there). */
export async function testTelegramChannelAction(input: { locale: string; chat: string }): Promise<ActionState> {
  const locale = loc(input.locale);
  const g = await guard(locale, false);
  if (g.error) return { error: g.error };
  const chat = String(input.chat ?? "").trim();
  if (!/^(@[A-Za-z0-9_]{4,64}|-100\d{6,20})$/.test(chat)) return { error: "social.brain.badChannel" };
  if (await limited(g.ctx.org.id, "tgchannel", 5, 600)) return { error: "errors.rateLimited" };
  const { publishTelegram } = await import("@/lib/social/brain");
  const r = await publishTelegram(g.ctx.org.id, chat, { body: locale === "en" ? "✅ Connected — posts will appear here automatically." : locale === "ar" ? "✅ تم الربط — ستظهر المنشورات هنا تلقائيًا." : "✅ מחובר — הפוסטים יופיעו כאן אוטומטית.", image_url: null });
  if (r.ok) return { ok: true, message: "social.brain.channelOk" };
  return { error: r.error === "telegram_not_connected" ? "social.brain.noBot" : "social.brain.channelFail" };
}

/** W1-B1 — one post with everything the editor needs (opened right after "create a post now"). */
export async function getPostAction(input: { locale: string; id: string }): Promise<ActionState<{ post: Record<string, unknown> }>> {
  const locale = loc(input.locale);
  const ctx = await getOrgContext(locale);
  if (!ctx.can("campaigns.manage")) return { error: "errors.forbidden" };
  if (!uuidSchema.safeParse(input.id).success) return { error: "validation.invalidId" };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("social_posts")
    .select("id, platforms, body, image_url, scheduled_at, status, source, results, link_url, video_url, cta_type, cta_value, first_comment, pillar, origin, engagement, metrics, media_pending, headline")
    .eq("id", input.id)
    .eq("organization_id", ctx.org.id)
    .maybeSingle();
  if (error || !data) return { error: "errors.notFound" };
  return { ok: true, data: { post: data as Record<string, unknown> } };
}
