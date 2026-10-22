import Link from "next/link";
import type { Metadata } from "next";
import { BarChart3 } from "lucide-react";
import { Card, CardHeader, EmptyState, PageHeader } from "@/components/ui/primitives";
import { HBarChart, MonthlyChart } from "@/components/analytics/charts";
import { getOrgContext } from "@/lib/auth";
import { getT, resolveLocale } from "@/lib/i18n/server";
import { createClient } from "@/lib/supabase/server";
import { formatCurrency, formatNumber, formatPercent } from "@/lib/format";
import { stageLabel } from "@/lib/labels";
import { cn } from "@/lib/utils";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { t } = await getT(await resolveLocale(params));
  return { title: t("analytics.title") };
}

interface Analytics {
  days: number;
  stages: { id: string; name: string; pipeline: string; deals: number; value: number }[];
  open_deals: number;
  open_value: number;
  weighted_value: number;
  won: number;
  won_value: number;
  lost: number;
  lost_value: number;
  monthly: { month: string; value: number; deals: number }[];
  sources: { source: string; count: number }[];
  owners: { name: string; deals: number; value: number }[];
  contacts_new: number;
  companies: number;
  tasks_open: number;
  tasks_overdue: number;
  tasks_done: number;
}

type SP = Promise<Record<string, string | string[] | undefined>>;
const PERIODS = [30, 90, 365] as const;

export default async function AnalyticsPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: SP }) {
  const locale = await resolveLocale(params);
  const ctx = await getOrgContext(locale);
  const { t } = await getT(locale);
  const sp = await searchParams;
  if (!ctx.can("analytics.read")) {
    return (
      <Card>
        <EmptyState title={t("errors.forbidden")} />
      </Card>
    );
  }
  const days = PERIODS.find((p) => String(p) === sp.days) ?? 90;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("crm_analytics", { p_org: ctx.org.id, p_days: days });
  if (error || !data) throw new Error("analytics query failed");
  const a = data as Analytics;
  const currency = ctx.org.currency || "ILS";
  const money = (v: number) => formatCurrency(locale, Number(v), currency);
  const closed = Number(a.won) + Number(a.lost);
  const winRate = closed ? Number(a.won) / closed : null;
  const avgDeal = Number(a.won) ? Number(a.won_value) / Number(a.won) : null;

  // Last 12 months, including months with no revenue (real zeros).
  const months: { month: string; value: number }[] = [];
  const now = new Date();
  for (let i = 11; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    months.push({ month: key, value: Number(a.monthly.find((m) => m.month === key)?.value ?? 0) });
  }

  const kpis = [
    { label: t("analytics.openPipeline"), value: money(a.open_value), sub: t("deals.openCount", { count: a.open_deals }) },
    { label: t("analytics.weighted"), value: money(a.weighted_value) },
    { label: t("analytics.wonValue"), value: money(a.won_value), sub: t("analytics.wonCount", { count: a.won }) },
    { label: t("analytics.winRate"), value: winRate === null ? "—" : formatPercent(locale, winRate), sub: t("analytics.closedCount", { count: closed }) },
    { label: t("analytics.avgDeal"), value: avgDeal === null ? "—" : money(avgDeal) },
    { label: t("analytics.newContacts"), value: formatNumber(locale, a.contacts_new) },
    { label: t("analytics.openTasks"), value: formatNumber(locale, a.tasks_open), sub: t("analytics.overdueCount", { count: a.tasks_overdue }), danger: a.tasks_overdue > 0 },
    { label: t("analytics.tasksDone"), value: formatNumber(locale, a.tasks_done) },
  ];

  return (
    <>
      <PageHeader
        title={t("analytics.title")}
        description={t("analytics.subtitle")}
        actions={
          <div className="flex gap-1 rounded-xl border border-line bg-surface p-1" role="tablist" aria-label={t("analytics.period")}>
            {PERIODS.map((p) => (
              <Link
                key={p}
                href={`/${locale}/analytics?days=${p}`}
                role="tab"
                aria-selected={days === p}
                className={cn("rounded-lg px-3 py-1.5 text-[13px]", days === p ? "bg-accent-soft font-semibold text-accent" : "text-muted hover:text-fg")}
              >
                {t("analytics.lastDays", { days: p })}
              </Link>
            ))}
          </div>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {kpis.map((k) => (
          <Card key={k.label} className="p-4">
            <div className="text-[12.5px] text-muted">{k.label}</div>
            <div className={cn("mt-1.5 text-xl font-bold sm:text-2xl", k.danger && "text-danger")}>
              <bdi dir="ltr">{k.value}</bdi>
            </div>
            {k.sub ? <div className="mt-0.5 text-[12px] text-subtle">{k.sub}</div> : null}
          </Card>
        ))}
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title={t("analytics.revenueByMonth")} />
          <div className="p-4">
            <MonthlyChart data={months} label={t("analytics.wonValue")} currency={currency} />
          </div>
        </Card>
        <Card>
          <CardHeader title={t("analytics.funnel")} description={t("analytics.funnelHint")} />
          <div className="p-4">
            {a.stages.length === 0 || a.stages.every((s) => Number(s.value) === 0) ? (
              <EmptyState icon={<BarChart3 className="h-6 w-6" />} title={t("analytics.noData")} />
            ) : (
              <HBarChart data={a.stages.map((s) => ({ name: stageLabel(t, s.name), value: Number(s.value) }))} label={t("analytics.funnel")} currency={currency} />
            )}
          </div>
        </Card>
        <Card>
          <CardHeader title={t("analytics.leadSources")} />
          <div className="p-4">
            {a.sources.length === 0 ? (
              <EmptyState title={t("analytics.noData")} />
            ) : (
              <HBarChart data={a.sources.map((s) => ({ name: t(`crm.sources.${s.source}`), value: Number(s.count) }))} label={t("analytics.leadSources")} />
            )}
          </div>
        </Card>
        <Card>
          <CardHeader title={t("analytics.topSellers")} />
          {a.owners.length === 0 ? (
            <div className="p-4">
              <EmptyState title={t("analytics.noData")} />
            </div>
          ) : (
            <ol className="divide-y divide-line">
              {a.owners.map((o, i) => (
                <li key={`${o.name}-${i}`} className="flex items-center gap-3 px-5 py-3 text-sm">
                  <span className="w-5 text-[12px] text-subtle">{i + 1}</span>
                  <span className="min-w-0 flex-1 truncate font-medium">{o.name}</span>
                  <span className="text-[12px] text-muted">{t("analytics.wonCount", { count: o.deals })}</span>
                  <bdi dir="ltr" className="font-semibold">
                    {money(o.value)}
                  </bdi>
                </li>
              ))}
            </ol>
          )}
        </Card>
      </div>
    </>
  );
}
