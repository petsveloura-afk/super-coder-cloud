import Link from "next/link";
import type { Metadata } from "next";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { Card, EmptyState, PageHeader } from "@/components/ui/primitives";
import { SiteBuilder } from "@/components/websites/site-builder";
import { getOrgContext } from "@/lib/auth";
import { getT, resolveLocale } from "@/lib/i18n/server";
import { siteEmbedOptions, sitePublicBase } from "@/lib/websites";
import { aiSiteCaps } from "@/lib/ai/site-builder";
import { AiSiteCard } from "@/components/websites/ai-site-card";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { t } = await getT(await resolveLocale(params));
  return { title: t("websites.new") };
}

export default async function NewSitePage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = await resolveLocale(params);
  const ctx = await getOrgContext(locale);
  const { t } = await getT(locale);
  if (!ctx.can("websites.manage")) {
    return (
      <Card>
        <EmptyState title={t("errors.forbidden")} />
      </Card>
    );
  }
  const embeds = await siteEmbedOptions(ctx.org.id);
  const caps = await aiSiteCaps(ctx.org.id);
  const Back = locale === "en" ? ArrowLeft : ArrowRight;
  const slug = `${ctx.org.slug}-site`.replace(/[^a-z0-9-]/g, "-").slice(0, 50);
  return (
    <>
      <Link href={`/${locale}/websites`} className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted hover:text-fg">
        <Back className="h-4 w-4" /> {t("websites.title")}
      </Link>
      <PageHeader title={t("websites.new")} description={t("websites.newHint")} />
      {ctx.can("ai.use") ? <AiSiteCard caps={{ full: caps.full, images: caps.images, proTemplates: Boolean(caps.proTemplates) }} /> : null}
      <SiteBuilder
        forms={embeds.forms}
        bookings={embeds.bookings}
        publicBase={sitePublicBase(locale)}
        aiImages={caps.images && ctx.can("ai.use")}
        proTemplates={Boolean(caps.proTemplates)}
        aiEditor={Boolean(caps.aiEditor) && ctx.can("ai.use")}
        initial={{
          name: ctx.org.name,
          slug,
          status: "draft",
          theme: { accent: "#3366E6", mode: "dark" },
          seo: { title: ctx.org.name, description: "" },
          blocks: [
            { type: "hero", data: { title: ctx.org.name, subtitle: t("websites.sampleSubtitle"), cta_label: t("websites.sampleCta"), cta_href: "#contact", image_url: "" } },
            { type: "features", data: { title: t("websites.sampleFeatures"), items: [{ title: "", text: "" }] } },
            { type: "contact", data: { title: t("websites.blocks.contact"), phone: "", whatsapp: "", email: "", address: "" } },
          ],
        }}
      />
    </>
  );
}
