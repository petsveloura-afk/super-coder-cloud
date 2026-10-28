"use client";

import type { CSSProperties } from "react";
import { TriangleAlert, ArrowDownRight, Brain, Flame, Gauge, Sparkles, Target, Timer, Trophy, Users, Zap } from "lucide-react";
import { Badge, Card, CardHeader } from "@/components/ui/primitives";
import { useI18n } from "@/lib/i18n/client";
import { stageLabel } from "@/lib/labels";
import { formatCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { HealthLevel, HealthReason, NextActionKey } from "@/lib/deals/brain";
import { EditDealDialog, type DealPickers } from "./deal-form";
import type { BoardDeal } from "./board";

/** What the board needs to know about every deal (computed on the server by lib/deals/brain). */
export interface BrainInfo {
  score: number;
  level: HealthLevel;
  winChance: number;
  action: NextActionKey;
  urgency: 1 | 2 | 3;
  reasons: HealthReason[];
  daysInStage: number | null;
}

export const LEVEL_TONE: Record<HealthLevel, { color: string; badge: "success" | "teal" | "warning" | "danger" }> = {
  hot: { color: "var(--success)", badge: "success" },
  healthy: { color: "var(--teal)", badge: "teal" },
  cooling: { color: "var(--warning)", badge: "warning" },
  risk: { color: "var(--danger)", badge: "danger" },
};

/* ----------------------------------------------------------- health ring --- */
export function HealthRing({ score, level, size = 36, label }: { score: number; level: HealthLevel; size?: number; label?: string }) {
  const stroke = 3.5;
  const r = (size - stroke) / 2;
  const len = 2 * Math.PI * r;
  const off = len * (1 - Math.max(0, Math.min(100, score)) / 100);
  return (
    <span className="relative inline-grid shrink-0 place-items-center" style={{ width: size, height: size }} title={label} role="img" aria-label={label}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--border)" strokeWidth={stroke} />
        <circle
          className="health-ring-arc"
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={LEVEL_TONE[level].color}
          strokeWidth={stroke}
          strokeLinecap="round"
          style={{ "--ring-len": len, "--ring-off": off } as CSSProperties}
        />
      </svg>
      <span className="absolute text-[10.5px] font-bold tabular-nums" style={{ color: LEVEL_TONE[level].color }}>
        {score}
      </span>
    </span>
  );
}

export function LevelBadge({ level }: { level: HealthLevel }) {
  const { t } = useI18n();
  return (
    <Badge tone={LEVEL_TONE[level].badge} className="px-2 py-0 text-[11px]">
      {level === "hot" ? <Flame className="h-3 w-3" /> : level === "risk" ? <TriangleAlert className="h-3 w-3" /> : null}
      {t(`deals.brain.levels.${level}`)}
    </Badge>
  );
}

/** "Why this score" — the reasons, translated, as a short sentence list. */
export function reasonText(t: (k: string, p?: Record<string, string | number>) => string, reasons: HealthReason[]): string {
  return reasons.map((r) => t(`deals.brain.reasons.${r}`)).join(" · ");
}

/* ------------------------------------------------------------ focus list --- */
export interface FocusRow {
  deal: BoardDeal;
  brain: BrainInfo;
  stageName: string;
}

export function FocusPanel({ rows, pickers, canWrite, canDelete, currency }: { rows: FocusRow[]; pickers: DealPickers; canWrite: boolean; canDelete: boolean; currency: string }) {
  const { t, locale } = useI18n();
  return (
    <Card data-testid="brain-focus">
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <Brain className="h-4 w-4 text-accent" />
            {t("deals.brain.focus.title")}
          </span>
        }
        description={t("deals.brain.focus.subtitle")}
      />
      {rows.length === 0 ? (
        <p className="flex items-center gap-2 px-5 py-8 text-[13.5px] text-muted">
          <Sparkles className="h-4 w-4 text-success" />
          {t("deals.brain.focus.allGood")}
        </p>
      ) : (
        <ol className="divide-y divide-line">
          {rows.map((r, i) => (
            <li key={r.deal.id} className="fade-slide" style={{ animationDelay: `${i * 60}ms` }}>
              <EditDealDialog
                deal={r.deal}
                pickers={pickers}
                canWrite={canWrite}
                canDelete={canDelete}
                trigger={
                  <button type="button" className="flex w-full items-center gap-3 px-5 py-3 text-start hover:bg-surface-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    <HealthRing score={r.brain.score} level={r.brain.level} size={40} label={t("deals.brain.healthLabel", { score: r.brain.score })} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="truncate text-[14px] font-semibold">{r.deal.title}</span>
                        <span className="hidden text-[12px] text-subtle sm:inline">{stageLabel(t, r.stageName)}</span>
                      </span>
                      <span className="mt-0.5 flex items-center gap-1.5 text-[12.5px] text-accent">
                        <Zap className={cn("h-3.5 w-3.5", r.brain.urgency === 3 && "text-danger")} />
                        {t(`deals.brain.actions.${r.brain.action}`)}
                      </span>
                      <span className="mt-0.5 block truncate text-[11.5px] text-subtle">{reasonText(t, r.brain.reasons)}</span>
                    </span>
                    <span className="shrink-0 text-end">
                      <span className="block text-[14px] font-bold tabular-nums">
                        <bdi dir="ltr">{formatCurrency(locale, r.deal.value, r.deal.currency || currency)}</bdi>
                      </span>
                      <span className="text-[11.5px] text-muted">{t("deals.brain.winChance", { pct: r.brain.winChance })}</span>
                    </span>
                  </button>
                }
              />
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------- velocity --- */
export function VelocityStrip({
  perMonth,
  avgCycleDays,
  winRate,
  openHealth,
  currency,
}: {
  perMonth: number | null;
  avgCycleDays: number | null;
  winRate: number | null;
  openHealth: Record<HealthLevel, number>;
  currency: string;
}) {
  const { t, locale } = useI18n();
  const total = Math.max(1, openHealth.hot + openHealth.healthy + openHealth.cooling + openHealth.risk);
  const items = [
    { icon: Gauge, k: "velocity", v: perMonth === null ? "—" : formatCurrency(locale, perMonth, currency), sub: t("deals.brain.velocitySub") },
    { icon: Timer, k: "cycle", v: avgCycleDays === null ? "—" : t("deals.brain.days", { count: Math.round(avgCycleDays) }), sub: t("deals.brain.cycleSub") },
    { icon: Trophy, k: "winRate", v: winRate === null ? "—" : `${winRate}%`, sub: t("deals.brain.winRateSub") },
  ];
  return (
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4" data-testid="brain-velocity">
      {items.map((x) => (
        <Card key={x.k} className="p-3.5">
          <p className="flex items-center gap-1.5 text-[11.5px] font-medium text-muted">
            <x.icon className="h-3.5 w-3.5 text-accent" />
            {t(`deals.brain.${x.k}`)}
          </p>
          <p className="mt-1 text-xl font-extrabold tabular-nums" dir="ltr">
            {x.v}
          </p>
          <p className="text-[11px] text-subtle">{x.sub}</p>
        </Card>
      ))}
      <Card className="p-3.5">
        <p className="flex items-center gap-1.5 text-[11.5px] font-medium text-muted">
          <Target className="h-3.5 w-3.5 text-accent" />
          {t("deals.brain.healthSpread")}
        </p>
        <div className="mt-2.5 flex h-2.5 overflow-hidden rounded-full bg-surface-hover" role="img" aria-label={t("deals.brain.healthSpread")}>
          {(["hot", "healthy", "cooling", "risk"] as const).map((lv, i) => (
            <span key={lv} className="bar-fill block h-full" style={{ "--w": `${(openHealth[lv] / total) * 100}%`, "--i": i, background: LEVEL_TONE[lv].color } as CSSProperties} />
          ))}
        </div>
        <p className="mt-1.5 flex flex-wrap gap-x-3 text-[11px] text-subtle">
          {(["hot", "healthy", "cooling", "risk"] as const).map((lv) => (
            <span key={lv} className="flex items-center gap-1">
              <i className="inline-block h-2 w-2 rounded-full" style={{ background: LEVEL_TONE[lv].color }} />
              {openHealth[lv]}
            </span>
          ))}
        </p>
      </Card>
    </div>
  );
}

/* --------------------------------------------------------------- funnel --- */
export interface FunnelRow {
  stageId: string;
  name: string;
  probability: number;
  entered: number;
  advanced: number;
  conversion: number | null;
  avgDays: number | null;
  current: number;
  value: number;
  bottleneck?: "slow" | "leaky";
}

export function FunnelPanel({ rows, currency }: { rows: FunnelRow[]; currency: string }) {
  const { t, locale } = useI18n();
  const max = Math.max(1, ...rows.map((r) => r.entered));
  const noData = rows.every((r) => r.entered === 0);
  return (
    <Card data-testid="brain-funnel">
      <CardHeader title={t("deals.brain.funnel.title")} description={t("deals.brain.funnel.subtitle")} />
      {noData ? (
        <p className="px-5 py-8 text-[13.5px] text-muted">{t("deals.brain.funnel.noData")}</p>
      ) : (
        <ol className="space-y-1 p-4">
          {rows.map((r, i) => (
            <li key={r.stageId}>
              <div className="flex items-center gap-3">
                <div className="w-28 shrink-0 truncate text-[13px] font-medium sm:w-36">{stageLabel(t, r.name)}</div>
                <div className="relative h-7 flex-1 overflow-hidden rounded-lg bg-surface-hover">
                  <div className="bar-fill absolute inset-y-0 start-0 rounded-lg" style={{ "--w": `${Math.max(4, (r.entered / max) * 100)}%`, "--i": i, background: "var(--gradient-brand, var(--accent-solid))" } as CSSProperties} />
                </div>
                <span className="w-8 shrink-0 text-end text-[13px] font-bold tabular-nums" dir="ltr">{r.entered}</span>
                <div className="w-20 shrink-0 text-end text-[12px] text-muted sm:w-28">
                  {r.avgDays === null ? "—" : t("deals.brain.funnel.avgDays", { days: r.avgDays })}
                </div>
              </div>
              {r.bottleneck ? (
                <p className="ms-[7.5rem] mt-0.5 flex items-center gap-1 text-[11.5px] font-semibold text-warning sm:ms-[10rem]">
                  <TriangleAlert className="h-3 w-3" />
                  {t(`deals.brain.funnel.bottleneck_${r.bottleneck}`)}
                </p>
              ) : null}
              {i < rows.length - 1 ? (
                <div className="ms-3 flex h-6 items-center gap-1.5 text-[11.5px] text-subtle">
                  <ArrowDownRight className="h-3.5 w-3.5 rtl:-scale-x-100" />
                  <span className={cn("font-semibold tabular-nums", r.conversion !== null && r.conversion < 50 ? "text-danger" : "text-success")} dir="ltr">
                    {r.conversion === null ? "—" : `${r.conversion}%`}
                  </span>
                  <span>{t("deals.brain.funnel.moved")}</span>
                </div>
              ) : null}
            </li>
          ))}
        </ol>
      )}
      <div className="flex flex-wrap gap-x-5 gap-y-1 border-t border-line px-5 py-3 text-[12px] text-muted">
        {rows.map((r) => (
          <span key={r.stageId}>
            {stageLabel(t, r.name)}: <b className="tabular-nums">{r.current}</b> · <bdi dir="ltr">{formatCurrency(locale, r.value, currency)}</bdi>
          </span>
        ))}
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------- forecast --- */
export interface ForecastView {
  commit: number;
  expected: number;
  bestCase: number;
  pipelineTotal: number;
  months: { key: string; weighted: number; total: number; count: number }[];
  undated: { weighted: number; total: number; count: number };
}

export function ForecastPanel({ data, currency }: { data: ForecastView; currency: string }) {
  const { t, locale, intl } = useI18n();
  const peak = Math.max(1, ...data.months.map((m) => m.total));
  const monthName = (key: string) => new Intl.DateTimeFormat(intl, { month: "short" }).format(new Date(`${key}-01T12:00:00`));
  const tiles = [
    { k: "commit", v: data.commit, tone: "var(--success)" },
    { k: "expected", v: data.expected, tone: "var(--accent)" },
    { k: "bestCase", v: data.bestCase, tone: "var(--gold)" },
  ];
  return (
    <Card data-testid="brain-forecast">
      <CardHeader title={t("deals.brain.forecast.title")} description={t("deals.brain.forecast.subtitle")} />
      <div className="grid gap-2 p-4 sm:grid-cols-3">
        {tiles.map((x, i) => (
          <div key={x.k} className="fade-slide rounded-xl border border-line p-3" style={{ animationDelay: `${i * 70}ms`, borderInlineStartColor: x.tone, borderInlineStartWidth: 3 }}>
            <p className="text-[11.5px] font-medium text-muted">{t(`deals.brain.forecast.${x.k}`)}</p>
            <p className="mt-0.5 text-lg font-extrabold tabular-nums" dir="ltr">
              {formatCurrency(locale, x.v, currency)}
            </p>
            <p className="text-[11px] text-subtle">{t(`deals.brain.forecast.${x.k}Sub`)}</p>
          </div>
        ))}
      </div>
      <div className="px-4 pb-4">
        <div className="flex h-36 items-end gap-2" role="img" aria-label={t("deals.brain.forecast.outlook")}>
          {data.months.map((m, i) => (
            <div key={m.key} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1">
              <span className="text-[10.5px] font-semibold tabular-nums text-muted" dir="ltr">
                {m.total ? new Intl.NumberFormat(intl, { notation: "compact", maximumFractionDigits: 1 }).format(m.weighted) : ""}
              </span>
              <div className="relative flex w-full flex-1 items-end overflow-hidden rounded-t-lg bg-surface-hover/60">
                <div className="col-rise absolute inset-x-0 bottom-0 rounded-t-lg bg-accent-soft" style={{ "--h": `${(m.total / peak) * 100}%`, "--i": i } as CSSProperties} />
                <div className="col-rise absolute inset-x-0 bottom-0 rounded-t-lg" style={{ "--h": `${(m.weighted / peak) * 100}%`, "--i": i, background: "var(--gradient-brand, var(--accent-solid))" } as CSSProperties} />
              </div>
              <span className="text-[11px] text-subtle">{monthName(m.key)}</span>
            </div>
          ))}
        </div>
        <p className="mt-2 flex flex-wrap gap-x-4 text-[11.5px] text-subtle">
          <span className="flex items-center gap-1">
            <i className="inline-block h-2 w-2 rounded-full bg-accent" /> {t("deals.brain.forecast.legendWeighted")}
          </span>
          <span className="flex items-center gap-1">
            <i className="inline-block h-2 w-2 rounded-full bg-accent-soft ring-1 ring-accent/40" /> {t("deals.brain.forecast.legendTotal")}
          </span>
          {data.undated.count ? (
            <span className="text-warning">{t("deals.brain.forecast.undated", { count: data.undated.count, value: formatCurrency(locale, data.undated.total, currency) })}</span>
          ) : null}
        </p>
      </div>
    </Card>
  );
}

/* --------------------------------------------------------------- owners --- */
export interface OwnerView {
  ownerId: string | null;
  name: string | null;
  open: number;
  value: number;
  weighted: number;
  atRisk: number;
  won: number;
  lost: number;
  winRate: number | null;
}

export function OwnerPanel({ rows, currency }: { rows: OwnerView[]; currency: string }) {
  const { t, locale } = useI18n();
  const max = Math.max(1, ...rows.map((r) => r.weighted));
  return (
    <Card data-testid="brain-owners">
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <Users className="h-4 w-4 text-accent" />
            {t("deals.brain.owners.title")}
          </span>
        }
        description={t("deals.brain.owners.subtitle")}
      />
      {rows.length === 0 ? (
        <p className="px-5 py-8 text-[13.5px] text-muted">{t("deals.brain.owners.empty")}</p>
      ) : (
        <ul className="divide-y divide-line">
          {rows.map((r, i) => (
            <li key={r.ownerId ?? "none"} className="px-5 py-3">
              <div className="flex items-center justify-between gap-3">
                <span className="min-w-0 truncate text-[13.5px] font-semibold">{r.name ?? t("deals.brain.owners.unassigned")}</span>
                <span className="shrink-0 text-[13px] font-bold tabular-nums" dir="ltr">
                  {formatCurrency(locale, r.weighted, currency)}
                </span>
              </div>
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-hover">
                <div className="bar-fill h-full rounded-full" style={{ "--w": `${(r.weighted / max) * 100}%`, "--i": i, background: "var(--gradient-brand, var(--accent-solid))" } as CSSProperties} />
              </div>
              <p className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11.5px] text-subtle">
                <span>{t("deals.brain.owners.open", { count: r.open })}</span>
                {r.atRisk ? <span className="font-semibold text-warning">{t("deals.brain.owners.atRisk", { count: r.atRisk })}</span> : null}
                <span>{r.winRate === null ? t("deals.brain.owners.noClosed") : t("deals.brain.owners.winRate", { pct: r.winRate, won: r.won, lost: r.lost })}</span>
              </p>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
