import Link from "next/link";
import { AlarmClock, CalendarClock, CalendarDays, CalendarRange, CircleDashed, Flame, Target } from "lucide-react";
import type { TKey } from "@/lib/i18n/translate";
import type { Locale } from "@/lib/i18n/config";
import { FOCUS_BUCKETS, focusHeadline, type FocusBucket } from "@/lib/tasks/focus-core";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

type T = (k: TKey, p?: Record<string, string>) => string;

const ICON: Record<FocusBucket, typeof Flame> = { overdue: Flame, today: AlarmClock, tomorrow: CalendarClock, week: CalendarDays, later: CalendarRange, nodate: CircleDashed };
const TONE: Record<FocusBucket, string> = {
  overdue: "bg-danger-soft text-danger",
  today: "bg-warning-soft text-warning",
  tomorrow: "bg-accent-soft text-accent",
  week: "bg-teal-soft text-teal",
  later: "bg-success-soft text-success",
  nodate: "bg-elevated text-muted",
};

/** Wave 50 — "focus" band above the task list: what is late, what is for today, the week ahead and weekly progress. */
export function TaskFocus({ counts, progress, locale, t, mine }: { counts: Record<FocusBucket, number>; progress: number | null; locale: Locale; t: T; mine: boolean }) {
  const head = focusHeadline(counts);
  return (
    <section aria-label={t("tasks.focus.title")} data-testid="task-focus" className="mb-4 rounded-2xl border border-line bg-gradient-to-br from-accent-soft/50 via-surface to-surface p-4 shadow-sm">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-accent-solid text-accent-fg">
            <Target className="h-4 w-4" aria-hidden />
          </span>
          <div>
            <h2 className="text-[15px] font-semibold">{t(mine ? "tasks.focus.titleMine" : "tasks.focus.title")}</h2>
            <p className={cn("text-[13px]", head.key === "overdue" ? "font-medium text-danger" : "text-muted")}>{t(`tasks.focus.head.${head.key}`, { n: formatNumber(locale, head.n) })}</p>
          </div>
        </div>
        {progress !== null ? (
          <div className="min-w-[10rem]">
            <div className="flex items-center justify-between text-[12px] text-muted">
              <span>{t("tasks.focus.progress")}</span>
              <span className="font-semibold tabular-nums text-fg">{progress}%</span>
            </div>
            <div className="mt-1 h-2 overflow-hidden rounded-full bg-elevated" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress} aria-label={t("tasks.focus.progress")}>
              <div className="h-full rounded-full bg-success transition-all duration-700" style={{ width: `${progress}%` }} />
            </div>
          </div>
        ) : null}
      </div>
      <ul className="grid grid-cols-3 gap-2 sm:grid-cols-6">
        {FOCUS_BUCKETS.map((b) => {
          const Icon = ICON[b];
          const inner = (
            <>
              <span className={cn("grid h-8 w-8 place-items-center rounded-lg", TONE[b])}>
                <Icon className="h-4 w-4" aria-hidden />
              </span>
              <span className="text-[20px] font-bold tabular-nums leading-none">{formatNumber(locale, counts[b])}</span>
              <span className="text-[12px] text-muted">{t(`tasks.focus.bucket.${b}`)}</span>
            </>
          );
          const cls = "flex h-full flex-col items-start gap-1.5 rounded-xl border border-line bg-surface p-3 transition";
          return (
            <li key={b}>
              {b === "overdue" && counts.overdue > 0 ? (
                <Link href={`/${locale}/tasks?f=overdue`} className={cn(cls, "hover:border-danger hover:shadow-sm")}>
                  {inner}
                </Link>
              ) : (
                <div className={cls}>{inner}</div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
