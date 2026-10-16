import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ArrowLeft, ArrowRight, Eye } from "lucide-react";
import { uuidSchema } from "@scc/shared/validators";
import type { SiteBlockType } from "@scc/shared/engagement";
import { Card, EmptyState, PageHeader } from "@/components/ui/primitives";
import { SiteBuilder, type BlockValue } from "@/components/websites/site-builder";
import { ConfirmDeleteSite } from "@/components/websites/delete-site";
import { getOrgContext } from "@/lib/auth";
import { getT, resolveLocale } from "@/lib/i18n/server";
import { createClient } from "@/lib/supabase/server";
import { siteEmbedOptions, sitePublicBase } from "@/lib/websites";
import { aiSiteCaps } from "@/lib/ai/site-builder";
import { formatNumber } from "@/lib/format";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { t } = await getT(await resolveLocale(params));
  return { title: t("websites.title") };
}

export default async function SitePage({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const locale = await resolveLocale(params);
  const { id } = await params;
  if (!uuidSchema.safeParse(id).success) notFound();
  const ctx = await getOrgContext(locale);
  const { t } = await getT(locale);
  if (!ctx.can("websites.manage")) {
    return (
      <Card>
        <EmptyState title={t("errors.forbidden")} />
      </Card>
    );
  }
  const supabase = await createClient();
  const { data: s } = await supabase.from("sites").select("*").eq("id", id).eq("organization_id", ctx.org.id).maybeSingle();
  if (!s) notFound();
  const embeds = await siteEmbedOptions(ctx.org.id);
  const caps = await aiSiteCaps(ctx.org.id);
  const Back = locale === "en" ? ArrowLeft : ArrowRight;
  const theme = (s.theme ?? {}) as { accent?: string; mode?: "dark" | "light" };
  const seo = (s.seo ?? {}) as { title?: string; description?: string };
  return (
    <>
      <Link href={`/${locale}/websites`} className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted hover:text-fg">
        <Back className="h-4 w-4" /> {t("websites.title")}
      </Link>
      <PageHeader
        title={s.name as string}
        description={t("websites.editHint")}
        actions={
          <div className="flex items-center gap-3">
            <span className="inline-flex items-center gap-1 text-[13px] text-muted">
              <Eye className="h-4 w-4" /> {t("websites.visits", { count: formatNumber(locale, Number(s.visits)) })}
            </span>
            <Link href={`/${locale}/websites/${id}/preview`} className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-line px-3 text-sm hover:bg-surface-hover">
              <Eye className="h-4 w-4" /> {t("ai.sitePreview")}
            </Link>
            <ConfirmDeleteSite id={id} redirectTo={`/${locale}/websites`} />
          </div>
        }
      />
      <SiteBuilder
        id={id}
        forms={embeds.forms}
        bookings={embeds.bookings}
        publicBase={sitePublicBase(locale)}
        aiImages={caps.images && ctx.can("ai.use")}
        initial={{
          name: s.name as string,
          slug: s.slug as string,
          status: s.status as "draft" | "published",
          theme: { accent: theme.accent ?? "#3366E6", mode: theme.mode === "light" ? "light" : "dark" },
          seo: { title: seo.title ?? "", description: seo.description ?? "" },
          blocks: ((s.blocks ?? []) as { type: SiteBlockType; data: BlockValue["data"] }[]).map((b) => ({ type: b.type, data: b.data ?? {} })),
        }}
      />
    </>
  );
}
