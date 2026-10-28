"use client";

import { useMemo, useState, useTransition, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { TriangleAlert, CalendarDays, ChevronDown, ChevronUp, GripVertical, ThumbsDown, Trophy, User, Zap } from "lucide-react";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n/client";
import { stageLabel } from "@/lib/labels";
import { formatCurrency, formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { moveDealAction, setDealStatusAction } from "@/app/[locale]/(dashboard)/pipelines/actions";
import { EditDealDialog, type DealPickers, type DealRecord } from "./deal-form";
import { HealthRing, LEVEL_TONE, reasonText, type BrainInfo } from "./pipeline-brain";

export interface BoardDeal extends DealRecord {
  contact_name: string | null;
  company_name: string | null;
  owner_name: string | null;
  position: number;
  /** wave 24: days since the last change, and whether the expected close date passed */
  age_days?: number | null;
  overdue?: boolean;
  /** wave 38: health score, adaptive win chance and the next best action (computed by lib/deals/brain) */
  brain?: BrainInfo;
  /** wave 38: visual order inside a stage when a sort other than "manual" is chosen (never persisted) */
  sortRank?: number;
}

export interface BoardStage {
  id: string;
  name: string;
  probability: number;
}

/** wave 38: what the stage history says about a stage */
export interface StageMeta {
  avgDays: number | null;
  conversion: number | null;
  bottleneck?: "slow" | "leaky";
}

/** Quick won / lost buttons on a card (same server action as the edit dialog). */
function QuickStatus({ id, onDone }: { id: string; onDone: () => void }) {
  const { t, locale } = useI18n();
  const [pending, startTransition] = useTransition();
  function set(status: "won" | "lost") {
    if (status === "lost" && !window.confirm(t("deals.confirmLost"))) return;
    startTransition(async () => {
      const fd = new FormData();
      fd.set("locale", locale);
      fd.set("id", id);
      fd.set("status", status);
      const res = await setDealStatusAction(fd);
      if (res.error) toast.error(t(res.error));
      else {
        toast.success(t(res.message ?? "common.saved"));
        onDone();
      }
    });
  }
  return (
    <span className="flex items-center gap-0.5">
      <button type="button" disabled={pending} onClick={() => set("won")} title={t("deals.markWon")} aria-label={t("deals.markWon")} data-testid="quick-won" className="grid h-7 w-7 place-items-center rounded-lg text-muted hover:bg-success-soft hover:text-success focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50">
        <Trophy className="h-3.5 w-3.5" />
      </button>
      <button type="button" disabled={pending} onClick={() => set("lost")} title={t("deals.markLost")} aria-label={t("deals.markLost")} data-testid="quick-lost" className="grid h-7 w-7 place-items-center rounded-lg text-muted hover:bg-danger-soft hover:text-danger focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50">
        <ThumbsDown className="h-3.5 w-3.5" />
      </button>
    </span>
  );
}

/**
 * Kanban board. Drag & drop on desktop (HTML5 DnD) plus an accessible
 * "move to stage" select on every card (keyboard, screen readers, touch).
 * Moves are optimistic and roll back if the server refuses.
 */
export function KanbanBoard({
  stages,
  deals,
  pickers,
  canWrite,
  canDelete,
  currency,
  stageMeta,
}: {
  stages: BoardStage[];
  deals: BoardDeal[];
  pickers: DealPickers;
  canWrite: boolean;
  canDelete: boolean;
  currency: string;
  stageMeta?: Record<string, StageMeta>;
}) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [items, setItems] = useState(deals);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overStage, setOverStage] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [, startTransition] = useTransition();

  // New server data (after refresh) replaces local optimistic state
  // (React's "adjust state when a prop changes" pattern — no effect needed).
  const [prevDeals, setPrevDeals] = useState(deals);
  if (deals !== prevDeals) {
    setPrevDeals(deals);
    setItems(deals);
  }

  const byStage = useMemo(() => {
    const m = new Map<string, BoardDeal[]>();
    for (const s of stages) m.set(s.id, []);
    for (const d of items) m.get(d.stage_id)?.push(d);
    for (const list of m.values()) list.sort((a, b) => (a.sortRank ?? a.position) - (b.sortRank ?? b.position));
    return m;
  }, [items, stages]);

  function move(dealId: string, stageId: string) {
    const deal = items.find((d) => d.id === dealId);
    if (!deal || deal.stage_id === stageId) return;
    const target = byStage.get(stageId) ?? [];
    const position = target.length ? Math.max(...target.map((d) => d.position)) + 1 : 0;
    const before = items;
    setItems((prev) => prev.map((d) => (d.id === dealId ? { ...d, stage_id: stageId, position } : d)));
    startTransition(async () => {
      const res = await moveDealAction({ locale, id: dealId, stageId, position });
      if (res.error) {
        setItems(before);
        toast.error(t(res.error));
      } else {
        const st = stages.find((s) => s.id === stageId);
        toast.success(t("deals.movedTo", { stage: st ? stageLabel(t, st.name) : "" }));
        router.refresh();
      }
    });
  }

  return (
    <div className="-mx-4 overflow-x-auto px-4 pb-4 sm:mx-0 sm:px-0" role="region" aria-label={t("deals.board")}>
      <div className="flex min-w-max gap-3">
        {stages.map((stage) => {
          const list = byStage.get(stage.id) ?? [];
          const total = list.reduce((s, d) => s + Number(d.value), 0);
          return (
            <section
              key={stage.id}
              aria-label={stageLabel(t, stage.name)}
              data-stage-id={stage.id}
              onDragOver={(e) => {
                if (!canWrite || !dragId) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                setOverStage(stage.id);
              }}
              onDragLeave={() => setOverStage((s) => (s === stage.id ? null : s))}
              onDrop={(e) => {
                e.preventDefault();
                const id = e.dataTransfer.getData("text/deal-id") || dragId;
                setOverStage(null);
                setDragId(null);
                if (id) move(id, stage.id);
              }}
              className={cn(
                "flex shrink-0 flex-col rounded-2xl border border-line bg-elevated/50 transition-[colors,width] duration-200",
                collapsed.has(stage.id) ? "w-[76px]" : "w-[280px]",
                overStage === stage.id && "stage-drop-active border-accent bg-accent-soft/40",
              )}
            >
              <header className="border-b border-line px-3.5 py-3">
                <div className="flex items-center justify-between gap-2">
                  {collapsed.has(stage.id) ? (
                    <button type="button" onClick={() => setCollapsed((c) => { const n = new Set(c); n.delete(stage.id); return n; })} aria-expanded={false} aria-label={stageLabel(t, stage.name)} className="flex w-full flex-col items-center gap-1 text-center focus:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                      <ChevronDown className="h-4 w-4 text-subtle" />
                      <span className="line-clamp-2 text-[12px] font-semibold leading-tight">{stageLabel(t, stage.name)}</span>
                      <span className="rounded-full bg-surface px-2 py-0.5 text-[11px] font-bold tabular-nums">{list.length}</span>
                    </button>
                  ) : (
                    <>
                      <div className="min-w-0">
                        <h2 className="truncate text-[14px] font-semibold">{stageLabel(t, stage.name)}</h2>
                        <p className="text-[12px] text-subtle">
                          {t("deals.stageSummary", { count: list.length, value: formatCurrency(locale, total, currency) })}
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="rounded-full bg-surface px-2 py-0.5 text-[11px] text-muted">{stage.probability}%</span>
                        <button type="button" onClick={() => setCollapsed((c) => new Set(c).add(stage.id))} aria-expanded aria-label={t("deals.brain.collapse")} title={t("deals.brain.collapse")} className="grid h-6 w-6 place-items-center rounded-md text-subtle hover:bg-surface-hover hover:text-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                          <ChevronUp className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </>
                  )}
                </div>
                {!collapsed.has(stage.id) ? (
                  <div className="mt-2 space-y-1.5">
                    <div className="h-1 overflow-hidden rounded-full bg-surface-hover" aria-hidden>
                      <div className="bar-fill h-full rounded-full" style={{ "--w": `${stage.probability}%`, background: "var(--gradient-brand, var(--accent-solid))" } as CSSProperties} />
                    </div>
                    {(() => {
                      const m = stageMeta?.[stage.id];
                      const weighted = list.reduce((s, d) => s + (Number(d.value) * (d.brain?.winChance ?? stage.probability)) / 100, 0);
                      return (
                        <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-subtle">
                          {list.length ? <span title={t("deals.brain.weightedHint")}>{t("deals.brain.weighted")}: <bdi dir="ltr">{formatCurrency(locale, Math.round(weighted), currency)}</bdi></span> : null}
                          {m?.avgDays != null ? <span>{t("deals.brain.avgInStage", { days: m.avgDays })}</span> : null}
                          {m?.bottleneck ? (
                            <span className="inline-flex items-center gap-0.5 font-semibold text-warning" data-testid="stage-bottleneck">
                              <TriangleAlert className="h-3 w-3" />
                              {t(`deals.brain.funnel.bottleneck_${m.bottleneck}`)}
                            </span>
                          ) : null}
                        </p>
                      );
                    })()}
                  </div>
                ) : null}
              </header>
              <ol className={cn("min-h-[120px] flex-1 flex-col gap-2 p-2.5", collapsed.has(stage.id) ? "hidden" : "flex")}>
                {list.length === 0 ? <li className="grid flex-1 place-items-center py-6 text-[12px] text-subtle">{t("deals.emptyStage")}</li> : null}
                {list.map((d, idx) => (
                  <li
                    key={d.id}
                    data-level={d.brain?.level}
                    style={{ "--i": Math.min(idx, 12) } as CSSProperties}
                    draggable={canWrite}
                    onDragStart={(e) => {
                      e.dataTransfer.setData("text/deal-id", d.id);
                      e.dataTransfer.effectAllowed = "move";
                      setDragId(d.id);
                    }}
                    onDragEnd={() => {
                      setDragId(null);
                      setOverStage(null);
                    }}
                    data-deal-id={d.id}
                    className={cn("deal-card rounded-xl border border-line bg-surface shadow-sm", dragId === d.id && "opacity-50")}
                  >
                    <EditDealDialog
                      deal={d}
                      pickers={pickers}
                      canWrite={canWrite}
                      canDelete={canDelete}
                      trigger={
                        <button type="button" className="block w-full rounded-t-xl p-3 text-start hover:bg-surface-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                          <div className="flex items-start gap-1.5">
                            {canWrite ? <GripVertical className="mt-0.5 hidden h-4 w-4 shrink-0 text-subtle md:block" aria-hidden /> : null}
                            <span className="min-w-0 flex-1 text-[14px] font-medium leading-snug">{d.title}</span>
                            {d.brain ? <HealthRing score={d.brain.score} level={d.brain.level} size={32} label={`${t(`deals.brain.levels.${d.brain.level}`)} — ${reasonText(t, d.brain.reasons)}`} /> : null}
                          </div>
                          <div className="mt-1.5 text-[15px] font-semibold text-accent">
                            <bdi dir="ltr">{formatCurrency(locale, Number(d.value), d.currency)}</bdi>
                          </div>
                          {d.contact_name || d.company_name ? (
                            <div className="mt-1 truncate text-[12.5px] text-muted">{[d.contact_name, d.company_name].filter(Boolean).join(" · ")}</div>
                          ) : null}
                          <div className="mt-2 flex items-center gap-3 text-[11.5px] text-subtle">
                            {d.expected_close_date ? (
                              <span className="flex items-center gap-1">
                                <CalendarDays className="h-3.5 w-3.5" />
                                {formatDate(locale, d.expected_close_date)}
                              </span>
                            ) : null}
                            {d.owner_name ? (
                              <span className="flex min-w-0 items-center gap-1">
                                <User className="h-3.5 w-3.5 shrink-0" />
                                <span className="truncate">{d.owner_name}</span>
                              </span>
                            ) : null}
                          </div>
                          {d.overdue || (d.age_days ?? 0) > 14 ? (
                            <div className="mt-1.5 flex flex-wrap gap-1" data-testid="deal-alerts">
                              {d.overdue ? <span className="rounded-full bg-danger/10 px-2 py-0.5 text-[10.5px] font-semibold text-danger">{t("deals.insights.overdueBadge")}</span> : null}
                              {(d.age_days ?? 0) > 14 ? <span className="rounded-full bg-gold/10 px-2 py-0.5 text-[10.5px] font-semibold text-gold">{t("deals.insights.staleBadge", { days: d.age_days ?? 0 })}</span> : null}
                            </div>
                          ) : null}
                          {d.brain ? (
                            <div className="mt-2 space-y-1.5" data-testid="deal-brain">
                              <div className="flex items-center gap-2" title={t("deals.brain.winChanceHint")}>
                                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-hover" aria-hidden>
                                  <div className="bar-fill h-full rounded-full" style={{ "--w": `${d.brain.winChance}%`, background: LEVEL_TONE[d.brain.level].color } as CSSProperties} />
                                </div>
                                <span className="text-[11px] font-semibold tabular-nums text-muted">{t("deals.brain.winChance", { pct: d.brain.winChance })}</span>
                              </div>
                              {d.brain.action !== "keepGoing" ? (
                                <p className={cn("flex items-center gap-1 text-[11.5px] font-medium", d.brain.urgency === 3 ? "text-danger" : "text-accent")}>
                                  <Zap className="h-3 w-3 shrink-0" />
                                  <span className="truncate">{t(`deals.brain.actions.${d.brain.action}`)}</span>
                                </p>
                              ) : null}
                            </div>
                          ) : null}
                        </button>
                      }
                    />
                    {canWrite ? (
                      <div className="flex items-center gap-1 border-t border-line px-2.5 py-1.5">
                        <label className="sr-only" htmlFor={`move-${d.id}`}>
                          {t("deals.moveTo")}
                        </label>
                        <select
                          id={`move-${d.id}`}
                          value={d.stage_id}
                          onChange={(e) => move(d.id, e.target.value)}
                          className="h-8 min-w-0 flex-1 rounded-lg bg-transparent text-[12.5px] text-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          {stages.map((s) => (
                            <option key={s.id} value={s.id}>
                              {t("deals.moveTo")}: {stageLabel(t, s.name)}
                            </option>
                          ))}
                        </select>
                        <QuickStatus id={d.id} onDone={() => router.refresh()} />
                      </div>
                    ) : null}
                  </li>
                ))}
              </ol>
            </section>
          );
        })}
      </div>
    </div>
  );
}
