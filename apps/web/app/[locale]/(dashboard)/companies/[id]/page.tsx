import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ArrowLeft, ArrowRight, Factory, Globe, Phone } from "lucide-react";
import { uuidSchema } from "@scc/shared/validators";
import { Card, CardHeader, Ltr } from "@/components/ui/primitives";
import { DeleteCompanyButton, EditCompanyButton, LinkContactButton, UnlinkContactButton } from "@/components/companies/company-form";
import { NewDealButton, type DealPickers } from "@/components/pipelines/deal-form";
import { StatusBadge } from "@/components/crm/status-badge";
import { getOrgContext } from "@/lib/auth";
import { getT, resolveLocale } from "@/lib/i18n/server";
import { createClient } from "@/lib/supabase/server";
import { companyOptions, contactOptions, memberOptions, pipelinesWithStages } from "@/lib/lookups";
import { formatCurrency, formatPhone } from "@/lib/format";
import { initials } from "@/lib/utils";
import type { ContactStatus } from "@scc/database";

type Params = Promise<{ locale: string; id: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { t } = await getT(await resolveLocale(params));
  return { title: t("companies.details") };
}

export default async function CompanyDetailPage({ params }: { params: Params }) {
  const locale = await resolveLocale(params);
  const { id: rawId } = await params;
  const id = uuidSchema.safeParse(rawId);
  if (!id.success) notFound();
  const ctx = await getOrgContext(locale);
  const { t } = await getT(locale);
  const supabase = await createClient();
  const { data: company } = await supabase
    .from("companies")
    .select("id, name, domain, industry, phone, created_at")
    .eq("id", id.data)
    .eq("organization_id", ctx.org.id)
    .maybeSingle();
  if (!company) notFound();

  const [{ data: contacts }, { data: deals }, pipelines, allContacts, companies, members] = await Promise.all([
    supabase.from("contacts").select("id, first_name, last_name, email, phone, status").eq("organization_id", ctx.org.id).eq("company_id", company.id).order("first_name").limit(200),
    supabase.from("deals").select("id, title, value, currency, status").eq("organization_id", ctx.org.id).eq("company_id", company.id).order("created_at", { ascending: false }).limit(100),
    pipelinesWithStages(ctx.org.id),
    contactOptions(ctx.org.id),
    companyOptions(ctx.org.id),
    memberOptions(ctx.org.id),
  ]);
  const pickers: DealPickers = {
    pipelines: pipelines.map((p) => ({ id: p.id, name: p.name, stages: p.stages.map((s) => ({ id: s.id, name: s.name })) })),
    contacts: allContacts,
    companies,
    members,
  };
  const linked = new Set((contacts ?? []).map((c) => c.id as string));
  const Back = locale === "en" ? ArrowLeft : ArrowRight;

  return (
    <>
      <Link href={`/${locale}/companies`} className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted hover:text-fg">
        <Back className="h-4 w-4" /> {t("companies.title")}
      </Link>
      <Card className="p-5 sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-accent-soft text-lg font-bold text-accent">{initials(company.name as string)}</span>
            <div className="min-w-0">
              <h1 className="truncate text-xl font-bold sm:text-2xl">{company.name}</h1>
              <div className="mt-1 flex flex-wrap gap-3 text-[13px] text-muted">
                {company.domain ? (
                  <a href={`https://${company.domain}`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 hover:text-accent">
                    <Globe className="h-3.5 w-3.5" />
                    <Ltr>{company.domain}</Ltr>
                  </a>
                ) : null}
                {company.industry ? (
                  <span className="flex items-center gap-1">
                    <Factory className="h-3.5 w-3.5" />
                    {company.industry}
                  </span>
                ) : null}
                {company.phone ? (
                  <span className="flex items-center gap-1">
                    <Phone className="h-3.5 w-3.5" />
                    <Ltr>{formatPhone(company.phone as string)}</Ltr>
                  </span>
                ) : null}
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {ctx.can("companies.write") ? <EditCompanyButton company={company as never} /> : null}
            {ctx.can("companies.delete") ? <DeleteCompanyButton id={company.id as string} /> : null}
          </div>
        </div>
      </Card>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader
            title={t("companies.people")}
            action={ctx.can("contacts.write") ? <LinkContactButton companyId={company.id as string} contacts={allContacts.filter((c) => !linked.has(c.id))} /> : null}
          />
          {(contacts ?? []).length === 0 ? (
            <p className="p-5 text-center text-sm text-subtle">{t("companies.noPeople")}</p>
          ) : (
            <ul className="divide-y divide-line">
              {(contacts ?? []).map((c) => (
                <li key={c.id} className="flex items-center gap-3 px-5 py-3">
                  <Link href={`/${locale}/crm/${c.id}`} className="min-w-0 flex-1 truncate font-medium hover:text-accent">
                    {c.first_name} {c.last_name}
                  </Link>
                  <StatusBadge status={c.status as ContactStatus} />
                  {ctx.can("contacts.write") ? <UnlinkContactButton contactId={c.id as string} /> : null}
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <CardHeader
            title={t("deals.pageTitle")}
            action={ctx.can("deals.write") ? <NewDealButton pickers={pickers} defaults={{ company_id: company.id as string, currency: ctx.org.currency || "ILS" }} variant="secondary" /> : null}
          />
          {(deals ?? []).length === 0 ? (
            <p className="p-5 text-center text-sm text-subtle">{t("deals.none")}</p>
          ) : (
            <ul className="divide-y divide-line">
              {(deals ?? []).map((d) => (
                <li key={d.id} className="flex items-center gap-3 px-5 py-3 text-sm">
                  <span className="min-w-0 flex-1 truncate">{d.title}</span>
                  <span className="text-[12px] text-muted">{t(`deals.statuses.${d.status}`)}</span>
                  <bdi dir="ltr" className="font-semibold">
                    {formatCurrency(locale, Number(d.value), d.currency as string)}
                  </bdi>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
