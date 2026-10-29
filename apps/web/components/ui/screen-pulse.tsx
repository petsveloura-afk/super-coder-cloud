import Link from "next/link";
import { ArrowUpRight, Lightbulb } from "lucide-react";
import type { TKey } from "@/lib/i18n/translate";
import type { Locale } from "@/lib/i18n/config";
import type { Pulse, Tone } from "@/lib/insights/screens-core";
import { formatCurrency, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

type T = (k: TKey, p?: Record<string, string>) => string;

const TONE: Record<Tone, string> = {
  accent: "bg-accent-soft text-accent",
  success: "bg-success-soft text-success",
  warning: "bg-warning-soft text-warning",
  danger: "bg-danger-soft text-danger",
  teal: "bg-teal-soft text-teal",
  muted: "bg-elevated text-muted",
};
const DOT: Record<Tone, string> = { accent: "bg-accent-solid", success: "bg-success", warning: "bg-warning", danger: "bg-danger", teal: "bg-teal", muted: "bg-line-strong" };

/**
 * Wave 53 — the same "smart pulse" on every screen: a row of live numbers and 1-3 actionable tips.
 * `screen` picks the i18n namespace (pulse.<screen>.stat.* / pulse.<screen>.tip.*). Server component.
 */
export function ScreenPulse({ screen, pulse, locale, t, currency = "ILS", suffix }: { screen: string; pulse: Pulse; locale: Locale; t: T; currency?: string; suffix?: Record<string, string> }) {
  if (!pulse.stats.length && !pulse.tips.length) return null;
  const val = (v: number, money?: boolean) => (money ? formatCurrency(locale, v, currency) : formatNumber(locale, v));
  return (
    <section aria-label={t("pulse.title")} data-testid={`pulse-${screen}`} className="pulse-in mb-4 space-y-3">
      {pulse.stats.length ? (
        <ul className={cn("stagger grid gap-2", pulse.stats.length >= 4 ? "grid-cols-2 lg:grid-cols-4" : pulse.stats.length === 3 ? "grid-cols-3" : "grid-cols-2")}>
          {pulse.stats.map((s) => {
            const inner = (
              <>
                <span className={cn("grid h-8 w-8 shrink-0 place-items-center rounded-lg text-[13px] font-bold", TONE[s.tone])} aria-hidden>
                  <span className={cn("h-2 w-2 rounded-full", DOT[s.tone])} />
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-[19px] font-bold leading-tight tabular-nums">
                    <bdi dir="ltr">{val(s.value, s.money)}{suffix?.[s.key] ?? ""}</bdi>
                  </span>
                  <span className="block truncate text-[12px] text-muted">{t(`pulse.${screen}.stat.${s.key}` as TKey)}</span>
                </span>
              </>
            );
            const cls = "lift flex h-full items-center gap-3 rounded-xl border border-line bg-surface p-3 shadow-sm";
            return (
              <li key={s.key}>
                {s.href ? (
                  <Link href={`/${locale}${s.href}`} className={cn(cls, "hover:border-accent")}>
                    {inner}
                  </Link>
                ) : (
                  <div className={cls}>{inner}</div>
                )}
              </li>
            );
          })}
        </ul>
      ) : null}
      {pulse.tips.length ? (
        <div className="rounded-2xl border border-line bg-gradient-to-br from-accent-soft/50 via-surface to-surface p-3 shadow-sm">
          <p className="mb-2 flex items-center gap-1.5 text-[12.5px] font-semibold">
            <Lightbulb className="h-4 w-4 text-gold" aria-hidden /> {t("pulse.tipsTitle")}
          </p>
          <ul className="stagger grid gap-2 md:grid-cols-3">
            {pulse.tips.map((tip) => {
              const text = t(`pulse.${screen}.tip.${tip.key}` as TKey, Object.fromEntries(Object.entries(tip.vars ?? {}).map(([k, v]) => [k, typeof v === "number" ? formatNumber(locale, v) : v])));
              const inner = (
                <>
                  <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", DOT[tip.tone])} aria-hidden />
                  <span className="min-w-0 flex-1 text-[13px] leading-snug">{text}</span>
                  {tip.href ? <ArrowUpRight className="h-4 w-4 shrink-0 text-subtle rtl:-scale-x-100" aria-hidden /> : null}
                </>
              );
              const cls = "flex h-full items-start gap-2.5 rounded-xl border border-line bg-surface p-3";
              return (
                <li key={tip.key}>
                  {tip.href ? (
                    <Link href={`/${locale}${tip.href}`} className={cn(cls, "lift hover:border-accent")}>
                      {inner}
                    </Link>
                  ) : (
                    <div className={cls}>{inner}</div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
