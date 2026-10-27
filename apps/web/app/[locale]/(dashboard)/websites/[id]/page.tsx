import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ArrowLeft, ArrowRight, Eye } from "lucide-react";
import { uuidSchema } from "@scc/shared/validators";
import type { SiteBlockType } from "@scc/shared/engagement";
import { Card, EmptyState, PageHeader } from "@/components/ui/primitives";
import { SiteBuilder, type BlockValue } from "@/components/websites/site-builder";
import { ConfirmDeleteSite } from "@/components/websites/delete-site";
import { DomainPanel } from "@/components/websites/domain-panel";
import { AbTestCard } from "@/components/websites/growth-tools";
import type { AbStats, SiteAb } from "@/lib/site/ab-core";
import type { SitePages, SiteSettings } from "@/components/websites/business-panel";
import { getOrgContext } from "@/lib/auth";
import { getT, resolveLocale } from "@/lib/i18n/server";
import { createClient } from "@/lib/supabase/server";
import { siteEmbedOptions, sitePublicBase } from "@/lib/websites";
import { aiSiteCaps } from "@/lib/ai/site-builder";
import { formatNumber } from "@/lib/format";

/** wave 34: the agent / AI site actions run from this page — a full-site answer can take well over the platform default */
export const maxDuration = 60;

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
  const theme = (s.theme ?? {}) as { accent?: string; mode?: "dark" | "light"; template?: string; accent2?: string; font?: string; radius?: "sharp" | "soft" | "round"; animations?: boolean };
  // wave 13: domain panel data
  const { domainsConfigured } = await import("@/lib/site/domains");
  const { paypalSdkConfig } = await import("@/lib/billing/paypal");
  const { data: domainOrders } = await supabase.from("domain_orders").select("id, domain, status, price, currency, created_at, error").eq("organization_id", ctx.org.id).eq("site_id", id).order("created_at", { ascending: false }).limit(10);
  const platformUrl = `${sitePublicBase(locale)}/${s.slug as string}`;
  const customActive = s.custom_domain && s.domain_status === "active" ? `https://${s.custom_domain as string}` : null;
  const verification = (s.domain_verification ?? {}) as { records?: { type: string; name: string; value: string }[] };
  const seo = (s.seo ?? {}) as { title?: string; description?: string };
  // wave 17: A/B test of the hero
  const { orgHasFeature } = await import("@/lib/billing/features");
  const abAllowed = await orgHasFeature(ctx.org.id, "ab_testing");
  const ab = (s.ab ?? null) as SiteAb | null;
  const abStats = ab?.started_at ? (((await supabase.rpc("site_ab_stats", { p_site: id })).data ?? null) as AbStats | null) : null;
  const heroBlock = ((s.blocks ?? []) as { type: string; data: Record<string, string> }[]).find((b) => b.type === "hero");
  const hero = heroBlock ? { title: heroBlock.data.title ?? "", subtitle: heroBlock.data.subtitle ?? "", cta_label: heroBlock.data.cta_label ?? "" } : null;
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
        proTemplates={Boolean(caps.proTemplates)}
        aiEditor={Boolean(caps.aiEditor) && ctx.can("ai.use")}
        liveUrl={customActive ?? undefined}
        aiCopy={ctx.can("ai.use")}
        domainSlot={
          <DomainPanel
            siteId={id}
            published={s.status === "published"}
            publicUrl={customActive ?? platformUrl}
            allowed={Boolean(caps.customDomain)}
            configured={domainsConfigured()}
            domain={(s.custom_domain as string | null) ?? null}
            status={(s.domain_status as "pending" | "active" | "error" | null) ?? null}
            records={verification.records ?? []}
            orders={((domainOrders ?? []) as { id: string; domain: string; status: string; price: number; currency: string; created_at: string; error: string | null }[]).map((o) => ({ ...o, price: Number(o.price) }))}
            sdk={paypalSdkConfig()}
          />
        }
        initial={{
          name: s.name as string,
          slug: s.slug as string,
          status: s.status as "draft" | "published",
          theme: {
            accent: theme.accent ?? "#3366E6",
            mode: theme.mode === "light" ? "light" : "dark",
            ...(theme.template ? { template: theme.template } : {}),
            ...(theme.accent2 ? { accent2: theme.accent2 } : {}),
            ...(theme.font ? { font: theme.font } : {}),
            ...(theme.radius ? { radius: theme.radius } : {}),
            ...(theme.animations === false ? { animations: false } : {}),
          },
          settings: (s.settings ?? {}) as SiteSettings,
          pages: (s.pages ?? {}) as SitePages,
          seo: { title: seo.title ?? "", description: seo.description ?? "" },
          blocks: ((s.blocks ?? []) as { type: SiteBlockType; data: BlockValue["data"] }[]).map((b) => ({ type: b.type, data: b.data ?? {} })),
        }}
      />
      <div className="mt-4">
        <AbTestCard siteId={id} ab={ab} stats={abStats} hero={hero} allowed={abAllowed} aiAllowed={ctx.can("ai.use")} />
      </div>
    </>
  );
}
