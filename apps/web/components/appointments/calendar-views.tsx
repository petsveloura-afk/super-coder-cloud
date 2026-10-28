import Link from "next/link";
import { STATUS_COLOR, layoutDay } from "@/lib/appointments/insights";
import { cn } from "@/lib/utils";

export interface CalEvent {
  id: string;
  title: string;
  dayKey: string;
  /** minutes since local midnight */
  start: number;
  end: number;
  status: string;
  timeLabel: string;
  who?: string | null;
  href?: string | null;
  join?: boolean;
}

const HOUR_PX = 56;

function EventBlock({ ev, col, cols, top, height }: { ev: CalEvent; col: number; cols: number; top: number; height: number }) {
  const color = STATUS_COLOR[ev.status] ?? "var(--accent)";
  const faded = ev.status === "canceled" || ev.status === "completed";
  const body = (
    <>
      <span className="block truncate text-[11.5px] font-semibold leading-tight">{ev.title}</span>
      {height > 34 ? (
        <span className="block truncate text-[10.5px] leading-tight opacity-80" dir="ltr">
          {ev.timeLabel}
        </span>
      ) : null}
      {height > 52 && ev.who ? <span className="block truncate text-[10.5px] leading-tight opacity-80">{ev.who}</span> : null}
    </>
  );
  const style = {
    top,
    height,
    insetInlineStart: `calc(${(col / cols) * 100}% + 2px)`,
    width: `calc(${100 / cols}% - 4px)`,
    borderInlineStartColor: color,
    background: `color-mix(in srgb, ${color} 16%, var(--bg-elevated))`,
  } as const;
  const cls = cn("cal-event absolute overflow-hidden rounded-lg border border-line border-s-[3px] px-1.5 py-1 text-fg", faded && "opacity-60", ev.status === "canceled" && "line-through decoration-danger/60");
  return ev.href ? (
    <Link href={ev.href} className={cn(cls, "hover:z-10 hover:shadow-lg")} style={style} title={`${ev.title} · ${ev.timeLabel}`}>
      {body}
    </Link>
  ) : (
    <div className={cls} style={style} title={`${ev.title} · ${ev.timeLabel}`}>
      {body}
    </div>
  );
}

/** Time grid for 1 (day) or 7 (week) local days. Server component — columns follow the page direction. */
export function TimeGrid({
  days,
  events,
  todayKey,
  nowMinutes,
  dayLabel,
  dayHref,
}: {
  days: string[];
  events: CalEvent[];
  todayKey: string;
  nowMinutes: number;
  dayLabel: (key: string) => { weekday: string; date: string };
  dayHref?: (key: string) => string;
}) {
  const mine = events.filter((e) => days.includes(e.dayKey));
  const minStart = mine.length ? Math.min(...mine.map((e) => e.start)) : 8 * 60;
  const maxEnd = mine.length ? Math.max(...mine.map((e) => e.end)) : 18 * 60;
  const fromH = Math.max(0, Math.min(8, Math.floor(minStart / 60) - 1));
  const toH = Math.min(24, Math.max(19, Math.ceil(maxEnd / 60) + 1));
  const hours = Array.from({ length: toH - fromH }, (_, i) => fromH + i);
  const gridH = hours.length * HOUR_PX;
  const cols = `52px repeat(${days.length}, minmax(0, 1fr))`;

  return (
    <div className="overflow-x-auto">
      <div className={cn(days.length > 1 ? "min-w-[760px]" : "min-w-[320px]")}>
        <div className="sticky top-0 z-20 grid border-b border-line bg-surface" style={{ gridTemplateColumns: cols }}>
          <div />
          {days.map((k) => {
            const l = dayLabel(k);
            const today = k === todayKey;
            const inner = (
              <>
                <div className="text-[11.5px] text-muted">{l.weekday}</div>
                <div className={cn("mx-auto mt-0.5 grid h-8 min-w-8 place-items-center rounded-full px-1 text-[15px] font-bold tabular-nums", today && "bg-accent-solid text-accent-fg shadow-[0_6px_16px_-6px_var(--brand)]")}>{l.date}</div>
              </>
            );
            return dayHref ? (
              <Link key={k} href={dayHref(k)} className="border-s border-line py-2 text-center hover:bg-surface-hover">
                {inner}
              </Link>
            ) : (
              <div key={k} className="border-s border-line py-2 text-center">
                {inner}
              </div>
            );
          })}
        </div>
        <div className="relative grid" style={{ gridTemplateColumns: cols, height: gridH }}>
          <div className="relative" aria-hidden>
            {hours.map((h, i) => (
              <div key={h} className="absolute inset-x-0 pe-2 text-end text-[10.5px] text-subtle tabular-nums" style={{ top: i * HOUR_PX - 6 }}>
                <bdi dir="ltr">{i === 0 ? "" : `${String(h).padStart(2, "0")}:00`}</bdi>
              </div>
            ))}
          </div>
          {days.map((k) => {
            const dayEvents = layoutDay(
              mine
                .filter((e) => e.dayKey === k)
                .map((e) => ({ ...e, end: Math.max(e.end, e.start + 20) })),
            );
            const today = k === todayKey;
            return (
              <div key={k} className={cn("relative border-s border-line", today && "bg-accent-soft/40")}>
                {hours.map((h, i) => (
                  <div key={h} aria-hidden className="absolute inset-x-0 border-t border-line/60" style={{ top: i * HOUR_PX }} />
                ))}
                {dayEvents.map((ev) => {
                  const top = ((ev.start - fromH * 60) / 60) * HOUR_PX;
                  const height = Math.max(22, ((ev.end - ev.start) / 60) * HOUR_PX - 2);
                  return <EventBlock key={ev.id} ev={ev} col={ev.col} cols={ev.cols} top={top} height={height} />;
                })}
                {today && nowMinutes >= fromH * 60 && nowMinutes <= toH * 60 ? (
                  <div aria-hidden className="pointer-events-none absolute inset-x-0 z-10 flex items-center" style={{ top: ((nowMinutes - fromH * 60) / 60) * HOUR_PX }}>
                    <span className="-ms-1 h-2.5 w-2.5 rounded-full bg-danger shadow-[0_0_0_3px_var(--danger-soft)]" />
                    <span className="h-px flex-1 bg-danger" />
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** Month grid: day number, up to 3 events as chips, "+N" overflow. */
export function MonthGrid({
  weeks,
  month,
  events,
  todayKey,
  weekdayLabels,
  dayHref,
  moreLabel,
}: {
  weeks: string[][];
  month: string;
  events: CalEvent[];
  todayKey: string;
  weekdayLabels: string[];
  dayHref: (key: string) => string;
  moreLabel: (n: number) => string;
}) {
  const byDay = new Map<string, CalEvent[]>();
  for (const e of events) byDay.set(e.dayKey, [...(byDay.get(e.dayKey) ?? []), e]);
  for (const list of byDay.values()) list.sort((a, b) => a.start - b.start);
  return (
    <div className="overflow-x-auto">
      <div className="min-w-[680px]">
        <div className="grid grid-cols-7 border-b border-line bg-surface">
          {weekdayLabels.map((w, i) => (
            <div key={i} className="px-2 py-2 text-center text-[12px] font-medium text-muted">
              {w}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {weeks.flat().map((k) => {
            const inMonth = k.startsWith(month);
            const list = byDay.get(k) ?? [];
            const today = k === todayKey;
            return (
              <Link key={k} href={dayHref(k)} className={cn("group min-h-[104px] border-b border-s border-line p-1.5 transition-colors hover:bg-surface-hover", !inMonth && "bg-elevated/50 text-subtle", today && "bg-accent-soft/50")} aria-label={k}>
                <div className="mb-1 flex items-center justify-between">
                  <span className={cn("grid h-6 min-w-6 place-items-center rounded-full px-1 text-[12.5px] font-semibold tabular-nums", today && "bg-accent-solid text-accent-fg")}>{Number(k.slice(8))}</span>
                  {list.length > 3 ? <span className="text-[10.5px] text-subtle tabular-nums">{list.length}</span> : null}
                </div>
                <div className="space-y-0.5">
                  {list.slice(0, 3).map((e) => {
                    const color = STATUS_COLOR[e.status] ?? "var(--accent)";
                    return (
                      <div key={e.id} className={cn("flex items-center gap-1 truncate rounded-md px-1.5 py-0.5 text-[11px]", e.status === "canceled" && "line-through opacity-60")} style={{ background: `color-mix(in srgb, ${color} 15%, transparent)` }}>
                        <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: color }} />
                        <bdi dir="ltr" className="shrink-0 tabular-nums opacity-80">
                          {e.timeLabel.split("–")[0]}
                        </bdi>
                        <span className="truncate">{e.title}</span>
                      </div>
                    );
                  })}
                  {list.length > 3 ? <div className="px-1.5 text-[10.5px] font-medium text-accent">{moreLabel(list.length - 3)}</div> : null}
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}
