import Link from "next/link";
import { ArrowDownRight, ArrowUpRight, Bot, CalendarDays, Globe, Inbox, Kanban, ListPlus, Megaphone, Minus, Share2, Sparkles, UserPlus } from "lucide-react";
import type { TKey } from "@/lib/i18n/translate";
import type { Locale } from "@/lib/i18n/config";
import { businessHealth, dayPart, smartInsights, weekTrend, type HealthKpis } from "@/lib/dashboard/health-core";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

type T = (k: TKey, p?: Record<string, string>) => string;

export interface QuickPerms {
  contacts: boolean;
  deals: boolean;
  inbox: boolean;
  tasks: boolean;
  social: boolean;
  campaigns: boolean;
  ai: boolean;
  websites: boolean;
}

const LEVEL_TONE: Record<string, string> = {
  excellent: "text-success",
  good: "text-success",
  fair: "text-gold",
  attention: "text-danger",
  start: "text-accent",
};

const RING: Record<string, string> = {
  excellent: "stroke-success",
  good: "stroke-success",
  fair: "stroke-gold",
  attention: "stroke-danger",
  start: "stroke-accent",
};

/**
 * Wave 48 — the overview "command center": greeting + business health score, weekly trend,
 * one-tap quick actions and smart insights. Server component; every number comes from the page's KPIs.
 */
export function CommandCenter({ kpis, daily, locale, t, firstName, timeZone, perms }: { kpis: HealthKpis; daily: { day: string; count: number }[]; locale: Locale; t: T; firstName: string; timeZone: string; perms: QuickPerms }) {
  const health = businessHealth(kpis);
  const trend = weekTrend(daily);
  const insights = smartInsights(kpis, trend, 4);
  const part = dayPart(new Date(), timeZone);
  const dateText = new Date().toLocaleDateString(locale === "en" ? "en-GB" : locale === "ar" ? "ar" : "he-IL", { weekday: "long", day: "numeric", month: "long", timeZone });
  const R = 42;
  const C = 2 * Math.PI * R;
  const offset = C * (1 - health.score / 100);

  const actions = [
    perms.contacts ? { href: "/crm?new=1", label: t("dashboard.pro.qa.contact"), icon: UserPlus, tone: "bg-accent-soft text-accent" } : null,
    perms.deals ? { href: "/pipelines", label: t("dashboard.pro.qa.deal"), icon: Kanban, tone: "bg-teal-soft text-teal" } : null,
    perms.inbox ? { href: "/inbox", label: t("dashboard.pro.qa.inbox"), icon: Inbox, tone: "bg-success-soft text-success" } : null,
    perms.tasks ? { href: "/tasks", label: t("dashboard.pro.qa.task"), icon: ListPlus, tone: "bg-warning-soft text-warning" } : null,
    perms.social ? { href: "/social", label: t("dashboard.pro.qa.post"), icon: Share2, tone: "bg-accent-soft text-accent" } : null,
    perms.campaigns ? { href: "/campaigns", label: t("dashboard.pro.qa.campaign"), icon: Megaphone, tone: "bg-gold-soft text-gold" } : null,
    perms.ai ? { href: "/ai-agents", label: t("dashboard.pro.qa.agent"), icon: Bot, tone: "bg-teal-soft text-teal" } : null,
    perms.websites ? { href: "/websites", label: t("dashboard.pro.qa.site"), icon: Globe, tone: "bg-success-soft text-success" } : null,
  ].filter(Boolean) as { href: string; label: string; icon: typeof UserPlus; tone: string }[];

  const TrendIcon = trend.changePct === null || trend.changePct > 0 ? ArrowUpRight : trend.changePct < 0 ? ArrowDownRight : Minus;

  return (
    <section aria-label={t("dashboard.pro.title")} data-testid="command-center" className="mb-4 space-y-4">
      <div className="grid gap-4 lg:grid-cols-3">
        {/* greeting + health */}
        <div className="relative overflow-hidden rounded-2xl border border-line bg-gradient-to-br from-accent-soft/70 via-surface to-surface p-5 shadow-sm lg:col-span-2">
          <div className="pointer-events-none absolute -end-16 -top-16 h-48 w-48 rounded-full bg-accent/10 blur-3xl" aria-hidden />
          <div className="flex flex-wrap items-center gap-5">
            <div className="relative h-28 w-28 shrink-0" role="img" aria-label={`${t("dashboard.pro.health")}: ${health.score}/100`}>
              <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90">
                <circle cx="50" cy="50" r={R} className="fill-none stroke-line" strokeWidth="9" />
                <circle cx="50" cy="50" r={R} className={cn("fill-none transition-all duration-700", RING[health.level])} strokeWidth="9" strokeLinecap="round" strokeDasharray={C} strokeDashoffset={offset} />
              </svg>
              <div className="absolute inset-0 grid place-items-center text-center">
                <div>
                  <div className="text-[26px] font-bold tabular-nums leading-none">{health.level === "start" ? "—" : health.score}</div>
                  <div className="mt-1 text-[10.5px] text-muted">{t("dashboard.pro.health")}</div>
                </div>
              </div>
            </div>
            <div className="min-w-[12rem] flex-1">
              <p className="flex items-center gap-1.5 text-[12.5px] text-muted">
                <CalendarDays className="h-3.5 w-3.5" aria-hidden /> {dateText}
              </p>
              <h2 className="mt-1 text-[20px] font-bold tracking-tight sm:text-[22px]">{t(`dashboard.pro.greet.${part}`, { name: firstName })}</h2>
              <p className={cn("mt-1 text-[13.5px] font-medium", LEVEL_TONE[health.level])}>{t(`dashboard.pro.level.${health.level}`)}</p>
              <ul className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
                {health.parts.map((p) => (
                  <li key={p.key} className="min-w-0">
                    <div className="flex items-center justify-between text-[11.5px] text-muted">
                      <span className="truncate">{t(`dashboard.pro.part.${p.key}`)}</span>
                      <span className="tabular-nums">{p.score}/{p.max}</span>
                    </div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-elevated">
                      <div className="h-full rounded-full bg-accent-solid transition-all duration-700" style={{ width: `${Math.round((p.score / p.max) * 100)}%` }} />
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>

        {/* weekly trend */}
        <div className="flex flex-col justify-between rounded-2xl border border-line bg-surface p-5 shadow-sm">
          <div>
            <p className="text-[12.5px] font-medium text-muted">{t("dashboard.pro.weekTitle")}</p>
            <div className="mt-2 flex items-end gap-2">
              <span className="text-[30px] font-bold tabular-nums leading-none">{formatNumber(locale, trend.thisWeek)}</span>
              <span className="pb-1 text-[12.5px] text-muted">{t("dashboard.pro.weekUnit")}</span>
            </div>
          </div>
          <div className={cn("mt-4 inline-flex w-fit items-center gap-1.5 rounded-full px-2.5 py-1 text-[12.5px] font-medium", trend.changePct === null || trend.changePct > 0 ? "bg-success-soft text-success" : trend.changePct < 0 ? "bg-danger/10 text-danger" : "bg-elevated text-muted")}>
            <TrendIcon className="h-3.5 w-3.5 rtl:-scale-x-100" aria-hidden />
            {trend.changePct === null ? t("dashboard.pro.weekNew") : t("dashboard.pro.weekChange", { pct: String(Math.abs(trend.changePct)), prev: formatNumber(locale, trend.lastWeek) })}
          </div>
        </div>
      </div>

      {/* quick actions */}
      {actions.length ? (
        <div className="rounded-2xl border border-line bg-surface p-4 shadow-sm">
          <p className="mb-3 flex items-center gap-1.5 text-[13px] font-semibold">
            <Sparkles className="h-4 w-4 text-accent" aria-hidden /> {t("dashboard.pro.qaTitle")}
          </p>
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
            {actions.map((a) => (
              <li key={a.href}>
                <Link href={`/${locale}${a.href}`} className="group flex flex-col items-center gap-2 rounded-xl border border-transparent p-3 text-center transition hover:-translate-y-0.5 hover:border-line hover:bg-surface-hover hover:shadow-sm">
                  <span className={cn("grid h-11 w-11 place-items-center rounded-xl transition group-hover:scale-105", a.tone)}>
                    <a.icon className="h-5 w-5" aria-hidden />
                  </span>
                  <span className="text-[12.5px] font-medium leading-tight">{a.label}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* smart insights */}
      {insights.length ? (
        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4" aria-label={t("dashboard.pro.insightsTitle")} data-testid="smart-insights">
          {insights.map((ins) => (
            <li key={ins.kind}>
              <Link href={`/${locale}/${ins.href}`} className="group flex h-full items-start gap-3 rounded-xl border border-line bg-surface p-3 transition hover:border-accent hover:shadow-md">
                <span className={cn("mt-1 h-2.5 w-2.5 shrink-0 rounded-full", ins.tone === "danger" ? "bg-danger" : ins.tone === "warning" ? "bg-gold" : ins.tone === "success" ? "bg-success" : "bg-accent-solid")} aria-hidden />
                <span className="min-w-0 flex-1 text-[13px] leading-snug">{t(`dashboard.pro.insight.${ins.kind}`, Object.fromEntries(Object.entries(ins.vars).map(([k, v]) => [k, String(v)])))}</span>
                <ArrowUpRight className="h-4 w-4 shrink-0 text-subtle transition group-hover:text-accent rtl:-scale-x-100" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
