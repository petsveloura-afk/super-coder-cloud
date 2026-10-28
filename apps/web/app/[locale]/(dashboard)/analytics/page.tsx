import Link from "next/link";
import type { Metadata } from "next";
import { BarChart3, CalendarCheck, CheckCircle2, Gauge, Layers, ListChecks, Percent, Sparkles, Target, Timer, TrendingUp, Trophy, UserCheck, UserPlus, Wallet } from "lucide-react";
import { Card, CardHeader, EmptyState, PageHeader } from "@/components/ui/primitives";
import { ForecastChart, HBarChart } from "@/components/analytics/charts";
import { GrowthInsight, SpendCard, type SpendRow } from "@/components/analytics/growth";
import { FunnelPanel, HighlightsStrip, KpiCard } from "@/components/analytics/kpi";
import { ExportCsvButton, PrintButton, RevenueTrendChart, WinLossDonut } from "@/components/analytics/pro-charts";
import { StatusDonut, WeeklyTrend } from "@/components/appointments/insights-charts";
import { buildHighlights, cumulative, delta, funnelSteps, movingAverage, previousWindow, sparkSeries, type Highlight } from "@/lib/analytics/insights";
import { computeApptStats, safeZone, type ApptRow } from "@/lib/appointments/insights";
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
  // previous window of the same length: the RPC with 2N days minus the N-day result (additive metrics only)
  const doubledRes = await supabase.rpc("crm_analytics", { p_org: ctx.org.id, p_days: days * 2 });
  const d2 = !doubledRes.error && doubledRes.data ? (doubledRes.data as Analytics) : null;
  const prev = d2
    ? {
        won: previousWindow(Number(a.won), Number(d2.won)),
        wonValue: previousWindow(Number(a.won_value), Number(d2.won_value)),
        lost: previousWindow(Number(a.lost), Number(d2.lost)),
        contactsNew: previousWindow(Number(a.contacts_new), Number(d2.contacts_new)),
        tasksDone: previousWindow(Number(a.tasks_done), Number(d2.tasks_done)),
      }
    : null;
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

  const pctFmt = (v: number) => formatPercent(locale, v);
  const prevClosed = prev ? prev.won + prev.lost : 0;
  const prevWinRate = prev && prevClosed ? prev.won / prevClosed : null;
  const prevAvgDeal = prev && prev.won ? prev.wonValue / prev.won : null;
  const spark = sparkSeries(months);
  const vs = t("analytics.pro.vsPrev");

  // meetings (appointments module) — shown only to people who may read it
  const canMeetings = ctx.can("appointments.read");
  let meetings: ReturnType<typeof computeApptStats> | null = null;
  let meetingsUpcoming = 0;
  let meetingContacts = 0;
  let meetingContactsWon = 0;
  if (canMeetings) {
    const nowDate = new Date();
    const nowIso = nowDate.toISOString();
    const sinceIso = new Date(nowDate.getTime() - days * 86_400_000).toISOString();
    const [{ data: orgRow }, { data: apptData }, upc] = await Promise.all([
      supabase.from("organizations").select("timezone").eq("id", ctx.org.id).maybeSingle(),
      supabase.from("appointments").select("id, title, starts_at, ends_at, status, host_id, type_id, contact_id, created_at").eq("organization_id", ctx.org.id).gte("starts_at", sinceIso).lte("starts_at", nowIso).order("starts_at").limit(2000),
      supabase.from("appointments").select("id", { count: "exact", head: true }).eq("organization_id", ctx.org.id).in("status", ["scheduled", "confirmed"]).gte("ends_at", nowIso),
    ]);
    const rowsA = (apptData ?? []) as unknown as ApptRow[];
    meetings = computeApptStats(rowsA, safeZone((orgRow?.timezone as string | undefined) || "Asia/Jerusalem"));
    meetingsUpcoming = upc.count ?? 0;
    const held = Array.from(new Set(rowsA.filter((r) => r.status === "completed" && r.contact_id).map((r) => r.contact_id as string))).slice(0, 300);
    meetingContacts = held.length;
    if (held.length) {
      const { data: wonRows } = await supabase.from("deals").select("contact_id").eq("organization_id", ctx.org.id).eq("status", "won").in("contact_id", held);
      meetingContactsWon = new Set((wonRows ?? []).map((r) => r.contact_id as string)).size;
    }
  }

  const kpis = [
    { id: "open", label: t("analytics.openPipeline"), value: money(a.open_value), sub: t("deals.openCount", { count: a.open_deals }), icon: <Layers className="h-4 w-4" />, tone: "accent" as const },
    { id: "weighted", label: t("analytics.weighted"), value: money(a.weighted_value), icon: <Target className="h-4 w-4" />, tone: "teal" as const },
    { id: "won", label: t("analytics.wonValue"), value: money(a.won_value), sub: t("analytics.wonCount", { count: a.won }), icon: <Trophy className="h-4 w-4" />, tone: "success" as const, delta: prev ? delta(Number(a.won_value), prev.wonValue) : null, spark },
    { id: "winrate", label: t("analytics.winRate"), value: winRate === null ? "—" : formatPercent(locale, winRate), sub: t("analytics.closedCount", { count: closed }), icon: <Percent className="h-4 w-4" />, tone: "gold" as const, delta: prev && winRate !== null && prevWinRate !== null ? delta(winRate, prevWinRate) : null },
    { id: "avgdeal", label: t("analytics.avgDeal"), value: avgDeal === null ? "—" : money(avgDeal), icon: <Wallet className="h-4 w-4" />, tone: "accent" as const, delta: prev && avgDeal !== null && prevAvgDeal !== null ? delta(avgDeal, prevAvgDeal) : null },
    { id: "contacts", label: t("analytics.newContacts"), value: formatNumber(locale, a.contacts_new), icon: <UserPlus className="h-4 w-4" />, tone: "teal" as const, delta: prev ? delta(Number(a.contacts_new), prev.contactsNew) : null },
    { id: "tasks", label: t("analytics.openTasks"), value: formatNumber(locale, a.tasks_open), sub: t("analytics.overdueCount", { count: a.tasks_overdue }), danger: a.tasks_overdue > 0, icon: <ListChecks className="h-4 w-4" />, tone: "warning" as const },
    { id: "done", label: t("analytics.tasksDone"), value: formatNumber(locale, a.tasks_done), icon: <CheckCircle2 className="h-4 w-4" />, tone: "success" as const, delta: prev ? delta(Number(a.tasks_done), prev.tasksDone) : null },
  ];

  // funnel per pipeline (default pipeline first, as the RPC orders it)
  const pipelines = new Map<string, { name: string; value: number; deals: number }[]>();
  for (const st of a.stages) pipelines.set(st.pipeline, [...(pipelines.get(st.pipeline) ?? []), { name: stageLabel(t, st.name), value: Number(st.value), deals: Number(st.deals) }]);
  const funnels = Array.from(pipelines.entries()).slice(0, 3);
  const trendRows = (() => {
    const vals = months.map((m) => m.value);
    const avg = movingAverage(vals);
    const cum = cumulative(vals);
    return months.map((m, i) => ({ month: m.month, value: m.value, trend: Math.round(avg[i] ?? 0), total: cum[i] ?? 0 }));
  })();
  const sourceName = (s: string) => t(`crm.sources.${s}`);
  const withSpend = (g?.by_source ?? []).filter((r) => r.roas !== null && Number(r.spend) > 0);
  const bestRoas = withSpend.length ? withSpend.reduce((x, y) => (Number(y.roas) > Number(x.roas) ? y : x)) : null;
  const worstRoas = withSpend.length ? withSpend.reduce((x, y) => (Number(y.roas) < Number(x.roas) ? y : x)) : null;
  const highlights: Highlight[] = buildHighlights(
    {
      winRate,
      closed,
      wonValue: Number(a.won_value),
      prevWonValue: prev?.wonValue ?? 0,
      contactsNew: Number(a.contacts_new),
      prevContactsNew: prev?.contactsNew ?? 0,
      tasksOverdue: Number(a.tasks_overdue),
      openDeals: Number(a.open_deals),
      openValue: Number(a.open_value),
      weightedValue: Number(a.weighted_value),
      bestSource: a.sources[0] ? { source: sourceName(a.sources[0].source), count: Number(a.sources[0].count) } : null,
      topSeller: a.owners[0] ? { name: a.owners[0].name, value: Number(a.owners[0].value) } : null,
      bestRoasSource: bestRoas ? { source: sourceName(bestRoas.source), roas: Number(bestRoas.roas) } : null,
      worstRoasSource: worstRoas ? { source: sourceName(worstRoas.source), roas: Number(worstRoas.roas) } : null,
      ltvCac,
      biggestDrop: null, // open value per stage is a distribution, not a conversion — never claimed as a drop-off
      meetings: meetings ? { showRate: meetings.showRate, noShowRate: meetings.noShowRate, upcoming: meetingsUpcoming } : null,
    },
    { pct: pctFmt, money },
  );

  const csvRows: (string | number | null)[][] = [
    [t("analytics.title"), t("analytics.lastDays", { days })],
    [],
    ...kpis.map((k) => [k.label, k.value]),
    [],
    [t("analytics.revenueByMonth")],
    ...months.map((m) => [m.month, m.value]),
    [],
    [t("analytics.leadSources")],
    ...a.sources.map((x) => [sourceName(x.source), Number(x.count)]),
    [],
    [t("analytics.funnel")],
    ...a.stages.map((x) => [`${x.pipeline} / ${stageLabel(t, x.name)}`, Number(x.value), Number(x.deals)]),
    [],
    [t("analytics.topSellers")],
    ...a.owners.map((o) => [o.name, Number(o.deals), Number(o.value)]),
    ...(g ? [[], [t("growth.bySource")], [t("crm.source"), t("growth.leads"), t("growth.customers"), t("growth.revenue"), t("growth.spend"), t("growth.cac"), t("growth.roas")], ...g.by_source.map((r) => [sourceName(r.source), Number(r.leads), Number(r.customers), Number(r.revenue), Number(r.spend), r.cac === null ? null : Number(r.cac), r.roas === null ? null : Number(r.roas)])] : []),
  ];

  return (
    <>
      <PageHeader
        title={t("analytics.title")}
        description={t("analytics.subtitle")}
        actions={
          <>
          <ExportCsvButton rows={csvRows} filename={`analytics-${days}d`} />
          <PrintButton />
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
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="analytics-kpis">
        {kpis.map((k) => (
          <KpiCard key={k.id} id={k.id} label={k.label} value={k.value} sub={k.sub} icon={k.icon} tone={k.tone} danger={"danger" in k ? k.danger : undefined} delta={"delta" in k ? k.delta : null} deltaFormat={pctFmt} vs={vs} spark={"spark" in k ? k.spark : undefined} />
        ))}
      </div>

      <div className="mt-4">
        <HighlightsStrip items={highlights} title={t("analytics.pro.highlightsTitle")} text={(h) => t(`analytics.pro.hl.${h.key}`, h.params)} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title={t("analytics.revenueByMonth")} />
          <div className="p-4">
            <RevenueTrendChart data={trendRows} label={t("analytics.wonValue")} currency={currency} labels={{ revenue: t("analytics.wonValue"), trend: t("analytics.pro.trend"), cumulative: t("analytics.pro.cumulative") }} />
          </div>
        </Card>
        <Card>
          <CardHeader title={t("analytics.funnel")} description={t("analytics.funnelHint")} />
          <div className="p-4">
            {a.stages.length === 0 || a.stages.every((s) => Number(s.value) === 0) ? (
              <EmptyState icon={<BarChart3 className="h-6 w-6" />} title={t("analytics.noData")} />
            ) : (
              <div className="space-y-5">
                {funnels.map(([name, steps]) => (
                  <div key={name}>
                    {funnels.length > 1 ? <div className="mb-2 text-[12.5px] font-semibold text-muted">{name}</div> : null}
                    <FunnelPanel steps={funnelSteps(steps)} money={money} pct={pctFmt} labels={{ ofFirst: t("analytics.pro.ofFirst"), fromPrev: t("analytics.pro.fromPrev"), deals: (n) => t("deals.openCount", { count: n }) }} />
                  </div>
                ))}
              </div>
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
        <Card>
          <CardHeader title={t("analytics.pro.winLoss")} description={t("analytics.pro.winLossHint")} />
          <div className="p-5">
            {closed === 0 ? <EmptyState icon={<Trophy className="h-6 w-6" />} title={t("analytics.noData")} /> : <WinLossDonut won={Number(a.won)} lost={Number(a.lost)} center={winRate === null ? "—" : formatPercent(locale, winRate)} labels={{ won: t("analytics.pro.wonDeals"), lost: t("analytics.pro.lostDeals"), aria: t("analytics.pro.winLoss") }} />}
          </div>
          {Number(a.lost_value) > 0 ? <div className="border-t border-line px-5 py-3 text-[12.5px] text-muted">{t("analytics.pro.lostValue", { value: money(a.lost_value) })}</div> : null}
        </Card>
      </div>

      {meetings ? (
        <section className="mt-8 space-y-4" aria-labelledby="meetings-title" data-testid="meetings-section">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <h2 id="meetings-title" className="text-lg font-bold">
                {t("analytics.pro.meetingsTitle")}
              </h2>
              <p className="text-[13px] text-muted">{t("analytics.pro.meetingsSubtitle")}</p>
            </div>
            <Link href={`/${locale}/appointments?tab=insights`} className="text-[13px] font-medium text-accent hover:underline">
              {t("analytics.pro.meetingsMore")}
            </Link>
          </div>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 xl:grid-cols-6">
            <KpiCard id="m-total" label={t("analytics.pro.meetings.total")} value={formatNumber(locale, meetings.total)} icon={<CalendarCheck className="h-4 w-4" />} tone="accent" />
            <KpiCard id="m-held" label={t("analytics.pro.meetings.held")} value={formatNumber(locale, meetings.completed)} icon={<UserCheck className="h-4 w-4" />} tone="success" />
            <KpiCard id="m-show" label={t("appointments.pro.kpi.showRate")} value={meetings.showRate === null ? "—" : pctFmt(meetings.showRate)} icon={<Gauge className="h-4 w-4" />} tone="teal" />
            <KpiCard id="m-noshow" label={t("appointments.pro.kpi.noShowRate")} value={meetings.noShowRate === null ? "—" : pctFmt(meetings.noShowRate)} icon={<Timer className="h-4 w-4" />} tone="warning" danger={meetings.noShowRate !== null && meetings.noShowRate > 0.3} />
            <KpiCard id="m-upcoming" label={t("appointments.pro.kpi.upcoming")} value={formatNumber(locale, meetingsUpcoming)} icon={<TrendingUp className="h-4 w-4" />} tone="gold" />
            <KpiCard id="m-deal" label={t("analytics.pro.meetings.toDeal")} value={meetingContacts ? pctFmt(meetingContactsWon / meetingContacts) : "—"} sub={meetingContacts ? t("analytics.pro.meetings.toDealSub", { won: meetingContactsWon, total: meetingContacts }) : undefined} icon={<Sparkles className="h-4 w-4" />} tone="success" />
          </div>
          {meetings.total > 0 ? (
            <div className="grid gap-4 lg:grid-cols-2">
              <Card>
                <CardHeader title={t("appointments.pro.insights.weekly")} />
                <div className="p-4">
                  <WeeklyTrend data={meetings.weekly} label={t("appointments.pro.insights.weekly")} />
                </div>
              </Card>
              <Card>
                <CardHeader title={t("appointments.pro.insights.statusMix")} />
                <div className="p-5">
                  <StatusDonut data={meetings.byStatus} total={meetings.total} label={t("appointments.pro.insights.statusMix")} />
                </div>
              </Card>
            </div>
          ) : (
            <Card>
              <EmptyState icon={<CalendarCheck className="h-6 w-6" />} title={t("appointments.pro.insights.empty")} />
            </Card>
          )}
        </section>
      ) : null}

      {g ? (
        <section className="mt-8 space-y-4" aria-labelledby="growth-title" data-testid="growth-section">
          <div>
            <h2 id="growth-title" className="text-lg font-bold">
              {t("growth.title")}
            </h2>
            <p className="text-[13px] text-muted">{t("growth.subtitle")}</p>
          </div>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            {[
              { label: t("growth.revenue"), value: money(g.totals.revenue) },
              { label: t("growth.spend"), value: money(g.totals.spend) },
              { label: t("growth.roas"), value: ratio(g.totals.roas), sub: g.totals.roi === null ? t("growth.addSpend") : t("growth.roiValue", { roi: formatPercent(locale, Number(g.totals.roi)) }) },
              { label: t("growth.cac"), value: g.totals.cac === null ? "—" : money(g.totals.cac), sub: t("growth.newCustomers", { count: g.totals.customers }) },
              { label: t("growth.ltv"), value: money(g.ltv.ltv), sub: t("growth.ltvSub", { orders: g.ltv.avg_orders, months: g.ltv.avg_months }) },
              { label: t("growth.ltvCac"), value: ltvCac === null ? "—" : `${ltvCac.toFixed(1)}:1`, sub: ltvCac === null ? undefined : t(ltvCac >= 3 ? "growth.ltvCacGood" : "growth.ltvCacLow"), danger: ltvCac !== null && ltvCac < 1 },
              { label: t("growth.runRate"), value: money(g.run_rate), sub: t("growth.perMonth") },
              { label: t("growth.forecast3"), value: money(g.forecast.reduce((a, f) => a + Number(f.forecast), 0)) },
              { label: t("analytics.pro.leadToCustomer"), value: g.totals.leads ? pctFmt(Number(g.totals.customers) / Number(g.totals.leads)) : "—", sub: t("analytics.pro.leadToCustomerSub", { customers: g.totals.customers, leads: g.totals.leads }) },
              { label: t("analytics.pro.revenuePerCustomer"), value: g.totals.customers ? money(Number(g.totals.revenue) / Number(g.totals.customers)) : "—" },
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
