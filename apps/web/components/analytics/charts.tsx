"use client";

import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useI18n } from "@/lib/i18n/client";

const tooltipStyle = {
  background: "var(--bg-elevated)",
  border: "1px solid var(--border)",
  borderRadius: 12,
  color: "var(--text)",
  fontSize: 13,
};
const COLORS = ["var(--brand)", "var(--teal)", "var(--gold)", "var(--text-subtle)"];

/** Horizontal bars (funnel / sources) with optional money formatting. */
export function HBarChart({ data, label, currency }: { data: { name: string; value: number }[]; label: string; currency?: string }) {
  const { dir, intl } = useI18n();
  const fmt = currency
    ? new Intl.NumberFormat(intl, { style: "currency", currency, maximumFractionDigits: 0, notation: "compact" })
    : new Intl.NumberFormat(intl);
  const height = Math.max(160, data.length * 40 + 30);
  return (
    <div className="w-full" style={{ height }} dir="ltr" role="img" aria-label={label}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 12, left: 12, bottom: 4 }}>
          <CartesianGrid horizontal={false} stroke="var(--border)" strokeDasharray="3 6" />
          <XAxis type="number" allowDecimals={false} reversed={dir === "rtl"} tickFormatter={(v) => fmt.format(Number(v))} tick={{ fill: "var(--text-subtle)", fontSize: 11 }} tickLine={false} axisLine={false} />
          <YAxis type="category" dataKey="name" orientation={dir === "rtl" ? "right" : "left"} width={110} tick={{ fill: "var(--text-muted)", fontSize: 12 }} tickLine={false} axisLine={false} />
          <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "var(--surface-hover)" }} formatter={(v) => [fmt.format(Number(v)), label]} />
          <Bar dataKey="value" radius={6} barSize={18}>
            {data.map((_, i) => (
              <Cell key={i} fill={COLORS[i % COLORS.length]} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Monthly columns (won revenue). `month` is YYYY-MM. */
export function MonthlyChart({ data, label, currency }: { data: { month: string; value: number }[]; label: string; currency: string }) {
  const { dir, intl } = useI18n();
  const money = new Intl.NumberFormat(intl, { style: "currency", currency, maximumFractionDigits: 0, notation: "compact" });
  const monthFmt = new Intl.DateTimeFormat(intl, { month: "short", year: "2-digit" });
  const rows = data.map((d) => ({ ...d, label: monthFmt.format(new Date(`${d.month}-01T12:00:00Z`)) }));
  return (
    <div className="h-64 w-full" dir="ltr" role="img" aria-label={label}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 6" />
          <XAxis dataKey="label" reversed={dir === "rtl"} tick={{ fill: "var(--text-subtle)", fontSize: 11 }} tickLine={false} axisLine={false} />
          <YAxis orientation={dir === "rtl" ? "right" : "left"} tickFormatter={(v) => money.format(Number(v))} tick={{ fill: "var(--text-subtle)", fontSize: 11 }} tickLine={false} axisLine={false} width={60} />
          <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "var(--surface-hover)" }} formatter={(v) => [money.format(Number(v)), label]} />
          <Bar dataKey="value" fill="var(--teal)" radius={[6, 6, 0, 0]} barSize={26} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
