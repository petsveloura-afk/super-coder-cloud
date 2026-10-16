import Link from "next/link";
import type { Metadata } from "next";
import { Building2, Globe } from "lucide-react";
import { Card, EmptyState, Ltr, PageHeader } from "@/components/ui/primitives";
import { NewCompanyButton } from "@/components/companies/company-form";
import { getOrgContext } from "@/lib/auth";
import { getT, resolveLocale } from "@/lib/i18n/server";
import { createClient } from "@/lib/supabase/server";
import { sanitizeSearch } from "@/lib/search";
import { formatDate, formatNumber } from "@/lib/format";
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
  const contactCount = new Map<string, number>();
  for (const c of contactsRes.data ?? []) contactCount.set(c.company_id as string, (contactCount.get(c.company_id as string) ?? 0) + 1);
  const openDeals = new Map<string, number>();
  for (const d of dealsRes.data ?? []) if (d.status === "open") openDeals.set(d.company_id as string, (openDeals.get(d.company_id as string) ?? 0) + 1);
  const rows = data ?? [];

  return (
    <>
      <PageHeader title={t("companies.title")} description={t("companies.subtitle")} actions={ctx.can("companies.write") ? <NewCompanyButton defaultOpen={sp.new === "1"} /> : null} />
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
      </Card>
      {rows.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Building2 className="h-6 w-6" />}
            title={q ? t("common.noResults") : t("companies.empty")}
            body={q ? undefined : t("companies.emptyBody")}
            action={!q && ctx.can("companies.write") ? <NewCompanyButton /> : undefined}
          />
        </Card>
      ) : (
        <>
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {rows.map((c) => (
              <li key={c.id}>
                <Link href={`/${locale}/companies/${c.id}`} className="block h-full">
                  <Card className="flex h-full items-start gap-3 p-4 transition-colors hover:bg-surface-hover">
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
