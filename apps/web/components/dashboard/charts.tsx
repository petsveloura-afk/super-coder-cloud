"use client";

import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useI18n } from "@/lib/i18n/client";

const tooltipStyle = {
  background: "var(--bg-elevated)",
  border: "1px solid var(--border)",
  borderRadius: 12,
  color: "var(--text)",
  fontSize: 13,
};

export function DailyAreaChart({ data, label }: { data: { day: string; count: number }[]; label: string }) {
  const { dir, intl } = useI18n();
  const fmt = new Intl.DateTimeFormat(intl, { day: "numeric", month: "short" });
  const rows = data.map((d) => ({ ...d, label: fmt.format(new Date(d.day)) }));
  return (
    <div className="h-64 w-full" dir="ltr" role="img" aria-label={label}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={rows} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
          <defs>
            <linearGradient id="scc-area" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--brand)" stopOpacity={0.35} />
              <stop offset="100%" stopColor="var(--brand)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 6" />
          <XAxis dataKey="label" reversed={dir === "rtl"} tick={{ fill: "var(--text-subtle)", fontSize: 11 }} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={24} />
          <YAxis orientation={dir === "rtl" ? "right" : "left"} allowDecimals={false} tick={{ fill: "var(--text-subtle)", fontSize: 11 }} tickLine={false} axisLine={false} />
          <Tooltip contentStyle={tooltipStyle} cursor={{ stroke: "var(--border-strong)" }} formatter={(v) => [v, label]} />
          <Area type="monotone" dataKey="count" stroke="var(--brand)" strokeWidth={2.25} fill="url(#scc-area)" />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

const STATUS_COLORS = ["var(--brand)", "var(--teal)", "var(--gold)", "var(--text-subtle)"];

export function StatusBarChart({ data, label }: { data: { name: string; value: number }[]; label: string }) {
  const { dir } = useI18n();
  return (
    <div className="h-64 w-full" dir="ltr" role="img" aria-label={label}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 12, left: 12, bottom: 4 }}>
          <CartesianGrid horizontal={false} stroke="var(--border)" strokeDasharray="3 6" />
          <XAxis type="number" allowDecimals={false} reversed={dir === "rtl"} tick={{ fill: "var(--text-subtle)", fontSize: 11 }} tickLine={false} axisLine={false} />
          <YAxis type="category" dataKey="name" orientation={dir === "rtl" ? "right" : "left"} width={80} tick={{ fill: "var(--text-muted)", fontSize: 12 }} tickLine={false} axisLine={false} />
          <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "var(--surface-hover)" }} />
          <Bar dataKey="value" radius={6} barSize={18}>
            {data.map((_, i) => (
              <Cell key={i} fill={STATUS_COLORS[i % STATUS_COLORS.length]} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
