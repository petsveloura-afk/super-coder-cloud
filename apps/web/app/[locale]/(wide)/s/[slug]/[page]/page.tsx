import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { SiteRenderer } from "@/components/websites/site-renderer";
import { getT, resolveLocale } from "@/lib/i18n/server";
import { LEGAL_KEYS, LEGAL_TITLES, type LegalKey } from "@/lib/site/legal";
import { loadPublicSite, siteBasePath } from "@/lib/site/public";

/** Wave 13 — legal pages of a published website: /s/{slug}/privacy | terms | accessibility | cookies */
type Params = Promise<{ locale: string; slug: string; page: string }>;
const isLegal = (p: string): p is LegalKey => (LEGAL_KEYS as readonly string[]).includes(p);

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { slug, page, locale } = await params;
  if (!isLegal(page)) return { title: "404" };
  const s = await loadPublicSite(slug);
  if (!s) return { title: "404" };
  const lang = (typeof s.settings?.lang === "string" ? s.settings.lang : locale) as "he" | "en" | "ar";
  return { title: { absolute: `${LEGAL_TITLES[lang === "en" || lang === "ar" ? lang : "he"][page]} · ${s.name}` } };
}

export default async function SiteLegalPage({ params }: { params: Params }) {
  const locale = await resolveLocale(params);
  const { slug, page } = await params;
  if (!isLegal(page)) notFound();
  const site = await loadPublicSite(slug);
  if (!site) notFound();
  const { t } = await getT(locale);
  return <SiteRenderer site={{ ...site, slug }} forms={new Map()} locale={locale} t={t} legal={page} basePath={await siteBasePath(locale, slug)} branding={site.branding !== false} />;
}
