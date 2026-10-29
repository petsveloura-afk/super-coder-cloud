import Link from "next/link";
import type { Metadata } from "next";
import { Eye, Globe, LayoutTemplate, Megaphone, Plus, Sparkles } from "lucide-react";
import { Badge, Card, EmptyState, Input, PageHeader, Select } from "@/components/ui/primitives";
import { ConfirmDeleteSite } from "@/components/websites/delete-site";
import { DuplicateSite } from "@/components/websites/duplicate-site";
import { SiteSelectBox, SitesBulkBar } from "@/components/websites/sites-bulk";
import { getOrgContext } from "@/lib/auth";
import { getT, resolveLocale } from "@/lib/i18n/server";
import { createClient } from "@/lib/supabase/server";
import { sitePublicBase } from "@/lib/websites";
import { ScreenPulse } from "@/components/ui/screen-pulse";
import { sitesPulse } from "@/lib/insights/screens-core";
import { formatDateTime, formatNumber } from "@/lib/format";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { t } = await getT(await resolveLocale(params));
  return { title: t("websites.title") };
}

export default async function WebsitesPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams?: Promise<{ q?: string; status?: string }> }) {
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
  const all = data ?? [];
  // wave 31: search + status filter (server-side, works without JS) and a summary bar
  const sp = (await searchParams) ?? {};
  const q = String(sp.q ?? "").trim().toLowerCase().slice(0, 80);
  const st = sp.status === "published" || sp.status === "draft" ? sp.status : "";
  const rows = all.filter((x) => (!st || x.status === st) && (!q || String(x.name).toLowerCase().includes(q) || String(x.slug).toLowerCase().includes(q)));
  const published = all.filter((x) => x.status === "published").length;
  const totalVisits = all.reduce((a, x) => a + Number(x.visits ?? 0), 0);
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
      {/* wave 53 — smart tips (the summary bar already shows the numbers) */}
      <ScreenPulse screen="sites" pulse={{ ...sitesPulse(all.map((x) => ({ status: String(x.status), visits: Number(x.visits ?? 0) }))), stats: [] }} locale={locale} t={t} />
      <div className="mb-3 grid gap-2 sm:grid-cols-3" data-testid="sites-quick-create">
        {[
          { href: `/${locale}/websites/new`, icon: <Sparkles className="h-4 w-4" />, title: t("websites.quick.ai"), body: t("websites.quick.aiBody") },
          { href: `/${locale}/websites/new`, icon: <LayoutTemplate className="h-4 w-4" />, title: t("websites.quick.template"), body: t("websites.quick.templateBody") },
          { href: `/${locale}/campaigns`, icon: <Megaphone className="h-4 w-4" />, title: t("websites.quick.campaign"), body: t("websites.quick.campaignBody") },
        ].map((q) => (
          <Link key={q.title} href={q.href} className="flex items-start gap-2.5 rounded-2xl border border-line bg-surface p-3 transition hover:border-accent">
            <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent">{q.icon}</span>
            <span className="min-w-0">
              <span className="block text-sm font-semibold">{q.title}</span>
              <span className="block text-[12.5px] text-muted">{q.body}</span>
            </span>
          </Link>
        ))}
      </div>
      {all.length > 0 ? (
        <>
          <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4" data-testid="sites-metrics">
            {[
              [t("websites.list.total"), formatNumber(locale, all.length)],
              [t("websites.list.published"), formatNumber(locale, published)],
              [t("websites.list.drafts"), formatNumber(locale, all.length - published)],
              [t("websites.list.visits"), formatNumber(locale, totalVisits)],
            ].map(([label, val]) => (
              <Card key={label} className="p-3">
                <p className="text-[12px] text-muted">{label}</p>
                <p className="text-xl font-semibold">{val}</p>
              </Card>
            ))}
          </div>
          <form method="get" className="mb-3 flex flex-wrap gap-2" role="search">
            <Input name="q" defaultValue={sp.q ?? ""} placeholder={t("websites.list.search")} aria-label={t("websites.list.search")} className="max-w-xs" />
            <Select name="status" defaultValue={st} aria-label={t("websites.list.status")} className="w-auto">
              <option value="">{t("websites.list.allStatuses")}</option>
              <option value="published">{t("websites.statuses.published")}</option>
              <option value="draft">{t("websites.statuses.draft")}</option>
            </Select>
            <button type="submit" className="inline-flex h-11 items-center rounded-xl border border-line px-4 text-sm hover:border-accent">
              {t("websites.list.apply")}
            </button>
          </form>
        </>
      ) : null}
      {all.length > 0 && rows.length === 0 ? (
        <Card>
          <EmptyState icon={<Globe className="h-6 w-6" />} title={t("websites.list.noMatch")} />
        </Card>
      ) : rows.length === 0 ? (
        <Card>
          <EmptyState icon={<Globe className="h-6 w-6" />} title={t("websites.empty")} body={t("websites.emptyBody")} />
        </Card>
      ) : (
        <>
        <SitesBulkBar allIds={rows.map((x) => x.id as string)} />
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {rows.map((s) => (
            <Card key={s.id as string} className="flex flex-col gap-3 p-4" data-site={s.slug as string}>
              <div className="flex items-start justify-between gap-2">
                <SiteSelectBox id={s.id as string} label={t("websites.bulk.selectOne", { name: String(s.name) })} />
                <Link href={`/${locale}/websites/${s.id}`} className="min-w-0 flex-1 font-semibold hover:underline">
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
                <DuplicateSite id={s.id as string} />
                <span className="flex-1" />
                <ConfirmDeleteSite id={s.id as string} />
              </div>
            </Card>
          ))}
        </div>
        </>
      )}
    </>
  );
}
