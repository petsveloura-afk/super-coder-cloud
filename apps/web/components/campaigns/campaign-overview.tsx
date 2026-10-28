import type { CSSProperties } from "react";
import { CircleAlert, CircleCheck, Lightbulb } from "lucide-react";
import { Card, CardHeader } from "@/components/ui/primitives";
import { channelPerformance, monthlyTrend, portfolioInsights, type CheckLevel, type InsightRow, type PerfCampaign } from "@/lib/campaigns/brain";
import { formatNumber, formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Locale } from "@/lib/i18n/config";

type T = (k: string, p?: Record<string, string | number>) => string;
const ICON = { ok: CircleCheck, warn: CircleAlert, bad: CircleAlert } as const;
const COLOR: Record<CheckLevel, string> = { ok: "text-success", warn: "text-warning", bad: "text-danger" };

export function InsightList({ items, t, className }: { items: InsightRow[]; t: T; className?: string }) {
  if (!items.length) return null;
  return (
    <ul className={cn("space-y-1.5", className)} data-testid="campaign-insights">
      {items.map((x, i) => {
        const Icon = ICON[x.level];
        const params = { ...(x.params ?? {}) } as Record<string, string | number>;
        if (typeof params.channel === "string") params.channel = t(`campaigns.channels.${params.channel}`);
        return (
          <li key={`${x.key}-${i}`} className="flex items-start gap-2 text-[13px]">
            <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", COLOR[x.level])} aria-hidden />
            <span>{t(`campaigns.insights.${x.key}`, params)}</span>
          </li>
        );
      })}
    </ul>
  );
}

/** Wave 39 — portfolio view on the campaigns list: channel delivery bars, 6-month trend, smart insights. Server component, pure data. */
export function CampaignOverview({ rows, t, locale }: { rows: PerfCampaign[]; t: T; locale: Locale }) {
  const channels = channelPerformance(rows);
  const trend = monthlyTrend(rows, 6);
  const max = Math.max(1, ...trend.map((x) => x.recipients));
  const insights = portfolioInsights(rows);
  if (!channels.length && !insights.length) return null;
  const monthFmt = new Intl.DateTimeFormat(locale, { month: "short" });
  return (
    <div className="mb-4 grid gap-3 lg:grid-cols-3" data-testid="campaign-overview">
      <Card>
        <CardHeader title={t("campaigns.overview.byChannel")} />
        <ul className="space-y-3 px-5 pb-5">
          {channels.length ? (
            channels.map((c, i) => (
              <li key={c.channel}>
                <div className="mb-1 flex items-center justify-between text-[12.5px]">
                  <span className="font-medium">{t(`campaigns.channels.${c.channel}`)}</span>
                  <span className="text-muted">
                    {formatNumber(locale, c.sent)} · {formatPercent(locale, c.rate)}
                  </span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-surface-hover">
                  <span className="bar-fill block h-full rounded-full bg-accent-solid" style={{ "--w": `${Math.round(c.rate * 100)}%`, "--i": i } as CSSProperties} />
                </div>
              </li>
            ))
          ) : (
            <li className="text-[13px] text-subtle">{t("campaigns.overview.noData")}</li>
          )}
        </ul>
      </Card>
      <Card>
        <CardHeader title={t("campaigns.overview.trend")} description={t("campaigns.overview.trendHint")} />
        <div className="flex h-32 items-end gap-2 px-5 pb-5" role="img" aria-label={t("campaigns.overview.trend")}>
          {trend.map((m, i) => {
            const [y, mo] = m.key.split("-").map(Number);
            return (
              <div key={m.key} className="flex flex-1 flex-col items-center gap-1.5" title={`${formatNumber(locale, m.sent)} / ${formatNumber(locale, m.recipients)}`}>
                <div className="flex h-20 w-full items-end overflow-hidden rounded-md bg-surface-hover">
                  <span className="col-rise block w-full rounded-md bg-accent-solid" style={{ "--h": `${Math.round((m.sent / max) * 100)}%`, "--i": i } as CSSProperties} />
                </div>
                <span className="text-[10.5px] text-subtle">{monthFmt.format(new Date(y ?? 2026, (mo ?? 1) - 1, 1))}</span>
              </div>
            );
          })}
        </div>
      </Card>
      <Card>
        <CardHeader
          title={
            <span className="inline-flex items-center gap-2">
              <Lightbulb className="h-4 w-4 text-accent" /> {t("campaigns.overview.insights")}
            </span>
          }
        />
        <div className="px-5 pb-5">{insights.length ? <InsightList items={insights} t={t} /> : <p className="text-[13px] text-subtle">{t("campaigns.overview.allGood")}</p>}</div>
      </Card>
    </div>
  );
}
