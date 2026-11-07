import Link from "next/link";
import type { Metadata } from "next";
import { Card, EmptyState, PageHeader } from "@/components/ui/primitives";
import { SocialClient, type BrainView, type CommentRow, type PostRow, type ReviewRow, type SocialSettingsView } from "@/components/social/social-client";
import { getOrgContext } from "@/lib/auth";
import { getT, resolveLocale } from "@/lib/i18n/server";
import { createClient } from "@/lib/supabase/server";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { t } = await getT(await resolveLocale(params));
  return { title: t("social.title") };
}

/** Wave 19 — comments under the business's posts, the content calendar and Google reviews, with AI drafts. */
export default async function SocialPage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = await resolveLocale(params);
  const ctx = await getOrgContext(locale);
  const { t } = await getT(locale);
  if (!ctx.can("inbox.read")) {
    return (
      <Card>
        <EmptyState title={t("errors.forbidden")} />
      </Card>
    );
  }
  const supabase = await createClient();
  const [{ data: comments }, { data: posts }, { data: reviews }, { data: settings }, { data: accounts }] = await Promise.all([
    supabase.from("social_comments").select("id, platform, author_name, body, sentiment, ai_draft, reply_text, status, created_at").eq("organization_id", ctx.org.id).order("created_at", { ascending: false }).limit(100),
    ctx.can("campaigns.manage")
      ? supabase.from("social_posts").select("id, platforms, body, image_url, scheduled_at, status, source, results, link_url, video_url, cta_type, cta_value, first_comment, created_at").eq("organization_id", ctx.org.id).neq("status", "canceled").order("scheduled_at", { ascending: false }).order("created_at", { ascending: false }).limit(60)
      : Promise.resolve({ data: [] }),
    supabase.from("reviews").select("id, source, author, rating, body, reply, ai_draft, status, reviewed_at").eq("organization_id", ctx.org.id).order("reviewed_at", { ascending: false, nullsFirst: false }).limit(60),
    supabase.from("social_settings").select("comment_drafts, comment_auto_reply, comment_private_reply, hide_spam, posts_per_week, brand_voice").eq("organization_id", ctx.org.id).maybeSingle(),
    supabase.from("channel_accounts").select("kind, name").eq("organization_id", ctx.org.id).in("kind", ["messenger", "instagram"]),
  ]);
  let google: { connected: boolean; autoReplyPositive: boolean } = { connected: false, autoReplyPositive: false };
  if (process.env.SUPABASE_SERVICE_ROLE_KEY) {
    const { listIntegrations } = await import("@/lib/integrations/store");
    const g = (await listIntegrations(ctx.org.id, ["google_business"])).google_business;
    google = { connected: Boolean(g && g.status === "active"), autoReplyPositive: Boolean((g?.config as { auto_reply_positive?: boolean } | undefined)?.auto_reply_positive) };
  }
  const acc = (accounts ?? []) as { kind: string; name: string }[];
  // wave 61 — the social brain (separate, failure-tolerant reads: the page works even before the migration ran)
  let brain: BrainView | null = null;
  let postsPlus = (posts ?? []) as PostRow[];
  if (ctx.can("campaigns.manage")) {
    const { AUTOPILOT_DEFAULTS, normalizeAutopilot } = await import("@/lib/social/brain-core");
    const [ap, br, extra, top, rv, tg, org] = await Promise.all([
      supabase.from("social_autopilot").select("enabled, mode, post_time, days, platforms, media, style, tone, pillars, hashtags, avoid, cta_type, cta_value, holidays, reviews_to_posts, telegram_chat, last_planned_for, last_error").eq("organization_id", ctx.org.id).maybeSingle(),
      supabase.from("social_brain").select("learned").eq("organization_id", ctx.org.id).maybeSingle(),
      supabase.from("social_posts").select("id, pillar, origin, engagement, metrics, media_pending").eq("organization_id", ctx.org.id).neq("status", "canceled").order("scheduled_at", { ascending: false }).limit(60),
      supabase.from("social_posts").select("id, body, engagement, image_url").eq("organization_id", ctx.org.id).in("status", ["published", "partial"]).not("engagement", "is", null).order("engagement", { ascending: false }).limit(3),
      supabase.from("reviews").select("id, author, body, rating").eq("organization_id", ctx.org.id).gte("rating", 5).order("reviewed_at", { ascending: false, nullsFirst: false }).limit(5),
      supabase.from("channel_accounts").select("id").eq("organization_id", ctx.org.id).eq("kind", "telegram").maybeSingle(),
      supabase.from("organizations").select("name").eq("id", ctx.org.id).maybeSingle(),
    ]);
    const apRow = ap.error ? null : (ap.data as Record<string, unknown> | null);
    const settingsAp = apRow ? { ...normalizeAutopilot(apRow), enabled: Boolean(apRow.enabled), last_planned_for: (apRow.last_planned_for as string | null) ?? null, last_error: (apRow.last_error as string | null) ?? null } : { ...AUTOPILOT_DEFAULTS };
    const learned = br.error ? null : ((br.data?.learned ?? null) as BrainView["learned"]);
    if (!extra.error && extra.data) {
      const byId = new Map((extra.data as { id: string }[]).map((x) => [x.id, x]));
      postsPlus = postsPlus.map((x) => ({ ...x, ...(byId.get(x.id) ?? {}) }));
    }
    // post hygiene — the AI employee who wrote each post (its own failure-tolerant read: before the column exists the board
    // shows the generic "written by the AI" label)
    const agentIds = postsPlus.filter((x) => x.source === "agent").map((x) => x.id);
    if (agentIds.length) {
      const names = await supabase.from("social_posts").select("id, agent_name").eq("organization_id", ctx.org.id).in("id", agentIds);
      if (!names.error && names.data) {
        const nameById = new Map((names.data as { id: string; agent_name: string | null }[]).map((x) => [x.id, x.agent_name]));
        postsPlus = postsPlus.map((x) => (nameById.get(x.id) ? { ...x, agent_name: nameById.get(x.id) ?? null } : x));
      }
    }
    const { stockVideoConfigured } = await import("@/lib/social/stock-video");
    brain = {
      settings: settingsAp,
      learned: learned && typeof learned.posts === "number" ? learned : null,
      topPosts: top.error ? [] : ((top.data ?? []) as BrainView["topPosts"]),
      reviews: ((rv.data ?? []) as BrainView["reviews"]).filter((r) => (r.body ?? "").length >= 20),
      telegramBot: Boolean(tg.data),
      videoReady: stockVideoConfigured(),
      brand: String((org.data as { name?: string } | null)?.name ?? ""),
    };
    if (ap.error) brain = null;
  }
  const view: SocialSettingsView = {
    comment_drafts: settings?.comment_drafts ?? true,
    comment_auto_reply: settings?.comment_auto_reply ?? false,
    comment_private_reply: settings?.comment_private_reply ?? true,
    hide_spam: settings?.hide_spam ?? true,
    posts_per_week: settings?.posts_per_week ?? 3,
    brand_voice: (settings?.brand_voice as string | null) ?? "",
  };
  return (
    <>
      <PageHeader
        title={t("social.title")}
        description={t("social.subtitle")}
        actions={
          <Link href={`/${locale}/integrations#marketplace`} className="inline-flex h-10 items-center rounded-xl border border-line px-4 text-sm hover:bg-surface-hover">
            {t("social.connections")}
          </Link>
        }
      />
      <SocialClient
        comments={(comments ?? []) as CommentRow[]}
        posts={postsPlus}
        reviews={(reviews ?? []) as ReviewRow[]}
        settings={view}
        facebook={acc.find((a) => a.kind === "messenger")?.name ?? null}
        instagram={acc.find((a) => a.kind === "instagram")?.name ?? null}
        google={google}
        canReply={ctx.can("inbox.reply")}
        canPost={ctx.can("campaigns.manage")}
        canSettings={ctx.can("settings.manage") || ctx.can("campaigns.manage")}
        brain={brain}
      />
    </>
  );
}
