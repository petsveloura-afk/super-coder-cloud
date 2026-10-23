import { notFound } from "next/navigation";
import type { Metadata } from "next";
import type { FormField } from "@scc/shared/engagement";
import { SiteRenderer } from "@/components/websites/site-renderer";
import { ChatWidget } from "@/components/chat/chat-widget";
import { createAnonClient } from "@/lib/supabase/anon";
import { getT, resolveLocale } from "@/lib/i18n/server";
import { visitorHash } from "@/lib/visitor";
import { loadPublicSite, siteBasePath } from "@/lib/site/public";
import { cookies } from "next/headers";
import { randomInt } from "node:crypto";
import { SiteTracker } from "@/components/websites/site-tracker";
import { AB_COOKIE, applyVariant, isVariant, pickVariant, type SiteAb } from "@/lib/site/ab-core";

type Params = Promise<{ locale: string; slug: string }>;

const load = loadPublicSite;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { slug, locale } = await params;
  const s = await load(slug);
  if (!s) return { title: "404" };
  const title = s.seo?.title || s.name;
  const description = s.seo?.description || undefined;
  const hero = s.blocks.find((b) => b.type === "hero");
  const image = hero?.type === "hero" && /^https:\/\//.test(hero.data.image_url ?? "") ? hero.data.image_url : undefined;
  const canonical = s.custom_domain ? `https://${s.custom_domain}/` : undefined;
  return {
    title: { absolute: title },
    description,
    alternates: canonical ? { canonical } : undefined,
    openGraph: { title, description, type: "website", siteName: s.name, locale: locale === "en" ? "en_US" : locale === "ar" ? "ar_AR" : "he_IL", images: image ? [{ url: image }] : undefined, url: canonical },
    twitter: { card: image ? "summary_large_image" : "summary", title, description, images: image ? [image] : undefined },
  };
}


export default async function PublicSitePage({ params }: { params: Params }) {
  const locale = await resolveLocale(params);
  const { slug } = await params;
  const site = await load(slug);
  if (!site) notFound();
  const { t } = await getT(locale);
  // one visit per visitor per day (rate-limited in the database)
  await createAnonClient().rpc("track_site_visit", { p_slug: slug, p_meta: { ip_hash: await visitorHash() } });

  // forms embedded in blocks are loaded once each
  const formSlugs = [...new Set(site.blocks.filter((b) => b.type === "form").map((b) => (b.type === "form" ? b.data.form_slug : "")).filter(Boolean))];
  const forms = new Map<string, { name: string; fields: FormField[]; settings: Record<string, string>; org: string }>();
  await Promise.all(
    formSlugs.map(async (fs) => {
      const { data } = await createAnonClient().rpc("get_public_form", { p_slug: fs });
      if (data) forms.set(fs, data as { name: string; fields: FormField[]; settings: Record<string, string>; org: string });
    }),
  );
  // wave 17: A/B test of the hero — the visitor keeps the variant he got (cookie)
  let variant: "a" | "b" | null = null;
  let abCookie: string | null = null;
  const abRes = await createAnonClient().rpc("get_public_site_ab", { p_slug: slug });
  const ab = !abRes.error ? ((abRes.data as SiteAb | null) ?? null) : null;
  if (ab?.active) {
    abCookie = AB_COOKIE(slug);
    const saved = (await cookies()).get(abCookie)?.value;
    variant = ab.winner && isVariant(ab.winner) ? ab.winner : isVariant(saved) ? saved : pickVariant(randomInt(1000) / 1000);
    site.blocks = applyVariant(site.blocks, ab, variant);
  }
  return (
    <>
      <SiteTracker slug={slug} variant={variant} abCookie={abCookie} requireConsent={site.settings?.gdpr === true} />
      <SiteRenderer site={{ ...site, slug }} forms={forms} locale={locale} t={t} basePath={await siteBasePath(locale, slug)} branding={site.branding !== false} />
      {/* AI chat with the business — shown only when an agent answers the website chat */}
      <ChatWidget orgSlug={site.org_slug} accent={site.theme?.accent} branding={site.branding !== false} />
    </>
  );
}
