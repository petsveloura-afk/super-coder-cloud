import Link from "next/link";
import type { Metadata } from "next";
import { KanbanSquare, ThumbsDown, Trophy } from "lucide-react";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui/primitives";
import { KanbanBoard, type BoardDeal } from "@/components/pipelines/board";
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

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { t } = await getT(await resolveLocale(params));
  return { title: t("deals.pageTitle") };
}

type SP = Promise<Record<string, string | string[] | undefined>>;
const VIEWS = ["board", "won", "lost"] as const;

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
  const status = view === "board" ? "open" : view;
  const { data: rawDeals } = await supabase
    .from("deals")
    .select("id, title, value, currency, pipeline_id, stage_id, contact_id, company_id, expected_close_date, owner_id, status, position, closed_at, lost_reason, updated_at")
    .eq("organization_id", ctx.org.id)
    .eq("pipeline_id", selected.id)
    .eq("status", status)
    .order(view === "board" ? "position" : "closed_at", { ascending: view === "board" })
    .limit(view === "board" ? 1000 : 200);

  const contactName = new Map(contacts.map((c) => [c.id, c.label]));
  const companyName = new Map(companies.map((c) => [c.id, c.label]));
  const memberName = new Map(members.map((m) => [m.id, m.label]));
  const nowMs = new Date().getTime();
  const allDeals: (BoardDeal & { closed_at: string | null; lost_reason: string | null; updated_at?: string | null })[] = (rawDeals ?? []).map((d) => ({
    ...(d as unknown as BoardDeal & { closed_at: string | null; lost_reason: string | null }),
    value: Number(d.value),
    contact_name: d.contact_id ? (contactName.get(d.contact_id as string) ?? null) : null,
    company_name: d.company_id ? (companyName.get(d.company_id as string) ?? null) : null,
    owner_name: d.owner_id ? (memberName.get(d.owner_id as string) ?? null) : null,
    age_days: view === "board" ? dealAgeDays(d.updated_at as string | null, nowMs) : null,
    overdue: view === "board" ? isOverdue(d.expected_close_date as string | null) : false,
  }));
  // wave 24: quick filters (mine / stuck / late) and search, kept in the URL
  const dealFlag = (DEAL_FLAGS as readonly string[]).includes(String(sp.fl)) ? (sp.fl as DealFlag) : null;
  const dealSearch = searchTerm(sp.q);
  const deals = allDeals.filter((d) => {
    if (dealFlag === "mine" && d.owner_id !== ctx.userId) return false;
    if (dealFlag === "stale" && !isStale(d.age_days ?? null)) return false;
    if (dealFlag === "overdue" && !d.overdue) return false;
    if (dealSearch) {
      const hay = `${d.title} ${d.contact_name ?? ""} ${d.company_name ?? ""}`.toLowerCase();
      if (!hay.includes(dealSearch.toLowerCase())) return false;
    }
    return true;
  });

  const openValue = view === "board" ? deals.reduce((s, d) => s + d.value, 0) : 0;
  const prob = new Map(selected.stages.map((s) => [s.id, s.probability]));
  const weighted = view === "board" ? deals.reduce((s, d) => s + (d.value * (prob.get(d.stage_id) ?? 0)) / 100, 0) : 0;
  const currency = ctx.org.currency || "ILS";
  const since = new Date(nowMs - 90 * 86_400_000).toISOString();
  const { data: closedRows } =
    view === "board"
      ? await supabase.from("deals").select("status, value").eq("organization_id", ctx.org.id).eq("pipeline_id", selected.id).in("status", ["won", "lost"]).gte("closed_at", since).limit(2000)
      : { data: [] };
  const insights = pipelineInsights(
    allDeals.map((d) => ({ value: d.value, stage_id: d.stage_id, expected_close_date: d.expected_close_date, updated_at: d.updated_at })),
    ((closedRows ?? []) as { status: "won" | "lost"; value: number }[]).map((r) => ({ status: r.status, value: Number(r.value) })),
    prob,
  );
  const flagHref = (fl: DealFlag | null) => {
    const q = new URLSearchParams({ p: selected.id });
    if (fl) q.set("fl", fl);
    if (dealSearch) q.set("q", dealSearch);
    return `/${locale}/pipelines?${q.toString()}`;
  };
  const href = (over: Record<string, string>) => {
    const q = new URLSearchParams({ p: selected.id, ...over });
    if (q.get("view") === "board") q.delete("view");
    return `/${locale}/pipelines?${q.toString()}`;
  };

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
              {v === "won" ? <Trophy className="h-3.5 w-3.5" /> : v === "lost" ? <ThumbsDown className="h-3.5 w-3.5" /> : <KanbanSquare className="h-3.5 w-3.5" />}
              {t(`deals.views.${v}`)}
            </Link>
          ))}
        </div>
      </Card>

      {view === "board" ? (
        <>
          <div className="mb-3 flex flex-wrap gap-2 text-[13px]">
            <Badge tone="neutral">{t("deals.openCount", { count: deals.length })}</Badge>
            <Badge tone="neutral">
              {t("deals.openValue")}: <bdi dir="ltr">{formatCurrency(locale, openValue, currency)}</bdi>
            </Badge>
            <Badge tone="gold">
              {t("deals.weightedValue")}: <bdi dir="ltr">{formatCurrency(locale, weighted, currency)}</bdi>
            </Badge>
          </div>
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
            <form key={`${dealFlag ?? ""}|${dealSearch ?? ""}`} action={`/${locale}/pipelines`} method="get" role="search" className="ms-auto flex gap-1.5">
              <input type="hidden" name="p" value={selected.id} />
              {dealFlag ? <input type="hidden" name="fl" value={dealFlag} /> : null}
              <input name="q" defaultValue={dealSearch ?? ""} maxLength={60} placeholder={t("deals.insights.search")} aria-label={t("deals.insights.search")} className="h-8 w-40 rounded-lg border border-line bg-surface px-2.5 text-[12.5px] outline-none focus:border-accent sm:w-56" />
            </form>
          </div>
          {deals.length === 0 && !canWrite ? (
            <Card>
              <EmptyState icon={<KanbanSquare className="h-6 w-6" />} title={t("deals.empty")} />
            </Card>
          ) : (
            <KanbanBoard
              stages={selected.stages.map((s) => ({ id: s.id, name: s.name, probability: s.probability }))}
              deals={deals}
              pickers={pickers}
              canWrite={canWrite}
              canDelete={ctx.can("deals.delete")}
              currency={currency}
            />
          )}
        </>
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
