import Link from "next/link";
import type { Metadata } from "next";
import { Card, EmptyState, PageHeader } from "@/components/ui/primitives";
import { SocialClient, type CommentRow, type PostRow, type ReviewRow, type SocialSettingsView } from "@/components/social/social-client";
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
      ? supabase.from("social_posts").select("id, platforms, body, image_url, scheduled_at, status, source, results").eq("organization_id", ctx.org.id).neq("status", "canceled").order("scheduled_at", { ascending: false }).limit(60)
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
        posts={(posts ?? []) as PostRow[]}
        reviews={(reviews ?? []) as ReviewRow[]}
        settings={view}
        facebook={acc.find((a) => a.kind === "messenger")?.name ?? null}
        instagram={acc.find((a) => a.kind === "instagram")?.name ?? null}
        google={google}
        canReply={ctx.can("inbox.reply")}
        canPost={ctx.can("campaigns.manage")}
        canSettings={ctx.can("settings.manage") || ctx.can("campaigns.manage")}
      />
    </>
  );
}
