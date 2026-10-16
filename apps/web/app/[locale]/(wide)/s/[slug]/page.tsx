import { notFound } from "next/navigation";
import type { Metadata } from "next";
import type { FormField, SiteBlock } from "@scc/shared/engagement";
import { SiteRenderer } from "@/components/websites/site-renderer";
import { createAnonClient } from "@/lib/supabase/anon";
import { getT, resolveLocale } from "@/lib/i18n/server";
import { visitorHash } from "@/lib/visitor";

type Params = Promise<{ locale: string; slug: string }>;

interface PublicSite {
  name: string;
  theme: { accent?: string; mode?: "dark" | "light" };
  seo: { title?: string; description?: string };
  blocks: SiteBlock[];
  org: string;
  org_slug: string;
}

async function load(slug: string): Promise<PublicSite | null> {
  if (!/^[a-z0-9][a-z0-9-]{2,60}$/.test(slug)) return null;
  const { data } = await createAnonClient().rpc("get_public_site", { p_slug: slug });
  return (data as PublicSite | null) ?? null;
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const s = await load((await params).slug);
  if (!s) return { title: "404" };
  return { title: s.seo?.title || s.name, description: s.seo?.description || undefined };
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
  return <SiteRenderer site={site} forms={forms} locale={locale} t={t} />;
}
