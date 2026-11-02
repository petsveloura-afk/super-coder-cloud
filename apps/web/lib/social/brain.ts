import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadOrg, logRun, notifyOwners, type Org } from "@/lib/agents/run";
import {
  AUTOPILOT_DEFAULTS,
  autopilotTask,
  brainBrief,
  containsAvoided,
  engagementScore,
  holidayLine,
  isRepeat,
  learnFromPosts,
  mediaForDate,
  mergeHashtags,
  nextSlot,
  normalizeAutopilot,
  parseWeekPlan,
  pickPillar,
  pillarsFor,
  sumMetrics,
  telegramCaption,
  upcomingHolidays,
  videoQuery,
  weekSlots,
  type AutopilotSettings,
  type Learned,
  type PostMetrics,
} from "./brain-core";

/**
 * Wave 61 — the social brain (server side).
 *
 *  • runSocialAutopilot: every 5 minutes, businesses whose next posting slot is within ~30 hours get ONE
 *    finished post for that day (text written with the business's knowledge + what the brain learned, an
 *    image or a real video), as a draft for approval or scheduled — claimed once per day in the database.
 *  • fillPendingMedia: posts planned for the week get their picture / video in the background.
 *  • syncPostMetrics + refreshBrain: real likes / comments / shares of published posts → what works.
 *  • publishTelegram: the same post also goes to the business's Telegram channel.
 * Every step is bounded by a time budget and never throws.
 */

const langName = (l: string) => (l === "en" ? "English" : l === "ar" ? "Arabic" : "Hebrew");

export async function loadAutopilot(orgId: string): Promise<AutopilotSettings> {
  const { data } = await createAdminClient().from("social_autopilot").select("enabled, mode, post_time, days, platforms, media, style, tone, pillars, hashtags, avoid, cta_type, cta_value, holidays, reviews_to_posts, telegram_chat, last_planned_for, last_error").eq("organization_id", orgId).maybeSingle();
  if (!data) return { ...AUTOPILOT_DEFAULTS };
  return { ...normalizeAutopilot(data as Record<string, unknown>), enabled: Boolean((data as { enabled?: boolean }).enabled), last_planned_for: ((data as { last_planned_for?: string | null }).last_planned_for ?? null) as string | null };
}

export async function loadLearned(orgId: string): Promise<Learned | null> {
  const { data } = await createAdminClient().from("social_brain").select("learned").eq("organization_id", orgId).maybeSingle();
  const l = (data?.learned ?? null) as Learned | null;
  return l && typeof l.posts === "number" ? l : null;
}

interface MakeOpts {
  at: Date;
  date: string;
  origin: "autopilot" | "review" | "holiday" | "studio";
  status: "draft" | "scheduled";
  reviewId?: string | null;
  pillar?: string | null;
  topic?: string | null;
}

/** Writes + illustrates + saves ONE post. Returns the new post id. */
export async function makeSmartPost(orgId: string, opts: MakeOpts): Promise<{ ok: true; id: string; media: string; pillar: string } | { ok: false; error: string }> {
  const org = await loadOrg(orgId);
  if (!org) return { ok: false, error: "no_org" };
  const admin = createAdminClient();
  const [s, learned, { data: social }, { data: recentRows }, { data: accs }, { data: inbound }, { data: products }] = await Promise.all([
    loadAutopilot(orgId),
    loadLearned(orgId),
    admin.from("social_settings").select("brand_voice").eq("organization_id", orgId).maybeSingle(),
    admin.from("social_posts").select("body, pillar, origin, created_at").eq("organization_id", orgId).neq("status", "canceled").order("created_at", { ascending: false }).limit(20),
    admin.from("channel_accounts").select("kind").eq("organization_id", orgId).in("kind", ["messenger", "instagram"]),
    // deeper understanding: what customers asked lately + the real products / prices
    admin.from("messages").select("body").eq("organization_id", orgId).eq("direction", "in").gte("created_at", new Date(Date.now() - 21 * 86_400_000).toISOString()).order("created_at", { ascending: false }).limit(150),
    admin.from("products").select("name, unit_price, description").eq("organization_id", orgId).eq("active", true).order("created_at").limit(8),
  ]);
  const recent = (recentRows ?? []) as { body: string; pillar: string | null; origin: string | null }[];
  const connected = new Set(((accs ?? []) as { kind: string }[]).map((a) => (a.kind === "messenger" ? "facebook" : a.kind)));
  const pillars = pillarsFor(org.locale, s.pillars);
  const pillar = opts.pillar || pickPillar(pillars, recent.map((r) => r.pillar), learned?.pillarScores ?? {}, Number(opts.date.replace(/-/g, "")) + orgId.charCodeAt(0));

  // a real 5★ review, about once a week (or when asked for one)
  let review: { id: string; author: string | null; body: string; rating: number | null } | null = null;
  if (opts.reviewId) {
    const { data } = await admin.from("reviews").select("id, author, body, rating").eq("organization_id", orgId).eq("id", opts.reviewId).maybeSingle();
    review = (data as typeof review) ?? null;
  } else if (s.reviews_to_posts && opts.origin === "autopilot" && !recent.slice(0, 5).some((r) => r.origin === "review")) {
    const { data } = await admin.from("reviews").select("id, author, body, rating").eq("organization_id", orgId).gte("rating", 5).order("reviewed_at", { ascending: false, nullsFirst: false }).limit(10);
    const used = new Set(recent.map((r) => r.body));
    review = ((data ?? []) as { id: string; author: string | null; body: string; rating: number | null }[]).find((r) => (r.body ?? "").length >= 25 && ![...used].some((u) => u.includes(r.body.slice(0, 30)))) ?? null;
  }
  const holiday = s.holidays ? holidayLine(upcomingHolidays(opts.date, 5)[0], org.locale) : "";
  const media = mediaForDate(s.media, opts.date);
  // Instagram only with a picture / video; only the networks that are connected (Facebook as the safe default)
  const wanted = s.platforms.filter((p) => connected.has(p) || !connected.size);
  const primary: "facebook" | "instagram" = wanted.includes("instagram") && media !== "none" ? "instagram" : "facebook";

  const { runAISystem } = await import("@/lib/ai/run-system");
  const { marketingCopyRules } = await import("@/lib/ai/brain-pro");
  const { parseFullPost, buildSceneImagePrompt } = await import("./studio-core");
  const plus = await import("./brain-plus-core");
  const signals = plus.customerSignals(((inbound ?? []) as { body: string | null }[]).map((m) => m.body ?? ""));
  const dayNames = Array.from({ length: 7 }, (_, d) => new Date(Date.UTC(2026, 10, 1 + d)).toLocaleDateString("en-GB", { weekday: "long", timeZone: "UTC" }));
  const productLines = ((products ?? []) as { name: string; unit_price: number | string; description: string | null }[]).map((p) => `- ${p.name}${Number(p.unit_price) > 0 ? ` (${p.unit_price})` : ""}${p.description ? ` — ${p.description.slice(0, 120)}` : ""}`);
  const system = [
    `You are the senior social media manager of "${org.name}". Business information:\n${(org.agent?.instructions ?? "").slice(0, 5000)}`,
    social?.brand_voice ? `Brand voice: ${String(social.brand_voice).slice(0, 800)}` : "",
    productLines.length ? `Real products / services (names and prices exactly as written):\n${productLines.join("\n")}` : "",
    marketingCopyRules(),
    brainBrief(learned),
    plus.deeperBrief((learned as (Learned & { deep?: import("./brain-plus-core").DeepLearned }) | null)?.deep, dayNames),
    plus.customerBrief(signals),
    plus.dayContext(opts.date, org.locale),
    s.avoid ? `Never use these words or topics: ${s.avoid}` : "",
    recent.length ? `Recent posts (do NOT repeat their ideas, hooks or wording):\n${recent.slice(0, 8).map((r) => `- ${r.body.replace(/\s+/g, " ").slice(0, 140)}`).join("\n")}` : "",
    "NEVER invent prices, discounts, dates, names, addresses or facts that are not in the business information.",
  ]
    .filter(Boolean)
    .join("\n\n");
  const task = autopilotTask({ pillar: opts.topic ? `${pillar} — ${opts.topic}` : pillar, platform: primary, lang: langName(org.locale), tone: s.tone, media, holiday, review: review ? { author: review.author, text: review.body, rating: review.rating } : null });
  let parts: ReturnType<typeof parseFullPost> = null;
  let feedback = "";
  let lastWeak: ReturnType<typeof parseFullPost> = null;
  for (let attempt = 0; attempt < 2 && !parts; attempt++) {
    const out = await runAISystem({
      orgId,
      feature: "social",
      agentId: org.agent?.id ?? null,
      provider: (org.agent?.provider as "openai" | "anthropic" | "gemini" | null) ?? undefined,
      model: org.agent?.model ?? undefined,
      system,
      messages: [{ role: "user", content: attempt ? (feedback ? `${task}\n\n${feedback}` : `${task}\nThe previous draft was too similar to a recent post — take a completely different angle and hook.`) : task }],
      temperature: attempt ? 0.95 : 0.8,
      maxTokens: 1400,
      patienceMs: 20_000,
    });
    if (!out.ok) return { ok: false, error: out.error };
    const p = parseFullPost(out.text, primary === "instagram" ? 2200 : 5000);
    if (p && p.post.length >= 30 && (!isRepeat(p.post, recent.map((r) => r.body)) || attempt === 1)) {
      // self-check: a weak first draft (no hook / no call to action / wrong hashtags…) is rewritten once with concrete feedback
      const q = plus.postQuality(p.post, primary);
      if (attempt === 0 && q.score < 60) {
        feedback = plus.qualityFeedback(q);
        parts = null;
        lastWeak = p;
        continue;
      }
      parts = p;
    }
  }
  if (!parts && lastWeak) parts = lastWeak;
  if (!parts) return { ok: false, error: "ai.failed" };
  let body = mergeHashtags(parts.post, s.hashtags, primary);
  if (containsAvoided(body, s.avoid).length) {
    for (const w of containsAvoided(body, s.avoid)) body = body.replace(new RegExp(w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), "");
  }

  // media
  let imageUrl: string | null = null;
  let videoUrl: string | null = null;
  let mediaPending: "image" | "video" | null = null;
  if (media === "video") {
    const { stockVideoForPost } = await import("./stock-video");
    const v = await stockVideoForPost(orgId, videoQuery(parts.scene, pillar), primary);
    if (v.ok) videoUrl = v.url;
  }
  if (media !== "none" && !videoUrl) {
    const { generateMeteredImage, sceneForImage } = await import("./studio-image");
    const scene = parts.scene && !/[֐-׿؀-ۿ]/.test(parts.scene) && media !== "video" ? parts.scene : await sceneForImage(body);
    const prompt = buildSceneImagePrompt({ scene, platform: primary, style: (s.style === "auto" ? "photo" : s.style) as "photo", brandVoice: (social?.brand_voice as string | null) ?? null, business: org.name });
    const img = await generateMeteredImage(orgId, prompt, primary);
    if (img.ok) imageUrl = img.url;
    else mediaPending = "image";
  }
  const hasMedia = Boolean(imageUrl || videoUrl);
  const platforms = wanted.filter((p) => p === "facebook" || hasMedia);
  const { data: row, error } = await admin
    .from("social_posts")
    .insert({
      organization_id: orgId,
      platforms: platforms.length ? platforms : ["facebook"],
      body: body.slice(0, 5000),
      image_url: imageUrl,
      video_url: videoUrl,
      scheduled_at: opts.at.toISOString(),
      status: opts.status,
      source: "agent",
      origin: review ? "review" : holiday && opts.origin === "autopilot" ? "holiday" : opts.origin,
      pillar: (review ? pillar : pillar).slice(0, 80),
      headline: parts.headline?.slice(0, 160) ?? null,
      first_comment: parts.firstComment ? mergeHashtags(parts.firstComment, [], "instagram").slice(0, 2200) : null,
      cta_type: s.cta_type,
      cta_value: s.cta_value,
      media_pending: mediaPending,
      telegram_chat: s.telegram_chat,
    })
    .select("id")
    .single();
  if (error || !row) return { ok: false, error: `save:${error?.message ?? "failed"}`.slice(0, 200) };
  return { ok: true, id: row.id as string, media: videoUrl ? "video" : imageUrl ? "image" : "text", pillar };
}

/** The daily autopilot — called from the cron every few minutes. */
export async function runSocialAutopilot(budgetMs = 50_000): Promise<{ checked: number; made: number; failed: number }> {
  const started = Date.now();
  const admin = createAdminClient();
  const { data } = await admin.from("social_autopilot").select("organization_id, post_time, days, mode, last_planned_for").eq("enabled", true).order("last_planned_for", { ascending: true, nullsFirst: true }).limit(40);
  const rows = (data ?? []) as { organization_id: string; post_time: string; days: number[]; mode: string; last_planned_for: string | null }[];
  let made = 0;
  let failed = 0;
  const orgCache = new Map<string, Org | null>();
  for (const r of rows) {
    // one post takes ~10-40 s (text + picture); never start one that cannot finish
    if (Date.now() - started > budgetMs - 25_000) break;
    if (!orgCache.has(r.organization_id)) orgCache.set(r.organization_id, await loadOrg(r.organization_id));
    const org = orgCache.get(r.organization_id);
    if (!org) continue;
    const slot = nextSlot({ now: new Date(), tz: org.tz, postTime: r.post_time, days: r.days, lastPlannedFor: r.last_planned_for });
    if (!slot) continue;
    const { data: claimed } = await admin.rpc("claim_social_autopilot", { p_org: r.organization_id, p_date: slot.date });
    if (!claimed) continue;
    const res = await makeSmartPost(r.organization_id, { at: slot.at, date: slot.date, origin: "autopilot", status: r.mode === "auto" ? "scheduled" : "draft" }).catch((e) => ({ ok: false as const, error: (e as Error).message }));
    if (res.ok) {
      made++;
      await admin.from("social_autopilot").update({ last_error: null }).eq("organization_id", r.organization_id);
      if (r.mode !== "auto") await notifyOwners(r.organization_id, "social.brain.notifyDraft", { date: slot.date }, "/social");
      await logRun(r.organization_id, "marketing", `autopilot: ${res.media} post for ${slot.date} (${res.pillar})`, { postId: res.id, date: slot.date }, 1).catch(() => undefined);
    } else {
      failed++;
      // give the day back so the next run tries again (AI busy / no credits are usually temporary)
      await admin.from("social_autopilot").update({ last_planned_for: r.last_planned_for, last_error: String(res.error).slice(0, 500) }).eq("organization_id", r.organization_id);
    }
  }
  return { checked: rows.length, made, failed };
}

/** Pictures / videos for posts that were planned without them (the week plan) — nearest first. */
export async function fillPendingMedia(budgetMs = 30_000): Promise<{ filled: number; failed: number }> {
  const started = Date.now();
  const admin = createAdminClient();
  const { data } = await admin
    .from("social_posts")
    .select("id, organization_id, body, platforms, media_pending, headline, status")
    .not("media_pending", "is", null)
    .in("status", ["draft", "scheduled"])
    .lt("scheduled_at", new Date(Date.now() + 8 * 86_400_000).toISOString())
    .order("scheduled_at")
    .limit(4);
  let filled = 0;
  let failed = 0;
  for (const p of (data ?? []) as { id: string; organization_id: string; body: string; platforms: string[]; media_pending: "image" | "video"; headline: string | null }[]) {
    if (Date.now() - started > budgetMs - 20_000) break;
    const s = await loadAutopilot(p.organization_id);
    const platform: "facebook" | "instagram" = s.platforms.includes("instagram") ? "instagram" : "facebook";
    let image: string | null = null;
    let video: string | null = null;
    if (p.media_pending === "video") {
      const { stockVideoForPost } = await import("./stock-video");
      const { sceneForImage } = await import("./studio-image");
      const v = await stockVideoForPost(p.organization_id, videoQuery(await sceneForImage(p.body), "business"), platform);
      if (v.ok) video = v.url;
    }
    if (!video) {
      const { generateMeteredImage, sceneForImage } = await import("./studio-image");
      const { buildSceneImagePrompt } = await import("./studio-core");
      const { data: org } = await admin.from("organizations").select("name").eq("id", p.organization_id).maybeSingle();
      const img = await generateMeteredImage(p.organization_id, buildSceneImagePrompt({ scene: await sceneForImage(p.body), platform, style: (s.style === "auto" ? "photo" : s.style) as "photo", business: (org?.name as string | null) ?? null }), platform);
      if (img.ok) image = img.url;
    }
    if (image || video) {
      filled++;
      const platforms = [...new Set([...p.platforms, ...s.platforms])].filter((x) => x === "facebook" || x === "instagram");
      await admin.from("social_posts").update({ image_url: image, video_url: video, media_pending: null, platforms, updated_at: new Date().toISOString() }).eq("id", p.id);
    } else {
      failed++;
      // keep the text post; stop trying after the picture failed (the owner can add one by hand)
      await admin.from("social_posts").update({ media_pending: null }).eq("id", p.id);
    }
  }
  return { filled, failed };
}

/** "Plan my week": ONE AI call writes the week; pictures / videos follow in the background. */
export async function planWeek(orgId: string, count = 7): Promise<{ ok: true; count: number } | { ok: false; error: string }> {
  const org = await loadOrg(orgId);
  if (!org) return { ok: false, error: "no_org" };
  const admin = createAdminClient();
  const [s, learned, { data: social }, { data: taken }, { data: recentRows }] = await Promise.all([
    loadAutopilot(orgId),
    loadLearned(orgId),
    admin.from("social_settings").select("brand_voice").eq("organization_id", orgId).maybeSingle(),
    admin.from("social_posts").select("scheduled_at").eq("organization_id", orgId).in("status", ["draft", "scheduled"]).gte("scheduled_at", new Date().toISOString()),
    admin.from("social_posts").select("body").eq("organization_id", orgId).order("created_at", { ascending: false }).limit(10),
  ]);
  const { zonedParts } = await import("./brain-core");
  const takenDays = ((taken ?? []) as { scheduled_at: string }[]).map((r) => {
    const p = zonedParts(new Date(r.scheduled_at), org.tz);
    return `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
  });
  const slots = weekSlots({ now: new Date(), tz: org.tz, postTime: s.post_time, days: s.days, count: Math.max(1, Math.min(7, count)), taken: takenDays });
  if (!slots.length) return { ok: false, error: "social.brain.weekFull" };
  const pillars = pillarsFor(org.locale, s.pillars);
  const hol = s.holidays ? upcomingHolidays(slots[0]!.date, 8).map((h) => `${h.date}: ${h.en}`).join("; ") : "";
  const { runAISystem } = await import("@/lib/ai/run-system");
  const { marketingCopyRules } = await import("@/lib/ai/brain-pro");
  const out = await runAISystem({
    orgId,
    feature: "marketing",
    agentId: org.agent?.id ?? null,
    provider: (org.agent?.provider as "openai" | "anthropic" | "gemini" | null) ?? undefined,
    model: org.agent?.model ?? undefined,
    system: [
      `You are the senior social media manager of "${org.name}". Business information:\n${(org.agent?.instructions ?? "").slice(0, 5000)}`,
      social?.brand_voice ? `Brand voice: ${String(social.brand_voice).slice(0, 800)}` : "",
      marketingCopyRules(),
      brainBrief(learned),
      s.avoid ? `Never use these words or topics: ${s.avoid}` : "",
      ((recentRows ?? []) as { body: string }[]).length ? `Recent posts (do not repeat):\n${((recentRows ?? []) as { body: string }[]).map((r) => `- ${r.body.replace(/\s+/g, " ").slice(0, 120)}`).join("\n")}` : "",
      hol ? `Upcoming dates: ${hol}. Use one only if it fits naturally; never invent offers.` : "",
    ]
      .filter(Boolean)
      .join("\n\n"),
    messages: [
      {
        role: "user",
        content: `Plan ${slots.length} posts (one per day: ${slots.map((x) => x.date).join(", ")}) in ${langName(org.locale)}, tone ${s.tone}. Rotate these content pillars: ${pillars.join(" | ")}. Each post: hook line, 2-5 short lines, one call to action, hashtags last. Answer JSON ONLY: [{"post": "...", "pillar": "...", "scene": "English photo description", "headline": "3-7 words"}]`,
      },
    ],
    temperature: 0.8,
    maxTokens: 3500,
    patienceMs: 25_000,
  });
  if (!out.ok) return { ok: false, error: out.error };
  let plan = parseWeekPlan(out.text, slots.length);
  // upgrade 4: only when the strict parser found nothing — recover every complete post from a slightly broken / cut-off answer
  if (!plan.length) {
    const { parseWeekPlanTolerant } = await import("@/lib/team/json-repair-core");
    plan = parseWeekPlanTolerant(out.text, slots.length);
  }
  if (!plan.length) return { ok: false, error: "ai.failed" };
  const primary: "facebook" | "instagram" = s.platforms.includes("instagram") ? "instagram" : "facebook";
  const rows = plan.map((p, i) => ({
    organization_id: orgId,
    platforms: ["facebook"],
    body: mergeHashtags(p.post, s.hashtags, primary).slice(0, 5000),
    scheduled_at: slots[i]!.at.toISOString(),
    status: "draft",
    source: "agent",
    origin: "week",
    pillar: p.pillar ?? pillars[i % pillars.length]!,
    headline: p.headline,
    cta_type: s.cta_type,
    cta_value: s.cta_value,
    media_pending: s.media === "none" ? null : mediaForDate(s.media, slots[i]!.date) === "video" ? "video" : "image",
    telegram_chat: s.telegram_chat,
  }));
  const { error } = await admin.from("social_posts").insert(rows);
  if (error) return { ok: false, error: "errors.generic" };
  return { ok: true, count: rows.length };
}

/** Real engagement of recently published posts → stored on the post, then the brain re-learns. */
export async function syncPostMetrics(budgetMs = 15_000): Promise<{ updated: number; brains: number }> {
  const started = Date.now();
  const admin = createAdminClient();
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const stale = new Date(Date.now() - 6 * 3_600_000).toISOString();
  const { data } = await admin
    .from("social_posts")
    .select("id, organization_id, results, metrics_at")
    .in("status", ["published", "partial"])
    .gte("scheduled_at", since)
    .or(`metrics_at.is.null,metrics_at.lt.${stale}`)
    .order("metrics_at", { ascending: true, nullsFirst: true })
    .limit(15);
  const { fetchPostMetrics } = await import("@/lib/channels/meta-pages");
  const { loadAccountById } = await import("./accounts");
  const tokens = new Map<string, string | null>();
  const touched = new Set<string>();
  let updated = 0;
  for (const p of (data ?? []) as { id: string; organization_id: string; results: Record<string, { ok?: boolean; id?: string }> }[]) {
    if (Date.now() - started > budgetMs) break;
    const per: (PostMetrics | null)[] = [];
    for (const platform of ["facebook", "instagram"] as const) {
      const r = p.results?.[platform];
      if (!r?.ok || !r.id) continue;
      const key = `${p.organization_id}:${platform}`;
      if (!tokens.has(key)) {
        const { data: acc } = await admin.from("channel_accounts").select("id").eq("organization_id", p.organization_id).eq("kind", platform === "instagram" ? "instagram" : "messenger").maybeSingle();
        const full = acc ? await loadAccountById(acc.id as string) : null;
        tokens.set(key, full?.secrets.page_token ?? null);
      }
      const token = tokens.get(key);
      if (!token) continue;
      const m = await fetchPostMetrics({ platform, id: r.id, pageToken: token });
      if (m.ok && m.metrics) per.push(m.metrics);
    }
    const metrics = sumMetrics(per);
    await admin.from("social_posts").update({ metrics, engagement: engagementScore(metrics), metrics_at: new Date().toISOString() }).eq("id", p.id);
    updated++;
    touched.add(p.organization_id);
  }
  let brains = 0;
  for (const org of touched) {
    if (Date.now() - started > budgetMs + 5_000) break;
    if (await refreshBrain(org)) brains++;
  }
  return { updated, brains };
}

/** Re-learns from the business's last 60 measured posts. */
export async function refreshBrain(orgId: string): Promise<boolean> {
  const admin = createAdminClient();
  const [{ data }, { data: org }] = await Promise.all([
    admin.from("social_posts").select("body, scheduled_at, pillar, image_url, video_url, engagement").eq("organization_id", orgId).not("engagement", "is", null).order("scheduled_at", { ascending: false }).limit(60),
    admin.from("organizations").select("timezone").eq("id", orgId).maybeSingle(),
  ]);
  const rows = ((data ?? []) as { body: string; scheduled_at: string; pillar: string | null; image_url: string | null; video_url: string | null; engagement: number }[]).map((r) => ({
    body: r.body,
    scheduled_at: r.scheduled_at,
    pillar: r.pillar,
    media: (r.video_url ? "video" : r.image_url ? "image" : "text") as "image" | "video" | "text",
    engagement: r.engagement,
  }));
  const tz = (org?.timezone as string | null) || "Asia/Jerusalem";
  const base = learnFromPosts(rows, tz);
  // deeper patterns (hooks, weekdays, emojis, calls to action, hashtag count) — stored with the rest
  const { deeperLearning } = await import("./brain-plus-core");
  const learned = { ...base, deep: deeperLearning(rows, tz) };
  const { error } = await admin.from("social_brain").upsert({ organization_id: orgId, learned, posts_analyzed: learned.posts, learned_at: new Date().toISOString() }, { onConflict: "organization_id" });
  return !error;
}

/** The same post in the business's Telegram channel (the business's own bot must be an admin there). */
export async function publishTelegram(orgId: string, chat: string, post: { body: string; image_url: string | null; video_url?: string | null }): Promise<{ ok: boolean; id?: string; error?: string }> {
  const { loadAccount } = await import("@/lib/channels/accounts");
  const acc = await loadAccount(orgId, "telegram");
  const token = acc?.secrets.bot_token;
  if (!token) return { ok: false, error: "telegram_not_connected" };
  const { telegramCall } = await import("@/lib/channels/providers");
  const r = post.video_url
    ? await telegramCall(token, "sendVideo", { chat_id: chat, video: post.video_url, caption: telegramCaption(post.body, true), supports_streaming: true })
    : post.image_url
      ? await telegramCall(token, "sendPhoto", { chat_id: chat, photo: post.image_url, caption: telegramCaption(post.body, true) })
      : await telegramCall(token, "sendMessage", { chat_id: chat, text: telegramCaption(post.body, false) });
  return r.ok ? { ok: true, id: r.externalId } : { ok: false, error: r.error };
}
