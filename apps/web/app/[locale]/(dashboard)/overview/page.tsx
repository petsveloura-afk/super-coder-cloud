import Link from "next/link";
import type { Metadata } from "next";
import { ArrowUpRight, CheckCircle2, Circle, ShieldCheck, TrendingUp, UserPlus, Users, Wallet, Target, ListTodo } from "lucide-react";
import type { DailyPoint, DashboardKpis } from "@scc/database";
import { Badge, Card, CardHeader, EmptyState, PageHeader } from "@/components/ui/primitives";
import { DailyAreaChart, StatusBarChart } from "@/components/dashboard/charts";
import { DemoLoader } from "@/components/dashboard/demo-loader";
import { getOrgContext } from "@/lib/auth";
import { getT, resolveLocale } from "@/lib/i18n/server";
import { createClient } from "@/lib/supabase/server";
import { formatCurrency, formatNumber, formatPercent } from "@/lib/format";
import { CONTACT_STATUSES } from "@scc/shared/validators";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { t } = await getT(await resolveLocale(params));
  return { title: t("nav.overview") };
}

const EMPTY_KPIS: DashboardKpis = {
  total_contacts: 0, new_contacts: 0, qualified_contacts: 0, customers: 0, open_deals: 0,
  open_pipeline_value: 0, won_value: 0, won_deals: 0, lost_deals: 0, open_tasks: 0, overdue_tasks: 0,
};

export default async function OverviewPage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = await resolveLocale(params);
  const ctx = await getOrgContext(locale);
  const { t } = await getT(locale);
  const supabase = await createClient();
  const orgId = ctx.org.id;

  // All figures come from RLS-protected queries — never invented.
  const [kpiRes, dailyRes, membersRes, ...statusRes] = await Promise.all([
    supabase.rpc("dashboard_kpis", { org: orgId }).single(),
    supabase.rpc("contacts_daily", { org: orgId, days: 30 }),
    supabase.from("organization_members").select("user_id", { count: "exact", head: true }).eq("organization_id", orgId),
    ...CONTACT_STATUSES.map((s) =>
      supabase.from("contacts").select("id", { count: "exact", head: true }).eq("organization_id", orgId).eq("status", s),
    ),
  ]);

  const raw = (kpiRes.data ?? EMPTY_KPIS) as DashboardKpis;
  const k = Object.fromEntries(Object.entries(raw).map(([key, v]) => [key, Number(v)])) as unknown as DashboardKpis;
  const daily = ((dailyRes.data ?? []) as DailyPoint[]).map((d) => ({ day: d.day, count: Number(d.count) }));
  const closed = k.won_deals + k.lost_deals;
  const currency = ctx.org.currency || "ILS";
  const status = CONTACT_STATUSES.map((s, i) => ({ name: t(`crm.statuses.${s}`), value: statusRes[i]?.count ?? 0 }));

  const kpis = [
    { label: t("dashboard.totalContacts"), value: formatNumber(locale, k.total_contacts), icon: Users, tone: "text-accent bg-accent-soft" },
    { label: t("dashboard.newContacts"), value: formatNumber(locale, k.new_contacts), icon: UserPlus, tone: "text-teal bg-teal-soft" },
    { label: t("dashboard.qualified"), value: formatNumber(locale, k.qualified_contacts), icon: Target, tone: "text-gold bg-gold-soft" },
    {
      label: t("dashboard.conversionRate"),
      value: closed > 0 ? formatPercent(locale, k.won_deals / closed) : "—",
      icon: TrendingUp,
      tone: "text-success bg-success-soft",
    },
    { label: t("dashboard.pipelineValue"), value: formatCurrency(locale, k.open_pipeline_value, currency), sub: `${formatNumber(locale, k.open_deals)} ${t("dashboard.openDeals")}`, icon: Wallet, tone: "text-accent bg-accent-soft", ltr: true },
    { label: t("dashboard.wonRevenue"), value: formatCurrency(locale, k.won_value, currency), icon: ArrowUpRight, tone: "text-success bg-success-soft", ltr: true },
    { label: t("dashboard.customers"), value: formatNumber(locale, k.customers), icon: Users, tone: "text-teal bg-teal-soft" },
    {
      label: t("dashboard.openTasks"),
      value: formatNumber(locale, k.open_tasks),
      sub: k.overdue_tasks ? `${formatNumber(locale, k.overdue_tasks)} ${t("dashboard.overdueTasks")}` : undefined,
      subTone: "text-danger",
      icon: ListTodo,
      tone: "text-warning bg-warning-soft",
    },
  ];

  const checklist = [
    { done: k.total_contacts > 0, label: t("dashboard.checklistContact"), href: `/${locale}/crm` },
    { done: (membersRes.count ?? 1) > 1, label: t("dashboard.checklistTeam"), href: `/${locale}/team` },
  ];
  const isEmpty = k.total_contacts === 0;
  const firstName = (ctx.profile?.full_name || ctx.email).split(" ")[0] ?? "";

  return (
    <>
      <PageHeader
        title={t("dashboard.welcome", { name: firstName })}
        description={t("dashboard.subtitle", { org: ctx.org.name })}
        actions={
          <Badge tone="success">
            <ShieldCheck className="h-3.5 w-3.5" /> {t("dashboard.verified")}
          </Badge>
        }
      />

      <section aria-label={t("nav.overview")} className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {kpis.map((kpi) => (
          <Card key={kpi.label} className="p-4 sm:p-5">
            <div className="flex items-start justify-between gap-2">
              <span className="text-[12.5px] font-medium leading-tight text-muted">{kpi.label}</span>
              <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${kpi.tone}`}>
                <kpi.icon className="h-4 w-4" />
              </span>
            </div>
            <div className="mt-3 truncate text-[22px] font-bold tracking-tight sm:text-[26px]" dir={kpi.ltr ? "ltr" : undefined}>
              {kpi.value}
            </div>
            {kpi.sub ? <div className={`mt-1 text-[12px] ${kpi.subTone ?? "text-subtle"}`}>{kpi.sub}</div> : null}
          </Card>
        ))}
      </section>

      {isEmpty ? (
        <Card className="mt-6">
          <EmptyState
            icon={<Users className="h-6 w-6" />}
            title={t("dashboard.emptyTitle")}
            body={t("dashboard.emptyBody")}
            action={
              <div className="flex flex-col items-center gap-3 sm:flex-row">
                {ctx.can("contacts.write") ? (
                  <Link href={`/${locale}/crm?new=1`} className="inline-flex h-10 items-center rounded-xl bg-accent-solid px-4 text-sm font-medium text-white hover:bg-accent-solid-hover">
                    {t("crm.newContact")}
                  </Link>
                ) : null}
                {ctx.can("settings.manage") ? <DemoLoader /> : null}
              </div>
            }
          />
        </Card>
      ) : null}

      <div className="mt-6 grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title={t("dashboard.newContactsChart")} description={t("dashboard.verified")} />
          <div className="p-3 sm:p-5">
            <DailyAreaChart data={daily} label={t("dashboard.newContactsChart")} />
          </div>
        </Card>
        <Card>
          <CardHeader title={t("dashboard.statusBreakdown")} />
          <div className="p-3 sm:p-5">
            <StatusBarChart data={status} label={t("dashboard.statusBreakdown")} />
          </div>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader title={t("dashboard.checklistTitle")} />
        <ul className="divide-y divide-line">
          {checklist.map((c) => (
            <li key={c.label}>
              <Link href={c.href} className="flex items-center gap-3 px-5 py-3.5 text-sm hover:bg-surface-hover">
                {c.done ? <CheckCircle2 className="h-5 w-5 text-success" /> : <Circle className="h-5 w-5 text-subtle" />}
                <span className={c.done ? "text-muted line-through" : "text-fg"}>{c.label}</span>
              </Link>
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}
