import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ArrowLeft, ArrowRight, ExternalLink, Pencil } from "lucide-react";
import { uuidSchema } from "@scc/shared/validators";
import type { FormField, SiteBlock } from "@scc/shared/engagement";
import { Badge, Card, EmptyState } from "@/components/ui/primitives";
import { SiteRenderer } from "@/components/websites/site-renderer";
import { getOrgContext } from "@/lib/auth";
import { getT, resolveLocale } from "@/lib/i18n/server";
import { createClient } from "@/lib/supabase/server";
import { sitePublicBase } from "@/lib/websites";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { t } = await getT(await resolveLocale(params));
  return { title: t("websites.previewTitle"), robots: { index: false } };
}

/** Members-only preview of any site (drafts included) — exactly how visitors will see it. */
export default async function SitePreviewPage({ params }: { params: Promise<{ locale: string; id: string }> }) {
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
  const { data: s } = await supabase.from("sites").select("id, name, slug, status, theme, blocks").eq("id", id).eq("organization_id", ctx.org.id).maybeSingle();
  if (!s) notFound();
  const blocks = (s.blocks ?? []) as SiteBlock[];
  const formSlugs = [...new Set(blocks.filter((b) => b.type === "form").map((b) => (b.type === "form" ? b.data.form_slug : "")).filter(Boolean))];
  const forms = new Map<string, { name: string; fields: FormField[]; settings: Record<string, string>; org: string }>();
  if (formSlugs.length) {
    const { data } = await supabase.from("forms").select("slug, name, fields, settings").eq("organization_id", ctx.org.id).in("slug", formSlugs);
    for (const f of data ?? []) forms.set(f.slug as string, { name: f.name as string, fields: f.fields as FormField[], settings: (f.settings ?? {}) as Record<string, string>, org: ctx.org.name });
  }
  const Back = locale === "en" ? ArrowLeft : ArrowRight;
  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Link href={`/${locale}/websites/${id}`} className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-fg">
          <Back className="h-4 w-4" /> {t("websites.title")}
        </Link>
        <span className="flex-1" />
        <Badge tone={s.status === "published" ? "success" : "neutral"}>{t(`websites.statuses.${s.status}`)}</Badge>
        <Link href={`/${locale}/websites/${id}`} className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-line px-3 text-sm hover:bg-surface-hover">
          <Pencil className="h-4 w-4" /> {t("ai.siteEdit")}
        </Link>
        {s.status === "published" ? (
          <a href={`${sitePublicBase(locale)}/${s.slug}`} target="_blank" rel="noreferrer" className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-accent-solid px-3 text-sm text-accent-fg">
            <ExternalLink className="h-4 w-4" /> {t("websites.view")}
          </a>
        ) : null}
      </div>
      <div className="overflow-hidden rounded-3xl border border-line shadow-card" data-testid="site-preview">
        <SiteRenderer site={{ name: s.name as string, theme: (s.theme ?? {}) as { accent?: string; mode?: "dark" | "light" }, blocks }} forms={forms} locale={locale} t={t} />
      </div>
    </>
  );
}
