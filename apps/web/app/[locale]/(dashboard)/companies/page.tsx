import Link from "next/link";
import type { Metadata } from "next";
import { Briefcase, Building2, Globe, Trophy, Users } from "lucide-react";
import { Card, EmptyState, Ltr, PageHeader } from "@/components/ui/primitives";
import { NewCompanyButton } from "@/components/companies/company-form";
import { CompanySync } from "@/components/companies/company-sync";
import { COMPANY_FILTERS, COMPANY_SORTS, companyStats, sortFilterCompanies, type CompanyFilter, type CompanySort } from "@/lib/crm/companies-core";
import { getOrgContext } from "@/lib/auth";
import { getT, resolveLocale } from "@/lib/i18n/server";
import { createClient } from "@/lib/supabase/server";
import { sanitizeSearch } from "@/lib/search";
import { formatCurrency, formatDate, formatNumber } from "@/lib/format";
import { initials } from "@/lib/utils";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { t } = await getT(await resolveLocale(params));
  return { title: t("companies.title") };
}

type SP = Promise<Record<string, string | string[] | undefined>>;

export default async function CompaniesPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: SP }) {
  const locale = await resolveLocale(params);
  const ctx = await getOrgContext(locale);
  const { t } = await getT(locale);
  const sp = await searchParams;
  if (!ctx.can("companies.read")) {
    return (
      <Card>
        <EmptyState title={t("errors.forbidden")} />
      </Card>
    );
  }
  const q = sanitizeSearch(typeof sp.q === "string" ? sp.q : "");
  // round 12: sort + filter (query string, so the view can be shared / bookmarked)
  const sort: CompanySort = (COMPANY_SORTS as readonly string[]).includes(String(sp.sort)) ? (sp.sort as CompanySort) : "name";
  const filter: CompanyFilter = (COMPANY_FILTERS as readonly string[]).includes(String(sp.f)) ? (sp.f as CompanyFilter) : "all";
  const supabase = await createClient();
  let req = supabase
    .from("companies")
    .select("id, name, domain, industry, phone, created_at", { count: "exact" })
    .eq("organization_id", ctx.org.id)
    .order("name")
    .limit(200);
  if (q) req = req.or(`name.ilike.*${q}*,domain.ilike.*${q}*,industry.ilike.*${q}*`);
  const [{ data, count }, contactsRes, dealsRes] = await Promise.all([
    req,
    supabase.from("contacts").select("company_id").eq("organization_id", ctx.org.id).not("company_id", "is", null).limit(10000),
    supabase.from("deals").select("company_id, value, status").eq("organization_id", ctx.org.id).not("company_id", "is", null).limit(10000),
  ]);
  // round 12: pipeline + won value per company, sort / filter, the summary strip
  const stats = companyStats((contactsRes.data ?? []) as { company_id: string | null }[], (dealsRes.data ?? []) as { company_id: string | null; value: number | null; status: string }[]);
  const allRows = (data ?? []) as { id: string; name: string; domain: string | null; industry: string | null; phone: string | null; created_at: string }[];
  const shown = sortFilterCompanies(allRows, stats, sort, filter);
  const sumPipeline = [...stats.values()].reduce((n, x) => n + x.pipeline, 0);
  const sumWon = [...stats.values()].reduce((n, x) => n + x.won, 0);
  const withDeals = allRows.filter((r) => (stats.get(r.id)?.openDeals ?? 0) > 0).length;
  const cur = ctx.org.currency ?? "ILS";
  const qs = (patch: Record<string, string>) => {
    const u = new URLSearchParams({ ...(q ? { q } : {}), ...(sort !== "name" ? { sort } : {}), ...(filter !== "all" ? { f: filter } : {}), ...patch });
    for (const [k, v] of [...u.entries()]) if (!v || (k === "sort" && v === "name") || (k === "f" && v === "all")) u.delete(k);
    const str = u.toString();
    return `/${locale}/companies${str ? `?${str}` : ""}`;
  };
  const contactCount = new Map<string, number>();
  for (const c of contactsRes.data ?? []) contactCount.set(c.company_id as string, (contactCount.get(c.company_id as string) ?? 0) + 1);
  const openDeals = new Map<string, number>();
  for (const d of dealsRes.data ?? []) if (d.status === "open") openDeals.set(d.company_id as string, (openDeals.get(d.company_id as string) ?? 0) + 1);
  const rows = shown;

  return (
    <>
      <PageHeader title={t("companies.title")} description={t("companies.subtitle")} actions={ctx.can("companies.write") ? <NewCompanyButton defaultOpen={sp.new === "1"} /> : null} />
      {ctx.can("companies.write") && ctx.can("contacts.write") ? (
        <div className="mb-4">
          <CompanySync />
        </div>
      ) : null}
      {allRows.length ? (
        <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="companies-kpis">
          {[
            { icon: Building2, label: t("companies.kpi.total"), value: formatNumber(locale, count ?? allRows.length) },
            { icon: Briefcase, label: t("companies.kpi.withDeals"), value: formatNumber(locale, withDeals) },
            { icon: Users, label: t("companies.kpi.pipeline"), value: formatCurrency(locale, sumPipeline, cur) },
            { icon: Trophy, label: t("companies.kpi.won"), value: formatCurrency(locale, sumWon, cur) },
          ].map((k) => (
            <Card key={k.label} className="flex items-center gap-3 p-3.5">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent">
                <k.icon className="h-5 w-5" />
              </span>
              <span className="min-w-0">
                <span className="block text-[12px] text-muted">{k.label}</span>
                <span className="block truncate text-[17px] font-bold tabular-nums">{k.value}</span>
              </span>
            </Card>
          ))}
        </div>
      ) : null}
      <Card className="mb-4 p-3">
        <form method="get" role="search">
          <input
            name="q"
            defaultValue={q}
            placeholder={t("companies.searchPlaceholder")}
            aria-label={t("common.search")}
            className="h-10 w-full rounded-xl border border-line bg-elevated px-3.5 text-[14px] placeholder:text-subtle focus:border-accent focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </form>
        {allRows.length ? (
          <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[12.5px]" data-testid="companies-sortfilter">
            {COMPANY_FILTERS.map((f) => (
              <Link key={f} href={qs({ f })} aria-current={filter === f ? "true" : undefined} className={filter === f ? "rounded-full border border-accent bg-accent-soft px-3 py-1 text-accent" : "rounded-full border border-line px-3 py-1 text-muted hover:bg-surface-hover"}>
                {t(`companies.filter.${f}`)}
              </Link>
            ))}
            <span className="mx-1 h-4 w-px bg-line" aria-hidden />
            <span className="text-subtle">{t("companies.sortBy")}</span>
            {COMPANY_SORTS.map((o) => (
              <Link key={o} href={qs({ sort: o })} aria-current={sort === o ? "true" : undefined} className={sort === o ? "rounded-full border border-accent bg-accent-soft px-3 py-1 text-accent" : "rounded-full border border-line px-3 py-1 text-muted hover:bg-surface-hover"}>
                {t(`companies.sort.${o}`)}
              </Link>
            ))}
          </div>
        ) : null}
      </Card>
      {rows.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Building2 className="h-6 w-6" />}
            title={q || filter !== "all" ? t("common.noResults") : t("companies.empty")}
            body={q || filter !== "all" ? undefined : t("companies.emptyBody")}
            action={!q && filter === "all" && ctx.can("companies.write") ? <NewCompanyButton /> : undefined}
          />
        </Card>
      ) : (
        <>
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {rows.map((c) => (
              <li key={c.id}>
                <Link href={`/${locale}/companies/${c.id}`} className="block h-full">
                  <Card className="lift flex h-full items-start gap-3 p-4 transition-colors hover:bg-surface-hover">
                    <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-accent-soft text-[14px] font-bold text-accent">{initials(c.name as string)}</span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-semibold">{c.name}</div>
                      <div className="mt-0.5 flex items-center gap-1.5 text-[12.5px] text-muted">
                        {c.domain ? (
                          <>
                            <Globe className="h-3.5 w-3.5" />
                            <Ltr className="truncate">{c.domain}</Ltr>
                          </>
                        ) : (
                          (c.industry ?? "—")
                        )}
                      </div>
                      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[12px] text-subtle">
                        <span>{t("companies.contactsCount", { count: contactCount.get(c.id as string) ?? 0 })}</span>
                        <span>{t("companies.openDeals", { count: openDeals.get(c.id as string) ?? 0 })}</span>
                        {(stats.get(c.id)?.pipeline ?? 0) > 0 ? <span className="font-medium text-accent">{t("companies.pipelineValue", { v: formatCurrency(locale, stats.get(c.id)!.pipeline, cur) })}</span> : null}
                        {(stats.get(c.id)?.won ?? 0) > 0 ? <span className="font-medium text-success">{t("companies.wonValue", { v: formatCurrency(locale, stats.get(c.id)!.won, cur) })}</span> : null}
                        <span>{formatDate(locale, c.created_at as string)}</span>
                      </div>
                    </div>
                  </Card>
                </Link>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-sm text-muted">{t("companies.total", { count: formatNumber(locale, count ?? rows.length) })}</p>
        </>
      )}
    </>
  );
}
