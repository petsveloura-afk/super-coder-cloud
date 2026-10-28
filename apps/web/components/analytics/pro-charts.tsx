"use client";

import { useState } from "react";
import { Download, Printer } from "lucide-react";
import { Area, Bar, CartesianGrid, Cell, ComposedChart, Line, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n/client";
import { Button } from "@/components/ui/primitives";
import { analyticsCsv } from "@/lib/analytics/insights";
import { cn } from "@/lib/utils";

const tooltipStyle = {
  background: "var(--bg-elevated)",
  border: "1px solid var(--border)",
  borderRadius: 12,
  color: "var(--text)",
  fontSize: 13,
  boxShadow: "0 12px 32px -12px rgb(0 0 0 / 0.5)",
};

/** Monthly revenue as gradient columns + a smooth trend line and an optional cumulative line. */
export function RevenueTrendChart({ data, label, currency, labels }: { data: { month: string; value: number; trend: number; total: number }[]; label: string; currency: string; labels: { revenue: string; trend: string; cumulative: string } }) {
  const { dir, intl } = useI18n();
  const [showCum, setShowCum] = useState(false);
  const money = new Intl.NumberFormat(intl, { style: "currency", currency, maximumFractionDigits: 0, notation: "compact" });
  const monthFmt = new Intl.DateTimeFormat(intl, { month: "short", year: "2-digit" });
  const rows = data.map((d) => ({ ...d, label: monthFmt.format(new Date(`${d.month}-01T12:00:00Z`)) }));
  return (
    <div>
      <div className="mb-2 flex items-center justify-end">
        <button type="button" role="switch" aria-checked={showCum} onClick={() => setShowCum((v) => !v)} className="inline-flex items-center gap-2 rounded-full border border-line px-3 py-1 text-[12px] text-muted hover:bg-surface-hover">
          <span className={cn("relative h-4 w-7 rounded-full transition-colors", showCum ? "bg-accent-solid" : "bg-line-strong")}>
            <span className={cn("absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all", showCum ? "start-3.5" : "start-0.5")} />
          </span>
          {labels.cumulative}
        </button>
      </div>
      <div className="h-64 w-full" dir="ltr" role="img" aria-label={label}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="rev-bar" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--teal)" stopOpacity={0.95} />
                <stop offset="100%" stopColor="var(--teal)" stopOpacity={0.35} />
              </linearGradient>
              <linearGradient id="rev-cum" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--gold)" stopOpacity={0.3} />
                <stop offset="100%" stopColor="var(--gold)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 6" />
            <XAxis dataKey="label" reversed={dir === "rtl"} tick={{ fill: "var(--text-subtle)", fontSize: 11 }} tickLine={false} axisLine={false} />
            <YAxis yAxisId="m" orientation={dir === "rtl" ? "right" : "left"} tickFormatter={(v) => money.format(Number(v))} tick={{ fill: "var(--text-subtle)", fontSize: 11 }} tickLine={false} axisLine={false} width={60} />
            <Tooltip
              contentStyle={tooltipStyle}
              cursor={{ fill: "var(--surface-hover)" }}
              formatter={(v, n) => [money.format(Number(v)), n === "value" ? labels.revenue : n === "trend" ? labels.trend : labels.cumulative]}
            />
            <Bar yAxisId="m" dataKey="value" fill="url(#rev-bar)" radius={[6, 6, 0, 0]} barSize={24} />
            <Line yAxisId="m" type="monotone" dataKey="trend" stroke="var(--accent)" strokeWidth={2.2} dot={false} strokeDasharray="1 0" />
            {showCum ? <Area yAxisId="m" type="monotone" dataKey="total" stroke="var(--gold)" strokeWidth={2} fill="url(#rev-cum)" /> : null}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

/** Won vs. lost (deal count) donut with the win rate in the middle. */
export function WinLossDonut({ won, lost, center, labels }: { won: number; lost: number; center: string; labels: { won: string; lost: string; aria: string } }) {
  const { intl } = useI18n();
  const fmt = new Intl.NumberFormat(intl);
  const data = [
    { key: "won", name: labels.won, value: won, color: "var(--success)" },
    { key: "lost", name: labels.lost, value: lost, color: "var(--danger)" },
  ].filter((d) => d.value > 0);
  return (
    <div className="flex flex-col items-center gap-4 sm:flex-row">
      <div className="relative h-40 w-40 shrink-0" dir="ltr" role="img" aria-label={labels.aria}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={data} dataKey="value" nameKey="name" innerRadius="66%" outerRadius="95%" paddingAngle={data.length > 1 ? 4 : 0} cornerRadius={6} stroke="none" animationDuration={700}>
              {data.map((d) => (
                <Cell key={d.key} fill={d.color} />
              ))}
            </Pie>
            <Tooltip contentStyle={tooltipStyle} formatter={(v, n) => [fmt.format(Number(v)), String(n)]} />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
          <div className="text-xl font-bold tabular-nums">
            <bdi dir="ltr">{center}</bdi>
          </div>
        </div>
      </div>
      <ul className="w-full space-y-2 text-[13px]">
        {[
          { name: labels.won, v: won, c: "var(--success)" },
          { name: labels.lost, v: lost, c: "var(--danger)" },
        ].map((x) => (
          <li key={x.name} className="flex items-center gap-2">
            <span aria-hidden className="h-2.5 w-2.5 rounded-full" style={{ background: x.c }} />
            <span className="flex-1 text-muted">{x.name}</span>
            <span className="font-semibold tabular-nums">{fmt.format(x.v)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Download everything on screen as a CSV (UTF-8 with BOM so Hebrew opens correctly in Excel). */
export function ExportCsvButton({ rows, filename }: { rows: (string | number | null)[][]; filename: string }) {
  const { t } = useI18n();
  return (
    <Button
      variant="secondary"
      size="sm"
      onClick={() => {
        try {
          const blob = new Blob([analyticsCsv(rows)], { type: "text/csv;charset=utf-8" });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = `${filename}.csv`;
          document.body.appendChild(a);
          a.click();
          a.remove();
          window.setTimeout(() => URL.revokeObjectURL(url), 2000);
          toast.success(t("analytics.pro.exported"));
        } catch {
          toast.error(t("errors.generic"));
        }
      }}
    >
      <Download className="h-4 w-4" /> {t("analytics.pro.exportCsv")}
    </Button>
  );
}

export function PrintButton() {
  const { t } = useI18n();
  return (
    <Button variant="secondary" size="sm" onClick={() => window.print()} className="print:hidden">
      <Printer className="h-4 w-4" /> {t("analytics.pro.print")}
    </Button>
  );
}
