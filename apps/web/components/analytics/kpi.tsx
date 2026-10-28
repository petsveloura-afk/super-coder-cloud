import type { ReactNode } from "react";
import { ArrowDownRight, ArrowRight, ArrowUpRight, AlertTriangle, CheckCircle2, Info, TrendingUp } from "lucide-react";
import { Card } from "@/components/ui/primitives";
import type { Delta, FunnelStep, Highlight } from "@/lib/analytics/insights";
import { cn } from "@/lib/utils";

/* Server-safe presentational pieces for the analytics page (no hooks). */

export type KpiTone = "accent" | "teal" | "gold" | "success" | "danger" | "warning";
const ICON_TONE: Record<KpiTone, string> = {
  accent: "border-accent/25 bg-accent-soft text-accent",
  teal: "border-teal/25 bg-teal-soft text-teal",
  gold: "border-gold/30 bg-gold-soft text-gold",
  success: "border-success/25 bg-success-soft text-success",
  danger: "border-danger/25 bg-danger-soft text-danger",
  warning: "border-warning/25 bg-warning-soft text-warning",
};
const STROKE: Record<KpiTone, string> = { accent: "var(--accent)", teal: "var(--teal)", gold: "var(--gold)", success: "var(--success)", danger: "var(--danger)", warning: "var(--warning)" };

/** Tiny inline trend line — pure SVG, renders on the server. */
export function Sparkline({ values, tone = "accent", className, id }: { values: number[]; tone?: KpiTone; className?: string; id: string }) {
  if (values.length < 2 || values.every((v) => v === 0)) return <div aria-hidden className={cn("h-9", className)} />;
  const w = 120;
  const h = 36;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => [(i / (values.length - 1)) * w, h - 3 - ((v - min) / span) * (h - 8)] as const);
  const line = pts.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `${line} L${w},${h} L0,${h} Z`;
  const [lx, ly] = pts[pts.length - 1]!;
  const c = STROKE[tone];
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className={cn("h-9 w-full", className)} aria-hidden>
      <defs>
        <linearGradient id={`sp-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={c} stopOpacity={0.35} />
          <stop offset="100%" stopColor={c} stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#sp-${id})`} />
      <path d={line} fill="none" stroke={c} strokeWidth={1.8} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      <circle cx={lx} cy={ly} r={2.4} fill={c} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/** ▲ 12% vs. previous period. `inverse` flips good/bad (e.g. overdue tasks, CAC). */
export function DeltaBadge({ delta, format, vs, inverse }: { delta: Delta | null; format: (pct: number) => string; vs: string; inverse?: boolean }) {
  if (!delta) return null;
  const good = delta.dir === "flat" ? null : inverse ? delta.dir === "down" : delta.dir === "up";
  const Icon = delta.dir === "up" ? ArrowUpRight : delta.dir === "down" ? ArrowDownRight : ArrowRight;
  return (
    <span className="inline-flex items-center gap-1 text-[11.5px]" title={vs}>
      <span className={cn("inline-flex items-center gap-0.5 rounded-full border px-1.5 py-0.5 font-semibold tabular-nums", good === null ? "border-line bg-surface-hover text-muted" : good ? "border-success/25 bg-success-soft text-success" : "border-danger/25 bg-danger-soft text-danger")}>
        <Icon className="h-3 w-3" aria-hidden />
        <bdi dir="ltr">{delta.pct === null ? "—" : format(Math.abs(delta.pct))}</bdi>
      </span>
      <span className="text-subtle">{vs}</span>
    </span>
  );
}

export interface KpiProps {
  id: string;
  label: string;
  value: string;
  sub?: string;
  icon: ReactNode;
  tone?: KpiTone;
  danger?: boolean;
  delta?: Delta | null;
  deltaFormat?: (pct: number) => string;
  vs?: string;
  inverse?: boolean;
  spark?: number[];
}

export function KpiCard({ id, label, value, sub, icon, tone = "accent", danger, delta, deltaFormat, vs, inverse, spark }: KpiProps) {
  return (
    <Card className="kpi-card group relative overflow-hidden p-4" data-kpi={id}>
      <div aria-hidden className={cn("kpi-glow", `kpi-glow-${danger ? "danger" : tone}`)} />
      <div className="relative">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 text-[12.5px] text-muted">{label}</div>
          <span className={cn("grid h-8 w-8 shrink-0 place-items-center rounded-xl border", ICON_TONE[danger ? "danger" : tone])}>{icon}</span>
        </div>
        <div className={cn("mt-1.5 text-xl font-bold sm:text-2xl", danger && "text-danger")}>
          <bdi dir="ltr">{value}</bdi>
        </div>
        {sub ? <div className="mt-0.5 text-[12px] text-subtle">{sub}</div> : null}
        {delta && deltaFormat && vs ? (
          <div className="mt-2">
            <DeltaBadge delta={delta} format={deltaFormat} vs={vs} inverse={inverse} />
          </div>
        ) : null}
        {spark && spark.length > 1 ? <Sparkline id={id} values={spark} tone={danger ? "danger" : tone} className="mt-2" /> : null}
      </div>
    </Card>
  );
}

/* ---------------------------------------------------------------- highlights */
const HL_ICON = { success: CheckCircle2, warning: AlertTriangle, danger: AlertTriangle, accent: Info } as const;
const HL_TONE = {
  success: "border-success/30 bg-success-soft text-success",
  warning: "border-warning/30 bg-warning-soft text-warning",
  danger: "border-danger/30 bg-danger-soft text-danger",
  accent: "border-accent/25 bg-accent-soft text-accent",
} as const;

export function HighlightsStrip({ items, text, title }: { items: Highlight[]; text: (h: Highlight) => string; title: string }) {
  if (!items.length) return null;
  return (
    <Card className="p-4" data-testid="analytics-highlights">
      <h2 className="mb-3 flex items-center gap-2 text-[13px] font-semibold text-muted">
        <TrendingUp className="h-4 w-4 text-accent" aria-hidden /> {title}
      </h2>
      <ul className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
        {items.map((h) => {
          const Icon = HL_ICON[h.tone];
          return (
            <li key={h.id} className={cn("hl-item flex items-start gap-2.5 rounded-xl border px-3 py-2.5 text-[13px] leading-snug", HL_TONE[h.tone])}>
              <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <span className="text-fg">{text(h)}</span>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

/* -------------------------------------------------------------------- funnel */
export function FunnelPanel({ steps, money, pct, labels }: { steps: FunnelStep[]; money: (v: number) => string; pct: (v: number) => string; labels: { ofFirst: string; fromPrev: string; deals: (n: number) => string } }) {
  const max = Math.max(1, ...steps.map((s) => s.value));
  return (
    <ol className="space-y-2.5" data-testid="funnel-panel">
      {steps.map((s, i) => (
        <li key={`${s.name}-${i}`} className="group">
          <div className="mb-1 flex items-baseline justify-between gap-3 text-[13px]">
            <span className="min-w-0 truncate font-medium">{s.name}</span>
            <span className="flex shrink-0 items-baseline gap-2">
              <span className="text-[11.5px] text-subtle">{labels.deals(s.deals)}</span>
              <bdi dir="ltr" className="font-semibold tabular-nums">
                {money(s.value)}
              </bdi>
            </span>
          </div>
          <div className="relative h-3 overflow-hidden rounded-full bg-surface-hover" dir="ltr">
            <div className="funnel-bar h-full rounded-full" style={{ width: `${Math.max(2, (s.value / max) * 100)}%`, backgroundImage: "var(--gradient-brand)", opacity: 1 - Math.min(0.5, i * 0.09) }} />
          </div>
          {i > 0 && s.fromPrev !== null ? (
            <div className="mt-0.5 flex justify-end gap-3 text-[11px] text-subtle">
              <span>
                {labels.fromPrev}: <bdi dir="ltr" className={cn("font-semibold tabular-nums", (s.drop ?? 0) >= 0.5 ? "text-warning" : "text-muted")}>{pct(s.fromPrev)}</bdi>
              </span>
              {s.ofFirst !== null ? (
                <span>
                  {labels.ofFirst}: <bdi dir="ltr" className="font-semibold tabular-nums text-muted">{pct(s.ofFirst)}</bdi>
                </span>
              ) : null}
            </div>
          ) : null}
        </li>
      ))}
    </ol>
  );
}
