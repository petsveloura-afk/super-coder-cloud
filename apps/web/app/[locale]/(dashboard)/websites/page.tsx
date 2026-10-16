import Link from "next/link";
import type { Metadata } from "next";
import { Eye, Globe, Plus } from "lucide-react";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui/primitives";
import { ConfirmDeleteSite } from "@/components/websites/delete-site";
import { getOrgContext } from "@/lib/auth";
import { getT, resolveLocale } from "@/lib/i18n/server";
import { createClient } from "@/lib/supabase/server";
import { sitePublicBase } from "@/lib/websites";
import { formatDateTime, formatNumber } from "@/lib/format";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { t } = await getT(await resolveLocale(params));
  return { title: t("websites.title") };
}

export default async function WebsitesPage({ params }: { params: Promise<{ locale: string }> }) {
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
  const supabase = await createClient();
  const { data } = await supabase.from("sites").select("id, name, slug, status, visits, updated_at").eq("organization_id", ctx.org.id).order("updated_at", { ascending: false }).limit(200);
  const rows = data ?? [];
  const base = sitePublicBase(locale);
  return (
    <>
      <PageHeader
        title={t("websites.title")}
        description={t("websites.subtitle")}
        actions={
          <Link href={`/${locale}/websites/new`} className="inline-flex h-10 items-center gap-2 rounded-xl bg-accent-solid px-4 text-sm font-medium text-accent-fg hover:bg-accent-solid-hover">
            <Plus className="h-4 w-4" /> {t("websites.new")}
          </Link>
        }
      />
      {rows.length === 0 ? (
        <Card>
          <EmptyState icon={<Globe className="h-6 w-6" />} title={t("websites.empty")} body={t("websites.emptyBody")} />
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {rows.map((s) => (
            <Card key={s.id as string} className="flex flex-col gap-3 p-4" data-site={s.slug as string}>
              <div className="flex items-start justify-between gap-2">
                <Link href={`/${locale}/websites/${s.id}`} className="min-w-0 font-semibold hover:underline">
                  <span className="block truncate">{s.name as string}</span>
                </Link>
                <Badge tone={s.status === "published" ? "success" : "neutral"}>{t(`websites.statuses.${s.status}`)}</Badge>
              </div>
              <p dir="ltr" className="truncate text-[12.5px] text-subtle">
                {base}/{s.slug as string}
              </p>
              <div className="flex items-center gap-3 text-[12.5px] text-muted">
                <span className="inline-flex items-center gap-1">
                  <Eye className="h-3.5 w-3.5" /> {t("websites.visits", { count: formatNumber(locale, Number(s.visits)) })}
                </span>
                <span>{formatDateTime(locale, s.updated_at as string)}</span>
              </div>
              <div className="flex items-center gap-2">
                <Link href={`/${locale}/websites/${s.id}`} className="text-sm text-accent hover:underline">
                  {t("common.edit")}
                </Link>
                {s.status === "published" ? (
                  <a href={`${base}/${s.slug}`} target="_blank" rel="noreferrer" className="text-sm text-accent hover:underline">
                    {t("websites.view")}
                  </a>
                ) : null}
                <span className="flex-1" />
                <ConfirmDeleteSite id={s.id as string} />
              </div>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
