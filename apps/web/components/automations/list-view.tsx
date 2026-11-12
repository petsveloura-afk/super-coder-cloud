"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Search, ShieldAlert, Workflow } from "lucide-react";
import type { AutomationHealth } from "@scc/shared/automations";
import { matchesQuery } from "@scc/shared/automations";
import { useI18n } from "@/lib/i18n/client";
import { triggerLabel } from "@/lib/labels";
import { formatDateTime, formatNumber } from "@/lib/format";
import { Badge, Card, EmptyState, Input } from "@/components/ui/primitives";
import { AutomationToggle } from "@/components/automations/list-client";
import { DuplicateAutomationButton } from "@/components/automations/duplicate-button";
import { Sparkline } from "@/components/automations/visuals";
import { intelT } from "@/components/automations/intel-i18n";

export interface AutomationListItem {
  id: string;
  name: string;
  description: string | null;
  enabled: boolean;
  trigger_type: string;
  run_count: number;
  last_run_at: string | null;
  steps: number;
  health: AutomationHealth;
  /** success rate of executed runs, 0–100 (null = none yet) */
  rate: number | null;
  runs30: number;
  buckets: { day: string; ok: number; bad: number }[];
  /** logic-analysis summary (errors/warnings found by the analyzer) */
  errors: number;
  warnings: number;
  /** round 12: how many automations do exactly the same work (0 = unique) */
  duplicates?: number;
}

type Filter = "all" | "active" | "paused" | "attention" | "duplicates";
type Sort = "newest" | "name" | "runs" | "last" | "health";
const HEALTH_TONE = { healthy: "success", attention: "warning", failing: "danger", idle: "neutral", disabled: "neutral" } as const;

const needsAttention = (a: AutomationListItem) => a.health === "failing" || a.health === "attention" || a.errors > 0;

/** Searchable / filterable list of automations with health, trend and quick actions. */
export function AutomationListView({ items }: { items: AutomationListItem[] }) {
  const { t, locale } = useI18n();
  const it = useMemo(() => intelT(locale), [locale]);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<Sort>("newest");

  const counts = useMemo(
    () => ({ all: items.length, active: items.filter((a) => a.enabled).length, paused: items.filter((a) => !a.enabled).length, attention: items.filter(needsAttention).length, duplicates: items.filter((a) => (a.duplicates ?? 0) > 1).length }),
    [items],
  );
  const shown = useMemo(
    () =>
      items.filter((a) => {
        if (filter === "active" && !a.enabled) return false;
        if (filter === "paused" && a.enabled) return false;
        if (filter === "attention" && !needsAttention(a)) return false;
        if (filter === "duplicates" && !((a.duplicates ?? 0) > 1)) return false;
        return matchesQuery([a.name, a.description, triggerLabel(t, a.trigger_type)], q);
      })
        // round 12: sorting (the default keeps the server's order — newest first)
        .map((a, i) => ({ a, i }))
        .sort((x, y) =>
          sort === "name"
            ? x.a.name.localeCompare(y.a.name)
            : sort === "runs"
              ? y.a.run_count - x.a.run_count
              : sort === "last"
                ? Date.parse(y.a.last_run_at ?? "1970-01-01") - Date.parse(x.a.last_run_at ?? "1970-01-01")
                : sort === "health"
                  ? Number(needsAttention(y.a)) - Number(needsAttention(x.a)) || x.i - y.i
                  : x.i - y.i,
        )
        .map((x) => x.a),
    [items, filter, q, t, sort],
  );

  const chips: { key: Filter; label: string }[] = [
    { key: "all", label: it("o.fAll") },
    { key: "active", label: it("o.fActive") },
    { key: "paused", label: it("o.fPaused") },
    { key: "attention", label: it("o.fAttention") },
    ...(counts.duplicates ? [{ key: "duplicates" as Filter, label: t("automations.dup.filter") }] : []),
  ];

  return (
    <Card className="mb-4 overflow-hidden" data-testid="automation-list">
      <div className="flex flex-col gap-3 border-b border-line p-4 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" aria-hidden />
          <Input type="search" aria-label={it("o.search")} placeholder={it("o.search")} value={q} onChange={(e) => setQ(e.target.value)} className="ps-9" />
        </div>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label={it("o.healthLegend")}>
          {chips.map((c) => (
            <button
              key={c.key}
              type="button"
              aria-pressed={filter === c.key}
              onClick={() => setFilter(c.key)}
              className={`rounded-full border px-3 py-1 text-[12.5px] font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring ${filter === c.key ? "border-accent bg-accent-soft text-accent" : "border-line text-muted hover:bg-surface-hover"}`}
            >
              {c.label} <span className="tabular-nums opacity-70">{counts[c.key]}</span>
            </button>
          ))}
          <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label={t("automations.sort.label")} className="h-8 rounded-full border border-line bg-elevated px-3 text-[12.5px] text-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            {(["newest", "name", "runs", "last", "health"] as const).map((o) => (
              <option key={o} value={o}>
                {t(`automations.sort.${o}`)}
              </option>
            ))}
          </select>
        </div>
      </div>
      {counts.duplicates ? (
        <p className="flex items-center gap-2 border-b border-warning/30 bg-warning/5 px-5 py-2 text-[12.5px] text-warning" data-testid="automation-dup-note">
          <ShieldAlert className="h-4 w-4 shrink-0" aria-hidden /> {t("automations.dup.note", { n: counts.duplicates })}
        </p>
      ) : null}

      {shown.length === 0 ? (
        <EmptyState icon={<Workflow className="h-6 w-6" />} title={it("o.noMatches")} />
      ) : (
        <ul className="divide-y divide-line">
          {shown.map((a) => (
            <li key={a.id} className="feed-in flex flex-col gap-3 px-5 py-4 transition-colors hover:bg-surface-hover/50 lg:flex-row lg:items-center">
              <Link href={`/${locale}/automations/${a.id}`} className="min-w-0 flex-1">
                <span className="block truncate font-semibold hover:text-accent">{a.name}</span>
                <span className="mt-0.5 block text-[12.5px] text-muted">
                  {triggerLabel(t, a.trigger_type)} · {t("automations.runs", { count: formatNumber(locale, a.run_count) })}
                  {a.last_run_at ? ` · ${formatDateTime(locale, a.last_run_at)}` : ""}
                </span>
                <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  <Badge tone={HEALTH_TONE[a.health]}>{it(`h.${a.health}`)}</Badge>
                  {a.rate != null ? <Badge tone="neutral">{it("o.rate", { rate: a.rate })}</Badge> : null}
                  <Badge tone="neutral">{it("o.stepsCount", { count: a.steps })}</Badge>
                  {(a.duplicates ?? 0) > 1 ? (
                    <Badge tone="warning" title={t("automations.dup.hint")} data-testid="automation-dup">
                      {t("automations.dup.badge", { n: a.duplicates ?? 0 })}
                    </Badge>
                  ) : null}
                  {a.errors + a.warnings > 0 ? (
                    <Badge tone={a.errors > 0 ? "danger" : "warning"}>
                      <ShieldAlert className="h-3 w-3" aria-hidden /> {a.errors + a.warnings}
                    </Badge>
                  ) : null}
                </span>
              </Link>
              <div className="flex items-center gap-4 lg:gap-5">
                <div className="hidden flex-col items-end gap-0.5 sm:flex">
                  <Sparkline data={a.buckets} label={it("o.trend")} />
                  <span className="text-[11px] text-subtle">{it("o.runs30", { count: formatNumber(locale, a.runs30) })}</span>
                </div>
                <DuplicateAutomationButton id={a.id} compact />
                <AutomationToggle id={a.id} enabled={a.enabled} />
              </div>
            </li>
          ))}
        </ul>
      )}
      {items.length > 0 && shown.length !== items.length ? <p className="border-t border-line px-5 py-2 text-[12px] text-subtle">{it("o.showing", { shown: shown.length, total: items.length })}</p> : null}
    </Card>
  );
}
