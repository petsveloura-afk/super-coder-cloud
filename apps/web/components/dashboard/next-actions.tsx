import Link from "next/link";
import { ArrowUpRight, Bot, CalendarX, Clock3, Flame, Hand, Hourglass, Plug, Sparkles } from "lucide-react";
import type { NextAction, NextActionKey } from "@/lib/dashboard/next-actions-core";
import type { TKey } from "@/lib/i18n/translate";
import type { Locale } from "@/lib/i18n/config";
import { cn } from "@/lib/utils";

const ICON: Record<NextActionKey, typeof Hourglass> = {
  waiting: Hourglass, needsHuman: Hand, hotLeads: Flame, overdueTasks: Clock3, overdueDeals: CalendarX, staleDeals: Clock3, connectChannel: Plug, createAgent: Bot,
};

/** Wave 24 — "what to do now": the few things that make money or save a customer today. */
export function NextActionsCard({ items, locale, t }: { items: NextAction[]; locale: Locale; t: (k: TKey, p?: Record<string, string>) => string }) {
  return (
    <section aria-label={t("dashboard.next.title")} data-testid="next-actions" className="mb-4 overflow-hidden rounded-2xl border border-line bg-gradient-to-br from-accent-soft/60 via-surface to-surface p-4 shadow-sm">
      <div className="mb-2 flex items-center gap-2">
        <span className="grid h-7 w-7 place-items-center rounded-lg bg-accent-solid text-accent-fg"><Sparkles className="h-4 w-4" /></span>
        <h2 className="font-semibold">{t("dashboard.next.title")}</h2>
      </div>
      {items.length === 0 ? (
        <p className="text-[13px] text-muted" data-testid="next-actions-calm">✅ {t("dashboard.next.calm")}</p>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((a) => {
            const Icon = ICON[a.key];
            return (
              <li key={a.key}>
                <Link href={`/${locale}${a.href}`} data-testid={`next-${a.key}`} className="group flex items-center gap-3 rounded-xl border border-line bg-surface p-3 transition hover:-translate-y-0.5 hover:border-accent hover:shadow-md">
                  <span className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-lg", a.tone === "danger" ? "bg-danger/10 text-danger" : a.tone === "warning" ? "bg-gold/10 text-gold" : "bg-accent-soft text-accent")}>
                    <Icon className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1 text-[13px] font-medium leading-snug">{t(`dashboard.next.${a.key}`, { count: String(a.count) })}</span>
                  <ArrowUpRight className="h-4 w-4 shrink-0 text-subtle transition group-hover:text-accent rtl:-scale-x-100" />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
