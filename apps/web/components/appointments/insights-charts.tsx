"use client";

import { Area, AreaChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useI18n } from "@/lib/i18n/client";
import { STATUS_COLOR } from "@/lib/appointments/insights";
import { cn } from "@/lib/utils";

const tooltipStyle = {
  background: "var(--bg-elevated)",
  border: "1px solid var(--border)",
  borderRadius: 12,
  color: "var(--text)",
  fontSize: 13,
  boxShadow: "0 12px 32px -12px rgb(0 0 0 / 0.5)",
};

/** Status mix as a donut with the total in the middle. */
export function StatusDonut({ data, total, label }: { data: { status: string; count: number }[]; total: number; label: string }) {
  const { t, intl } = useI18n();
  const fmt = new Intl.NumberFormat(intl);
  return (
    <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-center">
      <div className="relative h-44 w-44 shrink-0" dir="ltr" role="img" aria-label={label}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={data} dataKey="count" nameKey="status" innerRadius="64%" outerRadius="94%" paddingAngle={data.length > 1 ? 3 : 0} stroke="none" cornerRadius={6} isAnimationActive animationDuration={700}>
              {data.map((d) => (
                <Cell key={d.status} fill={STATUS_COLOR[d.status] ?? "var(--text-subtle)"} />
              ))}
            </Pie>
            <Tooltip contentStyle={tooltipStyle} formatter={(v, n) => [fmt.format(Number(v)), t(`appointments.statuses.${String(n)}`)]} />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
          <div>
            <div className="text-2xl font-bold tabular-nums">{fmt.format(total)}</div>
            <div className="text-[11.5px] text-muted">{t("appointments.pro.insights.meetings")}</div>
          </div>
        </div>
      </div>
      <ul className="w-full space-y-1.5 text-[13px]">
        {data.map((d) => (
          <li key={d.status} className="flex items-center gap-2">
            <span aria-hidden className="h-2.5 w-2.5 rounded-full" style={{ background: STATUS_COLOR[d.status] ?? "var(--text-subtle)" }} />
            <span className="flex-1 text-muted">{t(`appointments.statuses.${d.status}`)}</span>
            <span className="font-semibold tabular-nums">{fmt.format(d.count)}</span>
            <span className="w-12 text-end text-[12px] text-subtle tabular-nums">{total ? `${Math.round((d.count / total) * 100)}%` : "—"}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Meetings per week, split into held / no-show / canceled / other. */
export function WeeklyTrend({ data, label }: { data: { week: string; total: number; completed: number; noShow: number; canceled: number }[]; label: string }) {
  const { dir, intl, t } = useI18n();
  const fmt = new Intl.DateTimeFormat(intl, { day: "numeric", month: "short" });
  const rows = data.map((d) => ({ ...d, other: Math.max(0, d.total - d.completed - d.noShow - d.canceled), label: fmt.format(new Date(`${d.week}T12:00:00Z`)) }));
  const names: Record<string, string> = { completed: t("appointments.statuses.completed"), other: t("appointments.pro.insights.upcomingOther"), noShow: t("appointments.statuses.no_show"), canceled: t("appointments.statuses.canceled") };
  return (
    <div className="h-64 w-full" dir="ltr" role="img" aria-label={label}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="gw-done" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--success)" stopOpacity={0.55} />
              <stop offset="100%" stopColor="var(--success)" stopOpacity={0.04} />
            </linearGradient>
            <linearGradient id="gw-other" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.5} />
              <stop offset="100%" stopColor="var(--accent)" stopOpacity={0.04} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 6" />
          <XAxis dataKey="label" reversed={dir === "rtl"} tick={{ fill: "var(--text-subtle)", fontSize: 11 }} tickLine={false} axisLine={false} minTickGap={16} />
          <YAxis orientation={dir === "rtl" ? "right" : "left"} allowDecimals={false} tick={{ fill: "var(--text-subtle)", fontSize: 11 }} tickLine={false} axisLine={false} width={32} />
          <Tooltip contentStyle={tooltipStyle} formatter={(v, n) => [Number(v), names[String(n)] ?? String(n)]} />
          <Area type="monotone" dataKey="completed" stackId="w" stroke="var(--success)" strokeWidth={2} fill="url(#gw-done)" />
          <Area type="monotone" dataKey="other" stackId="w" stroke="var(--accent)" strokeWidth={2} fill="url(#gw-other)" />
          <Area type="monotone" dataKey="noShow" stackId="w" stroke="var(--warning)" strokeWidth={1.5} fill="var(--warning-soft)" />
          <Area type="monotone" dataKey="canceled" stackId="w" stroke="var(--danger)" strokeWidth={1.5} fill="var(--danger-soft)" />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Weekday × hour heatmap: when are meetings actually held? */
export function Heatmap({ heat, max, from = 7, to = 21, label }: { heat: number[][]; max: number; from?: number; to?: number; label: string }) {
  const { intl, t } = useI18n();
  const day = (d: number) => new Intl.DateTimeFormat(intl, { weekday: "short" }).format(new Date(Date.UTC(2026, 0, 4 + d)));
  const hours = Array.from({ length: to - from + 1 }, (_, i) => from + i);
  return (
    <div className="overflow-x-auto" role="img" aria-label={label}>
      <div className="min-w-[520px]" dir="ltr">
        <div className="grid items-center gap-1" style={{ gridTemplateColumns: `44px repeat(${hours.length}, minmax(0, 1fr))` }}>
          <span />
          {hours.map((h) => (
            <span key={h} className="text-center text-[10.5px] text-subtle tabular-nums">
              {h}
            </span>
          ))}
          {heat.map((row, d) => (
            <div key={d} className="contents">
              <span className="pe-1 text-end text-[11.5px] text-muted">{day(d)}</span>
              {hours.map((h) => {
                const c = row[h] ?? 0;
                const a = max ? c / max : 0;
                return (
                  <span
                    key={h}
                    title={c ? t("appointments.pro.insights.heatTip", { count: c }) : undefined}
                    className={cn("heat-cell aspect-square rounded-[5px] border border-line/60", c > 0 && "heat-on")}
                    style={c ? { background: `color-mix(in srgb, var(--accent) ${Math.round(18 + a * 72)}%, transparent)`, borderColor: "transparent" } : undefined}
                  />
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
