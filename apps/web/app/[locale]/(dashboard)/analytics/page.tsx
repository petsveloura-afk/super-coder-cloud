import Link from "next/link";
import type { Metadata } from "next";
import { BarChart3 } from "lucide-react";
import { Card, CardHeader, EmptyState, PageHeader } from "@/components/ui/primitives";
import { ForecastChart, HBarChart, MonthlyChart } from "@/components/analytics/charts";
import { GrowthInsight, SpendCard, type SpendRow } from "@/components/analytics/growth";
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

interface Growth {
  by_source: { source: string; leads: number; customers: number; revenue: number; spend: number; conversion: number | null; cpl: number | null; cac: number | null; roas: number | null; roi: number | null }[];
  totals: { leads: number; customers: number; revenue: number; spend: number; cac: number | null; roas: number | null; roi: number | null };
  ltv: { customers: number; ltv: number; avg_orders: number; avg_months: number };
  monthly: { month: string; value: number }[];
  forecast: { month: string; pipeline: number; run_rate: number; forecast: number }[];
  run_rate: number;
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

  // wave 18: ROI / CAC / LTV / forecast (works before the migration too: section hidden)
  const [growthRes, spendRes] = await Promise.all([
    supabase.rpc("growth_metrics", { p_org: ctx.org.id, p_days: days }),
    supabase.from("marketing_spend").select("id, month, source, amount, note").eq("organization_id", ctx.org.id).order("month", { ascending: false }).limit(36),
  ]);
  const g = !growthRes.error && growthRes.data ? (growthRes.data as Growth) : null;
  const { orgHasFeature } = await import("@/lib/billing/features");
  const advanced = ctx.can("ai.use") && (await orgHasFeature(ctx.org.id, "advanced_analytics"));
  const ratio = (v: number | null | undefined) => (v === null || v === undefined ? "—" : `${Number(v).toFixed(2)}×`);
  const ltvCac = g?.ltv?.ltv && g.totals?.cac ? Number(g.ltv.ltv) / Number(g.totals.cac) : null;

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

      {g ? (
        <section className="mt-8 space-y-4" aria-labelledby="growth-title" data-testid="growth-section">
          <div>
            <h2 id="growth-title" className="text-lg font-bold">
              {t("growth.title")}
            </h2>
            <p className="text-[13px] text-muted">{t("growth.subtitle")}</p>
          </div>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[
              { label: t("growth.revenue"), value: money(g.totals.revenue) },
              { label: t("growth.spend"), value: money(g.totals.spend) },
              { label: t("growth.roas"), value: ratio(g.totals.roas), sub: g.totals.roi === null ? t("growth.addSpend") : t("growth.roiValue", { roi: formatPercent(locale, Number(g.totals.roi)) }) },
              { label: t("growth.cac"), value: g.totals.cac === null ? "—" : money(g.totals.cac), sub: t("growth.newCustomers", { count: g.totals.customers }) },
              { label: t("growth.ltv"), value: money(g.ltv.ltv), sub: t("growth.ltvSub", { orders: g.ltv.avg_orders, months: g.ltv.avg_months }) },
              { label: t("growth.ltvCac"), value: ltvCac === null ? "—" : `${ltvCac.toFixed(1)}:1`, sub: ltvCac === null ? undefined : t(ltvCac >= 3 ? "growth.ltvCacGood" : "growth.ltvCacLow"), danger: ltvCac !== null && ltvCac < 1 },
              { label: t("growth.runRate"), value: money(g.run_rate), sub: t("growth.perMonth") },
              { label: t("growth.forecast3"), value: money(g.forecast.reduce((a, f) => a + Number(f.forecast), 0)) },
            ].map((k) => (
              <Card key={k.label} className="p-4">
                <div className="text-[12.5px] text-muted">{k.label}</div>
                <div className={cn("mt-1.5 text-xl font-bold sm:text-2xl", "danger" in k && k.danger && "text-danger")}>
                  <bdi dir="ltr">{k.value}</bdi>
                </div>
                {"sub" in k && k.sub ? <div className="mt-0.5 text-[12px] text-subtle">{k.sub}</div> : null}
              </Card>
            ))}
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader title={t("growth.bySource")} description={t("growth.bySourceHint")} />
              {g.by_source.length === 0 ? (
                <div className="p-4">
                  <EmptyState title={t("analytics.noData")} />
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[560px] text-[13px]">
                    <thead className="text-muted">
                      <tr className="border-b border-line">
                        <th className="px-4 py-2 text-start font-medium">{t("crm.source")}</th>
                        <th className="px-3 py-2 text-end font-medium">{t("growth.leads")}</th>
                        <th className="px-3 py-2 text-end font-medium">{t("growth.customers")}</th>
                        <th className="px-3 py-2 text-end font-medium">{t("growth.revenue")}</th>
                        <th className="px-3 py-2 text-end font-medium">{t("growth.spend")}</th>
                        <th className="px-3 py-2 text-end font-medium">{t("growth.cac")}</th>
                        <th className="px-3 py-2 text-end font-medium">{t("growth.roas")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {g.by_source.map((r) => (
                        <tr key={r.source} className="border-b border-line/60">
                          <td className="px-4 py-2">{t(`crm.sources.${r.source}`)}</td>
                          <td className="px-3 py-2 text-end tabular-nums">{formatNumber(locale, r.leads)}</td>
                          <td className="px-3 py-2 text-end tabular-nums">{formatNumber(locale, r.customers)}</td>
                          <td className="px-3 py-2 text-end tabular-nums">
                            <bdi dir="ltr">{money(r.revenue)}</bdi>
                          </td>
                          <td className="px-3 py-2 text-end tabular-nums">
                            <bdi dir="ltr">{r.spend ? money(r.spend) : "—"}</bdi>
                          </td>
                          <td className="px-3 py-2 text-end tabular-nums">
                            <bdi dir="ltr">{r.cac === null ? "—" : money(r.cac)}</bdi>
                          </td>
                          <td className={cn("px-3 py-2 text-end tabular-nums", r.roas !== null && Number(r.roas) < 1 && "text-danger", r.roas !== null && Number(r.roas) >= 3 && "text-success")}>{ratio(r.roas)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
            <Card>
              <CardHeader title={t("growth.forecastTitle")} description={t("growth.forecastHint")} />
              <div className="p-4">
                <ForecastChart data={g.forecast.map((f) => ({ month: f.month, run_rate: Number(f.run_rate), pipeline: Number(f.pipeline) }))} currency={currency} labels={{ runRate: t("growth.runRate"), pipeline: t("growth.weightedDeals"), title: t("growth.forecastTitle") }} />
              </div>
            </Card>
            <SpendCard rows={((spendRes.error ? [] : spendRes.data) ?? []) as SpendRow[]} currency={currency} canEdit={ctx.can("campaigns.manage") || ctx.can("settings.manage")} />
            <GrowthInsight days={days} allowed={advanced} />
          </div>
        </section>
      ) : null}
    </>
  );
}
