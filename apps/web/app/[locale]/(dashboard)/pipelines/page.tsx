import Link from "next/link";
import type { Metadata } from "next";
import { Brain, KanbanSquare, List, ThumbsDown, Trophy, Zap } from "lucide-react";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui/primitives";
import { KanbanBoard, type BoardDeal, type StageMeta } from "@/components/pipelines/board";
import { FocusPanel, ForecastPanel, FunnelPanel, HealthRing, LevelBadge, OwnerPanel, VelocityStrip, type BrainInfo, type FocusRow, type FunnelRow, type OwnerView } from "@/components/pipelines/pipeline-brain";
import { EditDealDialog, NewDealButton, type DealPickers } from "@/components/pipelines/deal-form";
import { NewPipelineButton, PipelineManager } from "@/components/pipelines/pipeline-manager";
import { getOrgContext } from "@/lib/auth";
import { getT, resolveLocale } from "@/lib/i18n/server";
import { createClient } from "@/lib/supabase/server";
import { companyOptions, contactOptions, memberOptions, pipelinesWithStages } from "@/lib/lookups";
import { formatCurrency, formatDate } from "@/lib/format";
import { pipelineLabel, stageLabel } from "@/lib/labels";
import { cn } from "@/lib/utils";
import { DEAL_FLAGS, dealAgeDays, isOverdue, isStale, pipelineInsights, type DealFlag } from "@/lib/deals/insights";
import { searchTerm } from "@/lib/inbox/sla";
import { dealReasonText } from "@/lib/deals/brain-text";
import {
  BRAIN_FLAGS, DEAL_SORTS, adaptiveWinChance, bottleneck, compareDeals, dealHealth, daysUntil, focusList, forecast, matchesBrainFlag, nextBestAction,
  ownerBoard, salesVelocity, stageFlow, stageProgressMap, type BrainFlag, type DealSort, type HealthLevel, type StageHistoryRow,
} from "@/lib/deals/brain";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { t } = await getT(await resolveLocale(params));
  return { title: t("deals.pageTitle") };
}

type SP = Promise<Record<string, string | string[] | undefined>>;
const VIEWS = ["board", "list", "insights", "won", "lost"] as const;
const OPEN_VIEWS = new Set<string>(["board", "list", "insights"]);
type AnyFlag = DealFlag | BrainFlag;

export default async function PipelinesPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: SP }) {
  const locale = await resolveLocale(params);
  const ctx = await getOrgContext(locale);
  const { t } = await getT(locale);
  const sp = await searchParams;
  if (!ctx.can("deals.read")) {
    return (
      <Card>
        <EmptyState title={t("errors.forbidden")} />
      </Card>
    );
  }

  const [pipelines, contacts, companies, members] = await Promise.all([
    pipelinesWithStages(ctx.org.id),
    contactOptions(ctx.org.id),
    companyOptions(ctx.org.id),
    memberOptions(ctx.org.id),
  ]);
  const selected = pipelines.find((p) => p.id === sp.p) ?? pipelines[0];
  const view = (VIEWS as readonly string[]).includes(String(sp.view)) ? (sp.view as (typeof VIEWS)[number]) : "board";
  const isOpenView = OPEN_VIEWS.has(view);
  const canWrite = ctx.can("deals.write");
  const canManage = ctx.can("settings.manage");

  const pickers: DealPickers = {
    pipelines: pipelines.map((p) => ({ id: p.id, name: p.name, stages: p.stages.map((s) => ({ id: s.id, name: s.name })) })),
    contacts,
    companies,
    members,
  };

  if (!selected) {
    return (
      <>
        <PageHeader title={t("deals.pageTitle")} description={t("deals.subtitle")} actions={canManage ? <NewPipelineButton /> : null} />
        <Card>
          <EmptyState icon={<KanbanSquare className="h-6 w-6" />} title={t("deals.noPipelines")} />
        </Card>
      </>
    );
  }

  const supabase = await createClient();
  const status = isOpenView ? "open" : view;
  const { data: rawDeals } = await supabase
    .from("deals")
    .select("id, title, value, currency, pipeline_id, stage_id, contact_id, company_id, expected_close_date, owner_id, status, position, closed_at, lost_reason, updated_at, created_at")
    .eq("organization_id", ctx.org.id)
    .eq("pipeline_id", selected.id)
    .eq("status", status)
    .order(isOpenView ? "position" : "closed_at", { ascending: isOpenView })
    .limit(isOpenView ? 1000 : 200);

  const contactName = new Map(contacts.map((c) => [c.id, c.label]));
  const companyName = new Map(companies.map((c) => [c.id, c.label]));
  const memberName = new Map(members.map((m) => [m.id, m.label]));
  const nowMs = new Date().getTime();

  // wave 38 — the pipeline brain: stage history, closed deals, per-stage benchmarks, then a health score for every open deal
  const closedSince = new Date(nowMs - 180 * 86_400_000).toISOString();
  const [historyRes, closedRes] = isOpenView
    ? await Promise.all([
        supabase.from("deal_stage_history").select("deal_id, from_stage_id, to_stage_id, entered_at").eq("organization_id", ctx.org.id).eq("pipeline_id", selected.id).order("entered_at", { ascending: false }).limit(5000),
        supabase.from("deals").select("id, status, value, owner_id, created_at, closed_at").eq("organization_id", ctx.org.id).eq("pipeline_id", selected.id).in("status", ["won", "lost"]).gte("closed_at", closedSince).limit(2000),
      ])
    : [{ data: [], error: null }, { data: [], error: null }];
  // before the wave-38 migration the history table does not exist yet — the brain then works from the deals alone
  const history = (historyRes.error ? [] : (historyRes.data ?? [])) as StageHistoryRow[];
  const closedAll = ((closedRes.data ?? []) as { id: string; status: "won" | "lost"; value: number; owner_id: string | null; created_at: string | null; closed_at: string | null }[]).map((r) => ({ ...r, value: Number(r.value) }));
  const openStageOf = new Map((rawDeals ?? []).map((d) => [d.id as string, d.stage_id as string]));
  const flow = stageFlow(selected.stages, history, openStageOf, new Set(closedAll.filter((c) => c.status === "won").map((c) => c.id)));
  const benchmark = new Map(flow.filter((f) => f.avgDays !== null).map((f) => [f.stageId, f.avgDays as number]));
  const flowBottleneck = bottleneck(flow);
  const enteredAt = new Map<string, string>(); // history is newest first: the first row seen per deal is its current stage entry
  for (const h of history) if (!enteredAt.has(h.deal_id)) enteredAt.set(h.deal_id, h.entered_at);
  const openRaw = rawDeals ?? [];
  const avgValue = openRaw.length ? openRaw.reduce((s, d) => s + Number(d.value), 0) / openRaw.length : 0;
  const progress = stageProgressMap(selected.stages);
  const stageProb = new Map(selected.stages.map((s) => [s.id, s.probability]));
  const brainFor = (d: Record<string, unknown>): BrainInfo => {
    const bd = {
      id: d.id as string, title: d.title as string, value: Number(d.value), stage_id: d.stage_id as string, expected_close_date: (d.expected_close_date as string | null) ?? null,
      owner_id: (d.owner_id as string | null) ?? null, contact_id: (d.contact_id as string | null) ?? null, updated_at: d.updated_at as string | null, created_at: d.created_at as string | null,
      stage_entered_at: enteredAt.get(d.id as string) ?? null,
    };
    const h = dealHealth(bd, { stageBenchmarkDays: benchmark, avgValue, stageProgress: progress });
    const a = nextBestAction(bd, h);
    return { score: h.score, level: h.level, winChance: adaptiveWinChance(stageProb.get(bd.stage_id) ?? 0, h.score), action: a.key, urgency: a.urgency, reasons: h.reasons, daysInStage: h.daysInStage };
  };
  const allDeals: (BoardDeal & { closed_at: string | null; lost_reason: string | null; updated_at?: string | null })[] = (rawDeals ?? []).map((d) => ({
    ...(d as unknown as BoardDeal & { closed_at: string | null; lost_reason: string | null }),
    value: Number(d.value),
    contact_name: d.contact_id ? (contactName.get(d.contact_id as string) ?? null) : null,
    company_name: d.company_id ? (companyName.get(d.company_id as string) ?? null) : null,
    owner_name: d.owner_id ? (memberName.get(d.owner_id as string) ?? null) : null,
    age_days: isOpenView ? dealAgeDays(d.updated_at as string | null, nowMs) : null,
    overdue: isOpenView ? isOverdue(d.expected_close_date as string | null) : false,
    brain: isOpenView ? brainFor(d as unknown as Record<string, unknown>) : undefined,
  }));
  // wave 24: quick filters (mine / stuck / late) and search, kept in the URL
  const dealFlag = ([...DEAL_FLAGS, ...BRAIN_FLAGS] as readonly string[]).includes(String(sp.fl)) ? (sp.fl as AnyFlag) : null;
  const sortKey: DealSort = (DEAL_SORTS as readonly string[]).includes(String(sp.sort)) ? (sp.sort as DealSort) : "position";
  const ownFilter = typeof sp.own === "string" && members.some((m) => m.id === sp.own) ? sp.own : null;
  const dealSearch = searchTerm(sp.q);
  const deals = allDeals.filter((d) => {
    if (dealFlag === "mine" && d.owner_id !== ctx.userId) return false;
    if (dealFlag === "stale" && !isStale(d.age_days ?? null)) return false;
    if (dealFlag === "overdue" && !d.overdue) return false;
    if (dealFlag && (BRAIN_FLAGS as readonly string[]).includes(dealFlag) && d.brain && !matchesBrainFlag(dealFlag as BrainFlag, d, d.brain)) return false;
    if (ownFilter && d.owner_id !== ownFilter) return false;
    if (dealSearch) {
      const hay = `${d.title} ${d.contact_name ?? ""} ${d.company_name ?? ""}`.toLowerCase();
      if (!hay.includes(dealSearch.toLowerCase())) return false;
    }
    return true;
  });

  const openValue = isOpenView ? deals.reduce((s, d) => s + d.value, 0) : 0;
  const prob = new Map(selected.stages.map((s) => [s.id, s.probability]));
  const weighted = isOpenView ? deals.reduce((s, d) => s + (d.value * (prob.get(d.stage_id) ?? 0)) / 100, 0) : 0;
  const currency = ctx.org.currency || "ILS";
  const since = new Date(nowMs - 90 * 86_400_000).toISOString();
  const closedRows = closedAll.filter((c) => (c.closed_at ?? "") >= since);
  const insights = pipelineInsights(
    allDeals.map((d) => ({ value: d.value, stage_id: d.stage_id, expected_close_date: d.expected_close_date, updated_at: d.updated_at })),
    ((closedRows ?? []) as { status: "won" | "lost"; value: number }[]).map((r) => ({ status: r.status, value: Number(r.value) })),
    prob,
  );
  const keep = (q: URLSearchParams, skip: string[] = []) => {
    if (dealFlag && !skip.includes("fl")) q.set("fl", dealFlag);
    if (dealSearch && !skip.includes("q")) q.set("q", dealSearch);
    if (sortKey !== "position" && !skip.includes("sort")) q.set("sort", sortKey);
    if (ownFilter && !skip.includes("own")) q.set("own", ownFilter);
    return q;
  };
  const flagHref = (fl: AnyFlag | null) => {
    const q = keep(new URLSearchParams({ p: selected.id }), ["fl"]);
    if (fl) q.set("fl", fl);
    if (view !== "board") q.set("view", view);
    return `/${locale}/pipelines?${q.toString()}`;
  };
  const sortHref = (sk: DealSort) => {
    const q = keep(new URLSearchParams({ p: selected.id }), ["sort"]);
    if (sk !== "position") q.set("sort", sk);
    if (view !== "board") q.set("view", view);
    return `/${locale}/pipelines?${q.toString()}`;
  };
  const href = (over: Record<string, string>) => {
    const q = new URLSearchParams({ p: selected.id, ...over });
    if (q.get("view") === "board") q.delete("view");
    return `/${locale}/pipelines?${q.toString()}`;
  };

  // wave 38 — numbers the brain panels need (all from the full open pipeline, not the filtered view)
  const openInfo = allDeals.filter((d) => d.brain);
  const healthSpread: Record<HealthLevel, number> = { hot: 0, healthy: 0, cooling: 0, risk: 0 };
  for (const d of openInfo) healthSpread[d.brain!.level]++;
  const adaptiveValue = isOpenView ? deals.reduce((sum, d) => sum + (d.value * (d.brain?.winChance ?? prob.get(d.stage_id) ?? 0)) / 100, 0) : 0;
  const stageName = new Map(selected.stages.map((s) => [s.id, s.name]));
  const velocity = salesVelocity(openInfo.length, closedAll);
  const urgentCount = openInfo.filter((d) => d.brain!.urgency === 3 && d.brain!.action !== "keepGoing").length;
  const sortable = (d: (typeof deals)[number]) => ({
    value: d.value,
    position: d.position,
    expected_close_date: d.expected_close_date,
    health: { score: d.brain?.score ?? 0, level: d.brain?.level ?? ("healthy" as HealthLevel), reasons: [], ageDays: d.age_days ?? null, daysInStage: null, daysToClose: null },
  });
  const cmp = compareDeals(sortKey);
  const sortedDeals = [...deals].sort((a, b) => cmp(sortable(a), sortable(b)));
  const rankOf = new Map(sortedDeals.map((d, i) => [d.id, i]));
  const stageIndex = new Map(selected.stages.map((st, i) => [st.id, i]));
  const listDeals = sortKey === "position" ? [...deals].sort((a, b) => (stageIndex.get(a.stage_id) ?? 0) - (stageIndex.get(b.stage_id) ?? 0) || a.position - b.position) : sortedDeals;
  const boardDeals = sortKey === "position" ? deals : deals.map((d) => ({ ...d, sortRank: rankOf.get(d.id) ?? 0 }));
  const stageMeta: Record<string, StageMeta> = Object.fromEntries(
    flow.map((f) => [f.stageId, { avgDays: f.avgDays, conversion: f.conversion, bottleneck: flowBottleneck?.stageId === f.stageId ? flowBottleneck.reason : undefined } satisfies StageMeta]),
  );
  const focusRows: FocusRow[] = focusList(
    openInfo.map((d) => ({
      id: d.id, title: d.title, value: d.value, stage_id: d.stage_id, expected_close_date: d.expected_close_date, owner_id: d.owner_id, contact_id: d.contact_id,
      winChance: d.brain!.winChance,
      health: { score: d.brain!.score, level: d.brain!.level, reasons: d.brain!.reasons, ageDays: d.age_days ?? null, daysInStage: d.brain!.daysInStage, daysToClose: daysUntil(d.expected_close_date) },
    })),
    6,
  ).flatMap((f) => {
    const deal = openInfo.find((d) => d.id === f.id);
    return deal && deal.brain ? [{ deal, brain: deal.brain, stageName: stageName.get(deal.stage_id) ?? "" }] : [];
  });
  const funnelRows: FunnelRow[] = selected.stages.map((st) => {
    const f = flow.find((x) => x.stageId === st.id)!;
    return {
      stageId: st.id, name: st.name, probability: st.probability, entered: f.entered, advanced: f.advanced, conversion: f.conversion, avgDays: f.avgDays, current: f.current,
      value: openInfo.filter((d) => d.stage_id === st.id).reduce((sum, d) => sum + d.value, 0),
      bottleneck: flowBottleneck?.stageId === st.id ? flowBottleneck.reason : undefined,
    };
  });
  const forecastData = forecast(
    openInfo.map((d) => ({ value: d.value, stage_id: d.stage_id, expected_close_date: d.expected_close_date, health: d.brain!.score })),
    prob,
  );
  const ownerRows: OwnerView[] = ownerBoard(
    openInfo.map((d) => ({ owner_id: d.owner_id, value: d.value, weighted: (d.value * d.brain!.winChance) / 100, health: d.brain!.level })),
    closedAll.map((c) => ({ owner_id: c.owner_id, status: c.status })),
  ).map((r) => ({ ...r, name: r.ownerId ? (memberName.get(r.ownerId) ?? null) : null }));

  return (
    <>
      <PageHeader
        title={t("deals.pageTitle")}
        description={t("deals.subtitle")}
        actions={
          <>
            {canManage ? <PipelineManager pipeline={selected} /> : null}
            {canManage ? <NewPipelineButton /> : null}
            {canWrite ? <NewDealButton pickers={pickers} defaults={{ pipeline_id: selected.id, stage_id: selected.stages[0]?.id, currency }} /> : null}
          </>
        }
      />

      <Card className="mb-4 flex flex-col gap-3 p-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex gap-1 overflow-x-auto" role="tablist" aria-label={t("deals.pipeline")}>
          {pipelines.map((p) => (
            <Link
              key={p.id}
              href={`/${locale}/pipelines?p=${p.id}`}
              role="tab"
              aria-selected={p.id === selected.id}
              className={cn(
                "flex h-9 shrink-0 items-center rounded-xl px-3.5 text-[13px]",
                p.id === selected.id ? "bg-accent-soft font-semibold text-accent" : "text-muted hover:bg-surface-hover hover:text-fg",
              )}
            >
              {pipelineLabel(t, p.name)}
            </Link>
          ))}
        </div>
        <div className="flex gap-1 overflow-x-auto" role="tablist" aria-label={t("deals.view")}>
          {VIEWS.map((v) => (
            <Link
              key={v}
              href={href({ view: v })}
              role="tab"
              aria-selected={view === v}
              className={cn(
                "flex h-9 shrink-0 items-center gap-1.5 rounded-xl px-3.5 text-[13px]",
                view === v ? "bg-accent-soft font-semibold text-accent" : "text-muted hover:bg-surface-hover hover:text-fg",
              )}
            >
              {v === "won" ? <Trophy className="h-3.5 w-3.5" /> : v === "lost" ? <ThumbsDown className="h-3.5 w-3.5" /> : v === "list" ? <List className="h-3.5 w-3.5" /> : v === "insights" ? <Brain className="h-3.5 w-3.5" /> : <KanbanSquare className="h-3.5 w-3.5" />}
              {t(`deals.views.${v}`)}
            </Link>
          ))}
        </div>
      </Card>

      {view === "board" || view === "list" ? (
        <>
          <div className="mb-3 flex flex-wrap gap-2 text-[13px]">
            <Badge tone="neutral">{t("deals.openCount", { count: deals.length })}</Badge>
            <Badge tone="neutral">
              {t("deals.openValue")}: <bdi dir="ltr">{formatCurrency(locale, openValue, currency)}</bdi>
            </Badge>
            <Badge tone="gold">
              {t("deals.weightedValue")}: <bdi dir="ltr">{formatCurrency(locale, weighted, currency)}</bdi>
            </Badge>
            <Badge tone="accent" className="brain-pulse">
              <Brain className="h-3.5 w-3.5" />
              {t("deals.brain.adaptiveValue")}: <bdi dir="ltr">{formatCurrency(locale, Math.round(adaptiveValue), currency)}</bdi>
            </Badge>
          </div>
          {/* wave 38: the brain banner — one click to the full picture */}
          <Link
            href={href({ view: "insights" })}
            data-testid="brain-banner"
            className={cn("mb-3 flex items-center gap-3 rounded-2xl border border-accent/25 bg-accent-soft px-4 py-3 text-[13px] transition-colors hover:border-accent", urgentCount > 0 && "brain-pulse")}
          >
            <Brain className="h-5 w-5 shrink-0 text-accent" />
            <span className="min-w-0 flex-1">
              <b>{t("deals.brain.banner.title")}</b>{" "}
              <span className="text-muted">{urgentCount > 0 ? t("deals.brain.banner.urgent", { count: urgentCount }) : t("deals.brain.banner.calm")}</span>
            </span>
            <span className="shrink-0 font-semibold text-accent">{t("deals.brain.banner.open")}</span>
          </Link>
          {/* wave 24: insights + quick filters */}
          <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4" data-testid="deal-insights">
            {[
              { k: "winRate", v: insights.winRate === null ? "—" : `${insights.winRate}%`, sub: t("deals.insights.closed90", { won: insights.closedWon, lost: insights.closedLost }) },
              { k: "avgWon", v: insights.avgWon === null ? "—" : formatCurrency(locale, insights.avgWon, currency), sub: t("deals.insights.last90") },
              { k: "forecast", v: formatCurrency(locale, insights.forecastMonth, currency), sub: t("deals.insights.forecastSub") },
              { k: "attention", v: String(insights.staleCount + insights.overdueCount), sub: t("deals.insights.attentionSub", { stale: insights.staleCount, overdue: insights.overdueCount }) },
            ].map((x) => (
              <Card key={x.k} className="p-3">
                <p className="text-[11.5px] font-medium text-muted">{t(`deals.insights.${x.k}`)}</p>
                <p className="mt-0.5 text-lg font-bold tabular-nums" dir="ltr">{x.v}</p>
                <p className="text-[11px] text-subtle">{x.sub}</p>
              </Card>
            ))}
          </div>
          <div className="mb-3 flex flex-wrap items-center gap-1.5">
            <Link href={flagHref(null)} aria-pressed={dealFlag === null} className={cn("rounded-full border px-2.5 py-1 text-[12px]", dealFlag === null ? "border-accent bg-accent-soft font-semibold text-accent" : "border-line text-muted hover:bg-surface-hover")}>
              {t("deals.insights.all")}
            </Link>
            {DEAL_FLAGS.map((fl) => (
              <Link key={fl} href={flagHref(dealFlag === fl ? null : fl)} aria-pressed={dealFlag === fl} data-testid={`deal-flag-${fl}`} className={cn("rounded-full border px-2.5 py-1 text-[12px]", dealFlag === fl ? "border-accent bg-accent-soft font-semibold text-accent" : "border-line text-muted hover:bg-surface-hover")}>
                {t(`deals.insights.flags.${fl}`)}
              </Link>
            ))}
            {BRAIN_FLAGS.map((fl) => (
              <Link key={fl} href={flagHref(dealFlag === fl ? null : fl)} aria-pressed={dealFlag === fl} data-testid={`deal-flag-${fl}`} className={cn("rounded-full border px-2.5 py-1 text-[12px]", dealFlag === fl ? "border-accent bg-accent-soft font-semibold text-accent" : "border-line text-muted hover:bg-surface-hover")}>
                {t(`deals.brain.flags.${fl}`)}
              </Link>
            ))}
            <form key={`${dealFlag ?? ""}|${dealSearch ?? ""}|${sortKey}|${ownFilter ?? ""}|${view}`} action={`/${locale}/pipelines`} method="get" role="search" className="ms-auto flex gap-1.5">
              <input type="hidden" name="p" value={selected.id} />
              {dealFlag ? <input type="hidden" name="fl" value={dealFlag} /> : null}
              {sortKey !== "position" ? <input type="hidden" name="sort" value={sortKey} /> : null}
              {ownFilter ? <input type="hidden" name="own" value={ownFilter} /> : null}
              {view !== "board" ? <input type="hidden" name="view" value={view} /> : null}
              <input name="q" defaultValue={dealSearch ?? ""} maxLength={60} placeholder={t("deals.insights.search")} aria-label={t("deals.insights.search")} className="h-8 w-40 rounded-lg border border-line bg-surface px-2.5 text-[12.5px] outline-none focus:border-accent sm:w-56" />
            </form>
          </div>
          {/* wave 38: sort + owner filter */}
          <div className="mb-3 flex flex-wrap items-center gap-1.5 text-[12px]" data-testid="deal-sort">
            <span className="text-subtle">{t("deals.brain.sort.label")}:</span>
            {DEAL_SORTS.map((sk) => (
              <Link key={sk} href={sortHref(sk)} aria-pressed={sortKey === sk} data-testid={`deal-sort-${sk}`} className={cn("rounded-full border px-2.5 py-1", sortKey === sk ? "border-accent bg-accent-soft font-semibold text-accent" : "border-line text-muted hover:bg-surface-hover")}>
                {t(`deals.brain.sort.${sk}`)}
              </Link>
            ))}
            {members.length > 1 ? (
              <form action={`/${locale}/pipelines`} method="get" className="ms-auto flex items-center gap-1.5">
                <input type="hidden" name="p" value={selected.id} />
                {dealFlag ? <input type="hidden" name="fl" value={dealFlag} /> : null}
                {dealSearch ? <input type="hidden" name="q" value={dealSearch} /> : null}
                {sortKey !== "position" ? <input type="hidden" name="sort" value={sortKey} /> : null}
                {view !== "board" ? <input type="hidden" name="view" value={view} /> : null}
                <label className="sr-only" htmlFor="deal-owner-filter">{t("deals.brain.ownerFilter")}</label>
                <select id="deal-owner-filter" name="own" defaultValue={ownFilter ?? ""} className="h-8 rounded-lg border border-line bg-surface px-2 text-[12.5px] outline-none focus:border-accent">
                  <option value="">{t("deals.brain.allOwners")}</option>
                  {members.map((m) => (
                    <option key={m.id} value={m.id}>{m.label}</option>
                  ))}
                </select>
                <button type="submit" className="h-8 rounded-lg border border-line px-2.5 text-muted hover:bg-surface-hover">{t("deals.brain.apply")}</button>
              </form>
            ) : null}
          </div>
          {view === "list" ? (
            deals.length === 0 ? (
              <Card>
                <EmptyState icon={<List className="h-6 w-6" />} title={t("deals.empty")} />
              </Card>
            ) : (
              <Card className="overflow-hidden" data-testid="deal-list">
                <ul className="divide-y divide-line">
                  {listDeals.map((d, idx) => (
                    <li key={d.id} className="fade-slide" style={{ animationDelay: `${Math.min(idx, 12) * 25}ms` }}>
                      <EditDealDialog
                        deal={d}
                        pickers={pickers}
                        canWrite={canWrite}
                        canDelete={ctx.can("deals.delete")}
                        trigger={
                          <button type="button" className="flex w-full flex-wrap items-center gap-x-4 gap-y-1.5 px-4 py-3 text-start hover:bg-surface-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                            {d.brain ? <HealthRing score={d.brain.score} level={d.brain.level} size={38} label={`${t("deals.brain.healthLabel", { score: d.brain.score })} — ${dealReasonText(t, d.brain.reasons)}`} /> : null}
                            <span className="min-w-0 flex-1 basis-48">
                              <span className="block truncate text-[14px] font-semibold">{d.title}</span>
                              <span className="block truncate text-[12px] text-muted">{[d.contact_name, d.company_name].filter(Boolean).join(" · ") || "—"}</span>
                              {d.brain && d.brain.action !== "keepGoing" ? (
                                <span className={cn("mt-0.5 flex items-center gap-1 text-[11.5px] font-medium", d.brain.urgency === 3 ? "text-danger" : "text-accent")}>
                                  <Zap className="h-3 w-3" />
                                  {t(`deals.brain.actions.${d.brain.action}`)}
                                </span>
                              ) : null}
                            </span>
                            <span className="w-24 text-[12.5px] text-muted">{stageLabel(t, stageName.get(d.stage_id) ?? "")}</span>
                            {d.brain ? <LevelBadge level={d.brain.level} /> : null}
                            <span className="w-16 text-[12.5px] font-semibold tabular-nums text-muted">{d.brain ? t("deals.brain.winChance", { pct: d.brain.winChance }) : ""}</span>
                            <span className={cn("w-24 text-[12.5px]", d.overdue ? "font-semibold text-danger" : "text-subtle")}>{d.expected_close_date ? formatDate(locale, d.expected_close_date) : "—"}</span>
                            <span className="w-16 text-[12px] text-subtle">{d.age_days != null ? t("deals.brain.days", { count: d.age_days }) : "—"}</span>
                            <span className="w-28 text-end text-[14px] font-bold tabular-nums">
                              <bdi dir="ltr">{formatCurrency(locale, d.value, d.currency)}</bdi>
                            </span>
                          </button>
                        }
                      />
                    </li>
                  ))}
                </ul>
              </Card>
            )
          ) : deals.length === 0 && !canWrite ? (
            <Card>
              <EmptyState icon={<KanbanSquare className="h-6 w-6" />} title={t("deals.empty")} />
            </Card>
          ) : (
            <KanbanBoard
              stages={selected.stages.map((s) => ({ id: s.id, name: s.name, probability: s.probability }))}
              deals={boardDeals}
              pickers={pickers}
              canWrite={canWrite}
              canDelete={ctx.can("deals.delete")}
              currency={currency}
              stageMeta={stageMeta}
            />
          )}
        </>
      ) : view === "insights" ? (
        <div className="space-y-4" data-testid="brain-insights">
          <VelocityStrip perMonth={velocity.perMonth} avgCycleDays={velocity.avgCycleDays} winRate={velocity.winRate} openHealth={healthSpread} currency={currency} />
          <div className="grid gap-4 lg:grid-cols-2">
            <FocusPanel rows={focusRows} pickers={pickers} canWrite={canWrite} canDelete={ctx.can("deals.delete")} currency={currency} />
            <ForecastPanel data={forecastData} currency={currency} />
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <FunnelPanel rows={funnelRows} currency={currency} />
            <OwnerPanel rows={ownerRows} currency={currency} />
          </div>
        </div>
      ) : deals.length === 0 ? (
        <Card>
          <EmptyState icon={view === "won" ? <Trophy className="h-6 w-6" /> : <ThumbsDown className="h-6 w-6" />} title={t(`deals.empty_${view}`)} />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <ul className="divide-y divide-line">
            {deals.map((d) => (
              <li key={d.id}>
                <EditDealDialog
                  deal={d}
                  pickers={pickers}
                  canWrite={canWrite}
                  canDelete={ctx.can("deals.delete")}
                  trigger={
                    <button type="button" className="flex w-full flex-col gap-1 px-5 py-3.5 text-start hover:bg-surface-hover sm:flex-row sm:items-center sm:gap-4">
                      <span className="min-w-0 flex-1 truncate font-medium">{d.title}</span>
                      <span className="text-[13px] text-muted">{[d.contact_name, d.company_name].filter(Boolean).join(" · ") || "—"}</span>
                      <span className="text-[13px] text-muted">{stageLabel(t, selected.stages.find((s) => s.id === d.stage_id)?.name ?? "")}</span>
                      <span className="text-[13px] text-subtle">{d.closed_at ? formatDate(locale, d.closed_at) : "—"}</span>
                      <span className={cn("font-semibold", view === "won" ? "text-success" : "text-muted")}>
                        <bdi dir="ltr">{formatCurrency(locale, d.value, d.currency)}</bdi>
                      </span>
                    </button>
                  }
                />
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}
